# Channel Doctor

`Channel Doctor` is a reusable CLI and TypeScript helper library for operating Fiber Network channels more safely.

It focuses on the part that many developer tools skip: turning raw Fiber RPC responses into clear lifecycle checks, safer channel workflows, and operator-friendly diagnostics.

## What Problem This Solves

Fiber already provides the core node and RPC layer.

What is still painful in practice is the layer around it:

- knowing whether it is actually safe to open a channel
- avoiding mistakes when multiple channels exist with the same peer
- understanding whether a public channel is really visible in the graph yet
- checking whether a payment amount is locally sendable without overclaiming route success
- knowing whether it is safe to close a channel while TLCs are still in flight
- turning confusing node errors into plain-English guidance

`Channel Doctor` is built to close that operations and diagnostics gap.

## Hackathon Fit

This project fits best under:

`Node, Routing, Cross-chain, and Diagnostics Infrastructure`

Its strongest contribution is:

- `Diagnostics Infrastructure`
- `Node Operations Infrastructure`

It does not claim to be a full routing engine, cross-chain stack, or merchant platform.

## Who This Is For

- Fiber node operators
- CKB and Fiber developers
- teams building internal tooling around Fiber nodes
- anyone who wants a reusable CLI and JSON-friendly automation surface for channel workflows

## What It Does Today

- Lists channels with decoded balances and usable capacity
- Checks whether opening a channel is safe
- Opens a channel and waits for the correct newly created channel to become ready
- Diagnoses channel readiness using local state plus public graph visibility
- Checks local outgoing payment capacity without falsely treating pooled liquidity as guaranteed route success
- Tracks payment status until success or failure
- Checks whether closing a channel is safe
- Closes channels with guardrails
- Watches channel state over time
- Exposes machine-readable `--json` output for automation

## Real Guarantees

This project is meant to be honest about what it verifies.

- `check-open` verifies operational preconditions that are visible through the current RPC usage in this repo.
- `open` tracks the newly opened channel instead of blindly selecting any ready channel for the same peer.
- `diagnose` verifies public graph visibility for public channels and handles gossip delay explicitly.
- `can-pay` verifies local outgoing capacity only.

## What It Does Not Claim

- It does **not** prove end-to-end route success.
- It does **not** yet provide deep multi-asset infrastructure.
- It does **not** replace the Fiber node or the full Fiber RPC surface.
- It is **not** a full merchant, LSP, or cross-chain stack.

## Features

### 1. Safer Open Flow

When a new channel is opened, `Channel Doctor` snapshots existing channels first and then tracks the newly created one instead of guessing by `peer_id` alone.

This avoids false success when multiple channels already exist with the same peer.

### 2. Pre-Open Guardrails

Before opening a channel, the tool checks:

- node identity responsiveness
- peer connectivity
- existing non-closed channels with the same peer
- minimum reserve clearance
- asset recognition
- positive funding amount

### 3. Graph-Aware Diagnostics

For public channels, diagnostics use `graph_channels` visibility instead of relying only on route-guessing heuristics.

This allows the tool to distinguish between:

- channel not ready
- zero usable capacity
- gossip delay
- channel locally ready but still not visible in the public graph
- graph visibility not verifiable

### 4. Honest Payment Readiness

`can-pay` no longer says “yes” only because liquidity is split across multiple channels.

It now checks whether at least one enabled ready channel has enough local outgoing capacity for the requested amount, and clearly warns that route success is still not guaranteed.

### 5. JSON Output for Automation

Every major command supports `--json`, which makes the project usable by:

- scripts
- dashboards
- bots
- CI jobs
- operator tooling

## Repository Layout

```text
src/
  cli/           Command-line interface
  diagnostics/   Channel diagnosis and payment readiness checks
  lifecycle/     Channel normalization and open flow tracking
  network/       Peer connection helpers
  payments/      Payment tracking
  pre-close/     Safe close checks
  pre-open/      Safe open checks
  resolver/      Asset and amount helpers
  rpc/           Fiber RPC wrapper

test/            Unit tests
```

## Requirements

- Node.js `18+`
- a reachable Fiber RPC endpoint

Default RPC URL:

```text
http://127.0.0.1:8227
```

Public testnet shortcut:

```text
--testnet
```

## Installation

```bash
npm install
npm run build
```

On Windows PowerShell, if `npm` script execution is blocked, use:

```powershell
npm.cmd install
npm.cmd run build
```

## Configuration

You can set the RPC URL with either:

- `--rpc-url <url>`
- `FIBER_RPC_URL`

Example:

```powershell
$env:FIBER_RPC_URL="http://127.0.0.1:8227"
```

## Quick Start

### Check current channels

```bash
node dist/cli/index.js status
```

### Check whether opening is safe

```bash
node dist/cli/index.js check-open <peerId> 100
```

### Open a channel

```bash
node dist/cli/index.js open <peerId> 100
```

### Diagnose a channel

```bash
node dist/cli/index.js diagnose <channelId>
```

### Check local send capacity

```bash
node dist/cli/index.js can-pay 10
```

### Check whether closing is safe

```bash
node dist/cli/index.js check-close <channelId>
```

### Close a channel

```bash
node dist/cli/index.js close <channelId>
```

### Watch a channel over time

```bash
node dist/cli/index.js watch <channelId>
```

## JSON Mode

Use `--json` for machine-readable output.

Examples:

```bash
node dist/cli/index.js status --json
node dist/cli/index.js check-open <peerId> 100 --json
node dist/cli/index.js diagnose <channelId> --json
node dist/cli/index.js can-pay 10 --json
```

For `watch`, JSON mode emits event-style snapshots:

```bash
node dist/cli/index.js watch <channelId> --json
```

## Command Summary

- `status`
  Lists channels with decoded balances and usable capacity.
- `connect <multiaddr>`
  Connects to a Fiber peer and confirms it appears in peer listings.
- `check-open <peerId> <amountCKB>`
  Runs pre-open safety checks before funding a new channel.
- `open <peerId> <amountCKB>`
  Opens a channel and waits for the newly created channel to reach `CHANNEL_READY`.
- `diagnose <channelId>`
  Explains channel health and graph visibility in plain language.
- `can-pay <amountCKB>`
  Checks local outgoing capacity for the requested amount.
- `track-payment <paymentHash>`
  Polls payment status until success or failure.
- `check-close <channelId>`
  Warns about in-flight TLCs and unsafe close states.
- `close <channelId>`
  Requests cooperative or forced closure.
- `watch <channelId>`
  Watches channel state until terminal stop conditions.

## Library Usage

The package also exports reusable modules for application code.

Example:

```ts
import { checkOpen, diagnose, canPay } from 'channel-doctor'

const config = { url: 'http://127.0.0.1:8227' }

const openCheck = await checkOpen({
  config,
  peerId: 'QmPeerId',
  fundingAmountShannon: 50_000_000_000n,
})

const readiness = await canPay(config, 1_000_000_000n)
const diagnosis = await diagnose(config, '0xchannelid')
```

## Running Tests

```bash
npm run build
npm test
```

Windows PowerShell:

```powershell
npm.cmd run build
npm.cmd test
```

Current status:

- `TypeScript build passes`
- `46/46 tests passing`

## Demo Ideas

The strongest demo flow is:

1. Show `check-open` catching a conflicting existing channel.
2. Open a channel to a peer that already has another channel and show the tool selects the correct new channel.
3. Run `diagnose` immediately after open and show gossip-delay or graph visibility behavior.
4. Run `can-pay --json` and show the difference between total liquidity and single-channel sendability.
5. Show `check-close` warning on unsafe closure conditions.

## Technical Breakdown

### RPC Layer

The project wraps selected Fiber RPC methods in a typed client:

- `node_info`
- `list_peers`
- `connect_peer`
- `open_channel`
- `list_channels`
- `graph_channels`
- `send_payment`
- `get_payment`
- `close_channel`

### Lifecycle Logic

The open flow avoids ambiguous correlation by:

1. snapshotting peer channels before open
2. opening the channel
3. polling peer channels
4. following only channels that were not present in the snapshot
5. failing instead of guessing when multiple new channels appear

### Diagnostics Logic

The diagnostic flow combines:

- local channel state
- enabled/disabled status
- usable send capacity
- TLC in-flight state
- public graph visibility for public channels

### CLI + Automation Surface

The CLI is designed for both humans and machines:

- human-readable output by default
- `--json` output for automation
- non-zero exit codes on failed safety checks or payment failures

## Fiber Infrastructure Gap Addressed

The gap is not “Fiber lacks a node.”

The gap is:

`Fiber needs better reusable operational infrastructure around its node and RPC layer so developers and operators can use channels safely, understand failures quickly, and automate channel workflows without writing one-off glue code.`

That is the gap `Channel Doctor` addresses.

## Roadmap

Short term:

- improve README examples and demo coverage
- add end-to-end runnable demos against a live Fiber environment
- expand JSON contract documentation

Medium term:

- improve asset discovery beyond the current hardcoded resolver
- add deeper payment and route-readiness checks
- expand RPC coverage for more advanced Fiber workflows

Long term:

- evolve into a fuller operator toolkit for Fiber node monitoring, diagnostics, and workflow automation
- provide stronger integration hooks for services, dashboards, and internal ops tooling

## Limitations

- `can-pay` does not prove end-to-end route success
- asset support is still limited
- payment tracking is still basic compared to service-grade monitoring
- some diagnostic translation still relies on known error strings
- this is currently strongest as diagnostics and channel-operations infrastructure, not a full multi-asset or merchant stack

## License

UNLICENSED

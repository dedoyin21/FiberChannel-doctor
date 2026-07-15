# Channel Doctor

Channel Doctor is a TypeScript toolkit, CLI, and browser dashboard for safer Fiber Network channel operations.

It sits on top of the Fiber RPC layer and turns raw node responses into practical operator workflows like:

- checking whether it is safe to open a channel
- tracking the correct newly opened channel until it becomes ready
- diagnosing whether a channel is usable yet
- checking whether local liquidity can support a payment amount
- warning before unsafe channel closure

The repository includes two deliverables:

- a reusable TypeScript core and CLI in the repo root
- a React dashboard in [`web/`](./web) that can be deployed to Vercel

## Why This Project Exists

Fiber provides the node and RPC primitives, but everyday channel operations still require a lot of manual interpretation. Channel Doctor fills that gap with guardrails, diagnostics, and JSON-friendly output for scripts, dashboards, and operator tooling.

In practice, it helps answer questions like:

- Is this peer and funding amount safe to use for a new channel?
- Did the channel I just opened actually become ready?
- Is this public channel visible in the graph yet, or is gossip still catching up?
- Can I send this amount with my current local liquidity?
- Is it safe to close this channel right now?

## Main Features

- `status` lists normalized channels with decoded balances and usable capacity
- `connect` connects to a Fiber peer and confirms it appears in peer listings
- `check-open` runs pre-open safety checks before funding a channel
- `open` opens a channel and tracks the newly created channel instead of guessing by peer ID
- `diagnose` explains channel health, readiness, and public graph visibility
- `can-pay` checks honest local outgoing capacity without overclaiming route success
- `track-payment` polls a payment until it succeeds or fails
- `check-close` warns about TLCs and unsafe close timing
- `close` requests cooperative close or force-close
- `watch` streams channel snapshots over time

## Repository Layout

```text
src/              TypeScript library and CLI
test/             Unit tests
web/              React dashboard + Vercel deployment target
web/api/          Serverless Fiber RPC proxy for hosted deployments
web/src/          Dashboard UI
```

## Requirements

- Node.js `18+`
- npm
- a reachable Fiber RPC endpoint

Default local RPC URL:

```text
http://127.0.0.1:8227
```

Public testnet shortcut used by the CLI and dashboard:

```text
http://18.162.235.225:8227
```

Note:

- the public testnet shortcut is best for read-oriented checks
- state-changing methods such as peer connection, channel open, payment send, or close can be blocked on shared RPC endpoints
- for full judge testing, use a Fiber node you control

## Local Setup

Install dependencies for both the root package and the web app:

```bash
npm install
npm --prefix web install
```

Build the CLI/library:

```bash
npm run build
```

Run the web dashboard locally:

```bash
npm run web:dev
```

The local dashboard runs through Vite and proxies Fiber RPC requests through `/api/fiber-rpc`, so it can talk to a local node like `http://127.0.0.1:8227`.

## CLI Usage

Build first:

```bash
npm run build
```

Then run commands from the repo root:

```bash
node dist/cli/index.js status
node dist/cli/index.js check-open <peerId> 100
node dist/cli/index.js open <peerId> 100
node dist/cli/index.js diagnose <channelId>
node dist/cli/index.js can-pay 10
node dist/cli/index.js check-close <channelId>
node dist/cli/index.js close <channelId>
node dist/cli/index.js watch <channelId>
```

Useful global flags:

- `--rpc-url <url>` points to a specific Fiber node
- `--auth-token <token>` sends a Bearer token to authenticated Fiber RPC endpoints
- `--testnet` uses the public testnet RPC
- `--json` emits machine-readable output

Example:

```bash
node dist/cli/index.js status --rpc-url http://127.0.0.1:8227 --json
```

## Library Usage

The root package also exports the reusable core:

```ts
import { canPay, checkOpen, diagnose } from 'channel-doctor'

const config = { url: 'http://127.0.0.1:8227' }

const openCheck = await checkOpen({
  config,
  peerId: 'QmPeerId',
  fundingAmountShannon: 50_000_000_000n,
})

const readiness = await canPay(config, 1_000_000_000n)
const diagnosis = await diagnose(config, '0xchannelid')
```

## Web Dashboard

The `web/` app is a React dashboard for running the same checks visually. It reuses the shared TypeScript core and exposes a Fiber RPC proxy endpoint through:

- local development middleware in `web/vite.config.ts`
- a serverless function in [`web/api/fiber-rpc.ts`](./web/api/fiber-rpc.ts) for hosted deployments

The dashboard also supports an optional RPC auth token field for Biscuit-authenticated Fiber nodes. The token is forwarded as a Bearer token through the hosted RPC proxy.

The dashboard supports:

- channel status
- peer connection
- pre-open checks
- open flow tracking
- diagnosis
- payment readiness
- payment tracking
- close safety checks
- close requests

## Deploying From GitHub

This repository is ready to be connected to GitHub and deployed with Vercel.

### Option 1: Deploy the dashboard with Vercel

1. Push the repository to GitHub.
2. In Vercel, create a new project from that GitHub repository.
3. Set the project root directory to `web`.
4. Keep the existing repo config from [`web/vercel.json`](./web/vercel.json):

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/dashboard",
      "destination": "/index.html"
    },
    {
      "source": "/dashboard/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

5. Deploy.

Important deployment note:

- the hosted dashboard can only reach Fiber RPC endpoints that are publicly reachable from Vercel
- `http://127.0.0.1:8227` works for local development, but not from a deployed Vercel app
- for a hosted deployment, enter a public or otherwise reachable RPC endpoint in the dashboard
- if the hosted Fiber node requires Biscuit authentication, paste its Bearer token into the dashboard before attempting write actions
- the shared public testnet node is not suitable for full end-to-end judge testing of state-changing flows

### Option 2: Use the repo as a CLI/library only

If you are not deploying the dashboard, GitHub users can still clone the repo and run:

```bash
npm install
npm run build
npm test
```

Then they can use the CLI locally against their own Fiber node.

## Testing

Run the current test suite from the repo root:

```bash
npm test
```

## Project Fit

Channel Doctor fits best as diagnostics and channel-operations infrastructure for Fiber. It is strongest today as tooling for node operators, internal platform teams, and developers building on top of Fiber RPC.

## Hackathon Submission Notes

## Team

- Doyin

### 1. Submission Category

Category 2: Node, Routing, Cross-Chain, and Diagnostics Infrastructure

Channel Doctor is best categorized here because it focuses on Fiber node operations, channel lifecycle safety, readiness diagnostics, liquidity visibility, and operator tooling on top of Fiber RPC.

### 2. Project Overview

Channel Doctor is a TypeScript toolkit, CLI, and browser dashboard for safer Fiber Network channel operations. It helps users connect peers, validate channel opens before funding, track channel readiness, inspect normalized balances and usable capacity, diagnose channel issues, and check whether a node is ready to send payments.

The target audience is:

- Fiber node operators
- developers building apps or scripts on top of Fiber RPC
- infrastructure teams supporting routing, payment operations, or support workflows
- hackathon teams that need a simpler operational layer over raw Fiber RPC

### 3. What Problem Does It Solve?

Fiber provides the core node and RPC primitives, but channel operations still require a lot of manual interpretation. Operators often need to inspect peer state, funding readiness, channel state transitions, local versus remote balance, reserve constraints, liquidity availability, payment readiness, and close safety before taking action.

Channel Doctor solves that infrastructure gap by translating raw Fiber RPC into guided operational workflows and human-readable diagnostics. It relates directly to Fiber Network infrastructure because it sits between the Fiber node and the operator, helping users:

- reduce mistakes before opening or closing channels
- understand whether a channel is actually usable
- inspect liquidity in a practical way instead of raw hex values
- troubleshoot readiness, gossip delay, or peer connectivity issues
- automate safer channel operations through a reusable library and CLI

### 4. System Design

Important user flow:

1. User points Channel Doctor to a Fiber RPC endpoint.
2. The dashboard or CLI queries the node through the shared RPC client.
3. Channel Doctor normalizes raw Fiber responses into readable balances, states, and checks.
4. The user runs workflows such as connect peer, check open, open channel, diagnose, can-pay, or track-payment.
5. Channel Doctor returns operational guidance rather than only raw RPC output.

Important developer flow:

1. Developer imports the TypeScript library or uses the CLI.
2. The shared RPC layer calls Fiber JSON-RPC methods.
3. Domain modules handle peer connection, pre-open checks, lifecycle tracking, diagnostics, payments, and close safety.
4. The React dashboard reuses the same core logic and exposes it visually.
5. For hosted deployments, the web app uses the serverless RPC proxy in [`web/api/fiber-rpc.ts`](./web/api/fiber-rpc.ts).

High-level architecture:

- Fiber node: source of truth for peers, channels, payments, and wallet-backed operations
- Channel Doctor core: TypeScript logic for RPC calls, normalization, safety checks, and diagnostics
- CLI: scriptable operator interface
- React dashboard: visual operator interface for the same workflows
- Vercel/serverless proxy: optional hosted bridge for web deployments

### 5. Setup Environment

Local environment:

- Node.js `18+`
- npm
- TypeScript
- React + Vite in [`web/`](./web)
- Vitest for test coverage
- a reachable Fiber node RPC endpoint, typically `http://127.0.0.1:8227`

Local development stack:

- root package for the shared library and CLI
- Vite development server for the dashboard
- serverless-style Fiber RPC proxy for local and hosted web usage
- optional local or testnet Fiber node for live integration testing

Typical local setup:

```bash
npm install
npm --prefix web install
npm run build
npm run web:dev
```

### 6. Tooling

Channel Doctor uses the following Fiber / CKB tooling and infrastructure:

- Fiber JSON-RPC methods such as `list_peers`, `connect_peer`, `open_channel`, `list_channels`, `get_payment`, and related node operations
- Fiber RPC close variants including `close_channel` and `shutdown_channel`
- Fiber node (`fnn`) as the backend execution layer
- Fiber CLI (`fnn-cli`) for direct validation and comparison during development
- CKB testnet RPC configured through the Fiber node
- Vercel serverless function pattern for hosted RPC proxying
- TypeScript, React, Vite, and Vitest for application and test tooling

The project does not replace Fiber scripts or the Fiber node. It builds operator-facing infrastructure on top of them.

### 7. Current Functionality

Current functionality includes:

- channel status listing with normalized balances, usable capacity, and readable state names
- peer connection flow that verifies a connected peer appears in peer listings
- pre-open checks for node reachability, connected peer presence, reserve clearance, amount sanity, and conflicting channel detection
- channel opening flow that tracks the correct newly created channel instead of guessing by peer alone
- diagnostics that explain whether a channel is healthy, not ready, lacking usable liquidity, delayed by gossip, or otherwise constrained
- payment readiness checks that estimate whether local outgoing liquidity is sufficient
- payment tracking by payment hash
- pre-close checks that warn when TLCs are still in flight or when close timing is unsafe
- reusable TypeScript exports for developers who want to embed the same logic in their own tools
- web dashboard for visually running the same workflows without using raw RPC or shell commands

### 8. Future Functionality

Beyond the hackathon, the project could be extended with:

- support for authenticated public RPC endpoints, including Biscuit-authenticated Fiber deployments
- version-aware close and shutdown flows for newer Fiber RPC variants
- richer payment tooling, including invoice creation and guided send flows
- channel history, event timelines, and explorer-style diagnostics
- liquidity planning and routing analysis across multiple channels
- multi-asset operational workflows for additional UDTs beyond the current known mappings
- guided deployment mode for judge-ready hosted demos with a managed Fiber backend
- better observability, logging surfaces, and automated remediation suggestions


## License

MIT. See [LICENSE](./LICENSE).

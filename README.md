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
  "outputDirectory": "dist"
}
```

5. Deploy.

Important deployment note:

- the hosted dashboard can only reach Fiber RPC endpoints that are publicly reachable from Vercel
- `http://127.0.0.1:8227` works for local development, but not from a deployed Vercel app
- for a hosted deployment, enter a public or otherwise reachable RPC endpoint in the dashboard

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

## Limitations

- `can-pay` checks local capacity, not guaranteed end-to-end route success
- the project does not replace the Fiber node or its full RPC surface
- hosted deployments depend on the target Fiber RPC endpoint being reachable from the deployment environment

## License

UNLICENSED

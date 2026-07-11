#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${1:-channel-doctor}"

if [ -e "$PROJECT_DIR" ]; then
  echo "Refusing to overwrite existing path: $PROJECT_DIR" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/src"
mkdir -p "$PROJECT_DIR/src/cli"
mkdir -p "$PROJECT_DIR/src/diagnostics"
mkdir -p "$PROJECT_DIR/src/lifecycle"
mkdir -p "$PROJECT_DIR/src/network"
mkdir -p "$PROJECT_DIR/src/payments"
mkdir -p "$PROJECT_DIR/src/pre-close"
mkdir -p "$PROJECT_DIR/src/pre-open"
mkdir -p "$PROJECT_DIR/src/resolver"
mkdir -p "$PROJECT_DIR/src/rpc"
mkdir -p "$PROJECT_DIR/test"

cat > "$PROJECT_DIR/.gitignore" <<'EOF'
node_modules/
dist/
*.js.map
.env
.DS_Store
EOF

cat > "$PROJECT_DIR/.env.example" <<'EOF'
# Fiber node RPC URL (default: http://127.0.0.1:8227)
FIBER_RPC_URL=http://127.0.0.1:8227

# Set to the testnet node URL to use public testnet
# FIBER_RPC_URL=http://18.162.235.225:8227
EOF

cat > "$PROJECT_DIR/package.json" <<'EOF'
{
  "name": "channel-doctor",
  "version": "0.1.0",
  "private": true,
  "description": "Channel lifecycle guardrails and diagnostics for Fiber Network",
  "license": "UNLICENSED",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "channel-doctor": "./dist/cli/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.20.0",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  },
  "engines": {
    "node": ">=18"
  }
}
EOF

cat > "$PROJECT_DIR/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
EOF

cat > "$PROJECT_DIR/vitest.config.ts" <<'EOF'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
EOF

cat > "$PROJECT_DIR/src/index.ts" <<'EOF'
export { rpcCall, fiberRpc, RpcError } from './rpc/client.js'
export type { RpcConfig, RawChannel, RawPayment, PaymentStatus } from './rpc/client.js'
export { resolveAsset, formatAmount, hexToBigInt, CKB_ASSET, CHANNEL_RESERVE_SHANNON } from './resolver/index.js'
export type { AssetInfo } from './resolver/index.js'
export { connectPeer } from './network/index.js'
export type { ConnectPeerResult } from './network/index.js'
export { checkOpen } from './pre-open/index.js'
export type { PreOpenParams, CheckResult, Check } from './pre-open/index.js'
export { openAndWait, listNormalized, normalizeChannel } from './lifecycle/index.js'
export type { OpenParams, OpenResult, NormalizedChannel } from './lifecycle/index.js'
export { diagnose, canPay, translateError } from './diagnostics/index.js'
export type { Diagnosis, DiagnosisCode, ReadinessResult } from './diagnostics/index.js'
export { checkClose, closeChannel } from './pre-close/index.js'
export type { CloseCheckResult, CloseCheck } from './pre-close/index.js'
export { trackPayment } from './payments/index.js'
export type { TrackPaymentProgress, TrackPaymentResult } from './payments/index.js'
EOF

cat > "$PROJECT_DIR/src/rpc/client.ts" <<'EOF'
export interface RpcConfig {
  url: string
  timeout?: number
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly method: string,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

let _requestId = 0

export async function rpcCall<T>(
  config: RpcConfig,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const id = ++_requestId
  const timeout = config.timeout ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    })
    if (!res.ok) throw new RpcError(`HTTP ${res.status} from Fiber node`, res.status, method)
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } }
    if (json.error) throw new RpcError(json.error.message, json.error.code, method)
    return json.result as T
  } catch (err) {
    if (err instanceof RpcError) throw err
    if ((err as Error).name === 'AbortError') throw new RpcError(`Timeout after ${timeout}ms`, -1, method)
    throw new RpcError(`Cannot reach Fiber node at ${config.url}: ${(err as Error).message}`, -2, method)
  } finally {
    clearTimeout(timer)
  }
}

export interface Peer { peer_id: string; connected_addr: string | null }
export interface UdtTypeScript { code_hash: string; hash_type: 'type' | 'data' | 'data1'; args: string }
export interface ChannelState {
  state_name: 'WAITING_TLC_ACK' | 'AWAITING_TX_SIGNATURES' | 'AWAITING_CHANNEL_READY' | 'CHANNEL_READY' | 'SHUTTING_DOWN' | 'CLOSED' | 'FAILED'
  state_flags: string[]
}
export interface RawChannel {
  channel_id: string; is_public: boolean; channel_outpoint: string; peer_id: string
  funding_udt_type_script: UdtTypeScript | null; state: ChannelState
  local_balance: string; offered_tlc_balance: string; remote_balance: string
  received_tlc_balance: string; latest_commitment_transaction_hash: string
  created_at: string; enabled: boolean; tlc_expiry_delta: string; tlc_fee_proportional_millionths: string
}
export type PaymentStatus = 'Created' | 'InFlight' | 'Succeeded' | 'Failed'
export interface RawPayment {
  payment_hash: string; status: PaymentStatus; created_at: string
  last_updated_at: string; failed_error: string | null; fee: string
}

export const fiberRpc = {
  listPeers: (cfg: RpcConfig) => rpcCall<{ peers: Peer[] }>(cfg, 'list_peers', [{}]),
  connectPeer: (cfg: RpcConfig, address: string, save = true) => rpcCall<void>(cfg, 'connect_peer', [{ address, save }]),
  openChannel: (cfg: RpcConfig, params: { peer_id: string; funding_amount: string; public?: boolean; funding_udt_type_script?: UdtTypeScript }) =>
    rpcCall<{ temporary_channel_id: string }>(cfg, 'open_channel', [params]),
  listChannels: (cfg: RpcConfig, peer_id?: string) =>
    rpcCall<{ channels: RawChannel[] }>(cfg, 'list_channels', [peer_id ? { peer_id } : {}]),
  sendPayment: (cfg: RpcConfig, params: { invoice?: string; amount?: string; payment_hash?: string; dry_run?: boolean }) =>
    rpcCall<RawPayment>(cfg, 'send_payment', [params]),
  getPayment: (cfg: RpcConfig, payment_hash: string) => rpcCall<RawPayment>(cfg, 'get_payment', [{ payment_hash }]),
  closeChannel: (cfg: RpcConfig, channel_id: string, force = false) => rpcCall<void>(cfg, 'close_channel', [{ channel_id, force }]),
}
EOF

cat > "$PROJECT_DIR/src/resolver/index.ts" <<'EOF'
export interface AssetInfo { name: string; symbol: string; decimals: number }

const KNOWN_ASSETS: Record<string, AssetInfo> = {
  '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a:0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b':
    { name: 'RUSD', symbol: 'RUSD', decimals: 8 },
}

export const CKB_ASSET: AssetInfo = { name: 'CKB', symbol: 'CKB', decimals: 8 }
export const CHANNEL_RESERVE_SHANNON = 6_200_000_000n

export function resolveAsset(script: { code_hash: string; args: string } | null): AssetInfo {
  if (!script) return CKB_ASSET
  const key = `${script.code_hash.toLowerCase()}:${script.args.toLowerCase()}`
  return KNOWN_ASSETS[key] ?? { name: 'UNKNOWN', symbol: '???', decimals: 8 }
}

export function hexToBigInt(hex: string): bigint { return BigInt(hex) }

export function formatAmount(shannon: bigint, asset: AssetInfo): string {
  const divisor = 10n ** BigInt(asset.decimals)
  const whole = shannon / divisor
  const frac = shannon % divisor
  return `${whole}.${frac.toString().padStart(asset.decimals, '0')} ${asset.symbol}`
}
EOF

cat > "$PROJECT_DIR/src/pre-open/index.ts" <<'EOF'
import type { RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'
import { CHANNEL_RESERVE_SHANNON, resolveAsset, formatAmount, type AssetInfo } from '../resolver/index.js'

export interface PreOpenParams {
  config: RpcConfig
  peerId: string
  fundingAmountShannon: bigint
  udtTypeScript?: { code_hash: string; hash_type: 'type' | 'data' | 'data1'; args: string }
}

export interface CheckResult {
  ok: boolean
  checks: Check[]
}

export interface Check {
  name: string
  passed: boolean
  message: string
}

export async function checkOpen(params: PreOpenParams): Promise<CheckResult> {
  const { config, peerId, fundingAmountShannon, udtTypeScript } = params
  const checks: Check[] = []
  const asset: AssetInfo = resolveAsset(udtTypeScript ?? null)

  try {
    const { peers } = await fiberRpc.listPeers(config)
    const connected = peers.some((peer) => peer.peer_id === peerId)
    checks.push({
      name: 'peer_connected',
      passed: connected,
      message: connected
        ? `Peer ${peerId.slice(0, 12)}... is connected`
        : `Peer ${peerId.slice(0, 12)}... is NOT connected - run connect_peer first`,
    })
  } catch (err) {
    checks.push({
      name: 'peer_connected',
      passed: false,
      message: `Cannot reach Fiber node: ${(err as Error).message}`,
    })
  }

  const clearsReserve = fundingAmountShannon > CHANNEL_RESERVE_SHANNON
  checks.push({
    name: 'clears_reserve',
    passed: clearsReserve,
    message: clearsReserve
      ? `${formatAmount(fundingAmountShannon, asset)} clears the 62 CKB cell-occupancy reserve`
      : `${formatAmount(fundingAmountShannon, asset)} does NOT clear the 62 CKB reserve. Minimum: ${formatAmount(CHANNEL_RESERVE_SHANNON + 1n, asset)}`,
  })

  const assetKnown = asset.name !== 'UNKNOWN'
  checks.push({
    name: 'asset_known',
    passed: assetKnown,
    message: assetKnown
      ? `Asset resolved: ${asset.name}`
      : 'Unknown UDT type script - verify code_hash and args match a whitelisted asset',
  })

  const positive = fundingAmountShannon > 0n
  checks.push({
    name: 'positive_amount',
    passed: positive,
    message: positive ? 'Funding amount is positive' : 'Funding amount must be greater than 0',
  })

  return { ok: checks.every((check) => check.passed), checks }
}
EOF

cat > "$PROJECT_DIR/src/lifecycle/index.ts" <<'EOF'
import type { RpcConfig, RawChannel } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'
import { resolveAsset, formatAmount, hexToBigInt } from '../resolver/index.js'

export interface OpenParams {
  config: RpcConfig
  peerId: string
  fundingAmountShannon: bigint
  udtTypeScript?: { code_hash: string; hash_type: 'type' | 'data' | 'data1'; args: string }
  isPublic?: boolean
  onProgress?: (msg: string) => void
  timeoutMs?: number
  gossipWaitMs?: number
}

export interface OpenResult {
  channelId: string
  temporaryChannelId: string
  channel: NormalizedChannel
}

export interface NormalizedChannel {
  channelId: string
  peerId: string
  stateName: string
  asset: string
  localBalance: bigint
  remoteBalance: bigint
  offeredTlcBalance: bigint
  receivedTlcBalance: bigint
  usableCapacity: bigint
  canSend: boolean
  canReceive: boolean
  enabled: boolean
  createdAt: Date
  localBalanceFmt: string
  remoteBalanceFmt: string
  usableCapacityFmt: string
}

const RESERVE = 6_200_000_000n

export function normalizeChannel(raw: RawChannel): NormalizedChannel {
  const asset = resolveAsset(raw.funding_udt_type_script)
  const local = hexToBigInt(raw.local_balance)
  const remote = hexToBigInt(raw.remote_balance)
  const offered = hexToBigInt(raw.offered_tlc_balance)
  const received = hexToBigInt(raw.received_tlc_balance)
  const usable = local > offered + RESERVE ? local - offered - RESERVE : 0n

  return {
    channelId: raw.channel_id,
    peerId: raw.peer_id,
    stateName: raw.state.state_name,
    asset: asset.name,
    localBalance: local,
    remoteBalance: remote,
    offeredTlcBalance: offered,
    receivedTlcBalance: received,
    usableCapacity: usable,
    canSend: usable > 0n,
    canReceive: remote > 0n,
    enabled: raw.enabled,
    createdAt: new Date(Number(hexToBigInt(raw.created_at))),
    localBalanceFmt: formatAmount(local, asset),
    remoteBalanceFmt: formatAmount(remote, asset),
    usableCapacityFmt: formatAmount(usable, asset),
  }
}

export async function openAndWait(params: OpenParams): Promise<OpenResult> {
  const {
    config,
    peerId,
    fundingAmountShannon,
    udtTypeScript,
    isPublic = true,
    onProgress = () => {},
    timeoutMs = 120_000,
    gossipWaitMs = 20_000,
  } = params

  onProgress('Opening channel...')
  const { temporary_channel_id } = await fiberRpc.openChannel(config, {
    peer_id: peerId,
    funding_amount: `0x${fundingAmountShannon.toString(16)}`,
    public: isPublic,
    ...(udtTypeScript ? { funding_udt_type_script: udtTypeScript } : {}),
  })
  onProgress(`Channel created (temp id: ${temporary_channel_id.slice(0, 14)}...)`)
  onProgress('Waiting for CHANNEL_READY...')

  const deadline = Date.now() + timeoutMs
  let pollInterval = 1_000
  let channel: RawChannel | undefined

  while (Date.now() < deadline) {
    const { channels } = await fiberRpc.listChannels(config, peerId)
    const match = channels.find((item) =>
      item.peer_id === peerId && ['AWAITING_CHANNEL_READY', 'CHANNEL_READY'].includes(item.state.state_name))

    if (match?.state.state_name === 'CHANNEL_READY') {
      channel = match
      onProgress('CHANNEL_READY [ok]')
      break
    }

    if (match) onProgress(`State: ${match.state.state_name} - still waiting...`)
    await sleep(pollInterval)
    pollInterval = Math.min(pollInterval * 1.5, 5_000)
  }

  if (!channel) throw new Error(`Channel did not reach CHANNEL_READY within ${timeoutMs / 1000}s.`)

  onProgress(`Waiting ${gossipWaitMs / 1000}s for gossip propagation...`)
  await sleep(gossipWaitMs)
  onProgress('Channel is ready for payments [ok]')

  return {
    channelId: channel.channel_id,
    temporaryChannelId: temporary_channel_id,
    channel: normalizeChannel(channel),
  }
}

export async function listNormalized(config: RpcConfig, peerId?: string): Promise<NormalizedChannel[]> {
  const { channels } = await fiberRpc.listChannels(config, peerId)
  return channels.map(normalizeChannel)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
EOF

cat > "$PROJECT_DIR/src/diagnostics/index.ts" <<'EOF'
import type { RpcConfig } from '../rpc/client.js'
import { fiberRpc, RpcError } from '../rpc/client.js'
import { normalizeChannel, type NormalizedChannel } from '../lifecycle/index.js'

interface KnownError {
  match: string
  plain: string
  suggestion: string
}

const KNOWN_ERRORS: KnownError[] = [
  {
    match: 'connection refused',
    plain: 'Cannot connect to Fiber node.',
    suggestion: 'Check that your Fiber node is running and FIBER_RPC_URL is correct.',
  },
  {
    match: 'no route found',
    plain: 'No payment route found to the destination.',
    suggestion: 'Check that your channel is CHANNEL_READY, gossip has propagated (wait 20-60s after open), and you have sufficient local balance.',
  },
  {
    match: 'insufficient capacity',
    plain: 'A channel on the route does not have enough liquidity.',
    suggestion: 'Try a smaller amount, or open a direct channel to the destination peer.',
  },
  {
    match: 'failed to build route',
    plain: 'Routing table is not yet populated - gossip propagation is still in progress.',
    suggestion: 'Wait 20-60 seconds after CHANNEL_READY before sending the first payment. This is a known Fiber Network behaviour.',
  },
  {
    match: 'tlc expiry',
    plain: 'Time-lock contract expiry is too soon.',
    suggestion: 'Increase your tlc_expiry_delta or try again - clock drift between nodes may be the cause.',
  },
  {
    match: 'peer not found',
    plain: 'The destination peer is not reachable.',
    suggestion: 'Connect to the peer first using connect_peer, then retry.',
  },
  {
    match: 'channel not found',
    plain: 'The channel ID does not exist on this node.',
    suggestion: 'Run channel-doctor status to list all channels and verify the channel ID.',
  },
  {
    match: 'amount too small',
    plain: 'Payment amount is below the channel minimum.',
    suggestion: 'Increase the payment amount above the channel minimum.',
  },
  {
    match: 'invoice expired',
    plain: 'The payment invoice has expired.',
    suggestion: 'Ask the payee to generate a new invoice.',
  },
  {
    match: 'incorrect payment hash',
    plain: 'Payment hash does not match the preimage.',
    suggestion: 'Verify the invoice or payment hash is correct and has not been tampered with.',
  },
  {
    match: 'final incorrect htlc amount',
    plain: 'The payment amount does not match the invoice amount.',
    suggestion: 'Use the exact amount specified in the invoice.',
  },
]

export function translateError(err: Error | RpcError | string): { plain: string; suggestion: string } {
  const msg = typeof err === 'string' ? err : err.message
  const lower = msg.toLowerCase()
  const known = KNOWN_ERRORS.find((entry) => lower.includes(entry.match))
  if (known) return { plain: known.plain, suggestion: known.suggestion }
  return { plain: `Fiber node error: ${msg}`, suggestion: 'Check your Fiber node logs for more details.' }
}

export type DiagnosisCode = 'healthy' | 'not_ready' | 'zero_usable' | 'gossip_delay' | 'no_route' | 'tlcs_in_flight' | 'disabled'

export interface Diagnosis {
  channelId: string
  code: DiagnosisCode
  healthy: boolean
  channel: NormalizedChannel
  plain: string
  suggestion: string
}

export interface ReadinessResult {
  canPay: boolean
  reason: string
  suggestion: string
  usableCapacity: bigint
  usableCapacityFmt: string
}

export async function diagnose(config: RpcConfig, channelId: string, testAmountShannon = 1000n): Promise<Diagnosis> {
  const { channels } = await fiberRpc.listChannels(config)
  const raw = channels.find((channel) => channel.channel_id === channelId)
  if (!raw) throw new Error(`Channel ${channelId.slice(0, 14)}... not found. Run channel-doctor status to list channels.`)
  const ch = normalizeChannel(raw)

  if (!ch.enabled) return mk(ch, 'disabled', false, 'Channel is disabled (enabled=false).', 'Re-enable the channel or open a new one.')
  if (ch.stateName !== 'CHANNEL_READY') {
    return mk(
      ch,
      'not_ready',
      false,
      `Channel is in state ${ch.stateName} - not ready for payments yet.`,
      ch.stateName === 'AWAITING_CHANNEL_READY'
        ? 'The funding transaction is confirming on-chain. Wait for CHANNEL_READY.'
        : `State ${ch.stateName} may require manual intervention.`,
    )
  }
  if (!ch.canSend) {
    return mk(
      ch,
      'zero_usable',
      false,
      `Channel has no usable send capacity. Local: ${ch.localBalanceFmt}, in-flight: ${ch.offeredTlcBalance} shannon.`,
      'Wait for in-flight TLCs to settle, or top up the channel.',
    )
  }

  const hasTlcs = ch.offeredTlcBalance > 0n || ch.receivedTlcBalance > 0n
  let routeOk = true
  let routeError: string | null = null

  try {
    await fiberRpc.sendPayment(config, {
      amount: `0x${testAmountShannon.toString(16)}`,
      payment_hash: '0x0000000000000000000000000000000000000000000000000000000000000001',
      dry_run: true,
    })
  } catch (err) {
    const message = (err as Error).message.toLowerCase()
    routeError = (err as Error).message
    if (message.includes('route') || message.includes('no path')) routeOk = false
  }

  if (!routeOk && routeError) {
    const ageMs = Date.now() - ch.createdAt.getTime()
    if (ageMs < 90_000) {
      return mk(
        ch,
        'gossip_delay',
        false,
        `Channel is CHANNEL_READY but payments are failing (channel is ${Math.round(ageMs / 1000)}s old - gossip not yet propagated).`,
        'Wait 20-60 seconds after CHANNEL_READY before sending the first payment. This is expected behaviour.',
      )
    }
    const { plain, suggestion } = translateError(routeError)
    return mk(ch, 'no_route', false, plain, suggestion)
  }

  if (hasTlcs) {
    return mk(
      ch,
      'tlcs_in_flight',
      true,
      `Channel is healthy. Note: ${ch.offeredTlcBalance} shannon in-flight outgoing, ${ch.receivedTlcBalance} shannon in-flight incoming.`,
      'Do not force-close while TLCs are in flight - wait for settlement.',
    )
  }

  return mk(ch, 'healthy', true, `Channel is healthy. Usable send capacity: ${ch.usableCapacityFmt}.`, '')
}

export async function canPay(config: RpcConfig, amountShannon: bigint): Promise<ReadinessResult> {
  const { channels } = await fiberRpc.listChannels(config)
  const normalized = channels.filter((channel) => channel.state.state_name === 'CHANNEL_READY').map(normalizeChannel)
  const totalUsable = normalized.reduce((sum, channel) => sum + channel.usableCapacity, 0n)

  if (normalized.length === 0) {
    return {
      canPay: false,
      reason: 'No CHANNEL_READY channels found.',
      suggestion: 'Open a channel first using channel-doctor open.',
      usableCapacity: 0n,
      usableCapacityFmt: '0 CKB',
    }
  }

  if (totalUsable < amountShannon) {
    return {
      canPay: false,
      reason: `Total usable capacity (${totalUsable} shannon) is less than requested (${amountShannon} shannon).`,
      suggestion: `You need ${amountShannon - totalUsable} more shannon across your channels.`,
      usableCapacity: totalUsable,
      usableCapacityFmt: `${totalUsable} shannon`,
    }
  }

  return {
    canPay: true,
    reason: 'Sufficient capacity available.',
    suggestion: '',
    usableCapacity: totalUsable,
    usableCapacityFmt: `${totalUsable} shannon`,
  }
}

function mk(ch: NormalizedChannel, code: DiagnosisCode, healthy: boolean, plain: string, suggestion: string): Diagnosis {
  return { channelId: ch.channelId, code, healthy, channel: ch, plain, suggestion }
}
EOF

cat > "$PROJECT_DIR/src/pre-close/index.ts" <<'EOF'
import type { RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'
import { normalizeChannel, type NormalizedChannel } from '../lifecycle/index.js'

export interface CloseCheckResult {
  safe: boolean
  channel: NormalizedChannel
  checks: CloseCheck[]
}

export interface CloseCheck {
  name: string
  passed: boolean
  message: string
}

export async function checkClose(config: RpcConfig, channelId: string): Promise<CloseCheckResult> {
  const { channels } = await fiberRpc.listChannels(config)
  const raw = channels.find((channel) => channel.channel_id === channelId)
  if (!raw) throw new Error(`Channel ${channelId.slice(0, 14)}... not found. Run channel-doctor status to list all channels.`)

  const ch = normalizeChannel(raw)
  const checks: CloseCheck[] = []

  const noOffered = ch.offeredTlcBalance === 0n
  checks.push({
    name: 'no_offered_tlcs',
    passed: noOffered,
    message: noOffered
      ? 'No outgoing TLCs in flight [ok]'
      : `[warn] ${ch.offeredTlcBalance} shannon in outgoing TLCs still in flight. Closing now may strand funds.`,
  })

  const noReceived = ch.receivedTlcBalance === 0n
  checks.push({
    name: 'no_received_tlcs',
    passed: noReceived,
    message: noReceived
      ? 'No incoming TLCs in flight [ok]'
      : `[warn] ${ch.receivedTlcBalance} shannon in incoming TLCs still in flight. Wait for settlement.`,
  })

  const closeable = ['CHANNEL_READY', 'SHUTTING_DOWN'].includes(ch.stateName)
  checks.push({
    name: 'closeable_state',
    passed: closeable,
    message: closeable
      ? `Channel state ${ch.stateName} is closeable [ok]`
      : `Channel state ${ch.stateName} is not directly closeable.`,
  })

  return { safe: checks.every((check) => check.passed), channel: ch, checks }
}

export async function closeChannel(
  config: RpcConfig,
  channelId: string,
  options: { force?: boolean; skipChecks?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<void> {
  const { force = false, skipChecks = false, onProgress = () => {} } = options

  if (!skipChecks) {
    const { safe, checks } = await checkClose(config, channelId)
    for (const check of checks) onProgress(`${check.passed ? '[ok]' : '[warn]'} ${check.message}`)
    if (!safe && !force) throw new Error('Pre-close checks failed. Use --force to override.')
  }

  onProgress(force ? 'Force-closing channel...' : 'Cooperatively closing channel...')
  await fiberRpc.closeChannel(config, channelId, force)
  onProgress('Close request submitted [ok]')
}
EOF

cat > "$PROJECT_DIR/src/cli/index.ts" <<'EOF'
#!/usr/bin/env node
import { createRequire } from 'node:module'
import type { Command as CommanderCommand } from 'commander'
import { CKB_ASSET, formatAmount } from '../resolver/index.js'
import { checkOpen } from '../pre-open/index.js'
import { openAndWait, listNormalized, type NormalizedChannel } from '../lifecycle/index.js'
import { diagnose, canPay, translateError } from '../diagnostics/index.js'
import { checkClose, closeChannel } from '../pre-close/index.js'
import { connectPeer } from '../network/index.js'
import { trackPayment } from '../payments/index.js'

const require = createRequire(import.meta.url)
const { Command, Option } = require('commander') as typeof import('commander')

const CKB_PER_SHANNON = 100_000_000n
const DEFAULT_RPC_URL = 'http://127.0.0.1:8227'
const TESTNET_RPC_URL = 'http://18.162.235.225:8227'

function shannonFromCKB(ckb: string): bigint {
  const [whole, frac = ''] = ckb.split('.')
  return BigInt(whole) * CKB_PER_SHANNON + BigInt(frac.padEnd(8, '0').slice(0, 8))
}

function log(msg = ''): void {
  process.stdout.write(`${msg}\n`)
}

function fail(msg: string): never {
  process.stderr.write(`\nERROR: ${msg}\n\n`)
  process.exit(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasCliOption(flag: string): boolean {
  return process.argv.includes(flag) || process.argv.some((arg) => arg.startsWith(`${flag}=`))
}

function resolveConfig(cmd: CommanderCommand): { url: string } {
  const opts = cmd.optsWithGlobals() as { rpcUrl: string; testnet?: boolean }
  const url = hasCliOption('--rpc-url') ? opts.rpcUrl : opts.testnet ? TESTNET_RPC_URL : opts.rpcUrl
  return { url }
}

function renderProgressLine(line: string, lastLength: { value: number }): void {
  if (!process.stdout.isTTY) {
    log(line)
    return
  }
  const padded = line.padEnd(lastLength.value, ' ')
  process.stdout.write(`\r${padded}`)
  lastLength.value = Math.max(lastLength.value, line.length)
}

function renderWatchFrame(channel: NormalizedChannel, elapsedMs: number): void {
  if (process.stdout.isTTY) process.stdout.write('\x1Bc')
  else log('')

  const lines = [
    `Watching channel ${channel.channelId}`,
    '',
    `State:                ${channel.stateName}${channel.enabled ? '' : ' (DISABLED)'}`,
    `Local balance:        ${channel.localBalanceFmt}`,
    `Remote balance:       ${channel.remoteBalanceFmt}`,
    `Usable capacity:      ${channel.usableCapacityFmt}`,
    `Offered TLC balance:  ${channel.offeredTlcBalance} shannon`,
    `Received TLC balance: ${channel.receivedTlcBalance} shannon`,
    `Elapsed:              ${Math.floor(elapsedMs / 1000)}s`,
  ]

  process.stdout.write(`${lines.join('\n')}\n`)
}

const program = new Command()
program
  .name('channel-doctor')
  .description('Channel lifecycle guardrails and diagnostics for Fiber Network')
  .version('0.1.0')
  .addOption(new Option('--rpc-url <url>', 'Fiber node RPC URL').default(DEFAULT_RPC_URL).env('FIBER_RPC_URL'))
  .addOption(new Option('--testnet', 'Use the public Fiber testnet RPC node'))

program.command('status').description('List all channels with decoded balances').action(async (_: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    const channels = await listNormalized(config)
    if (!channels.length) {
      log('No channels found.')
      return
    }

    log(`\n${'-'.repeat(60)}\nFound ${channels.length} channel(s)\n`)
    for (const ch of channels) {
      log(`Channel: ${ch.channelId.slice(0, 16)}...`)
      log(`  Peer:    ${ch.peerId.slice(0, 20)}...`)
      log(`  State:   ${ch.stateName}${ch.enabled ? '' : ' (DISABLED)'}`)
      log(`  Asset:   ${ch.asset}`)
      log(`  Local:   ${ch.localBalanceFmt}`)
      log(`  Remote:  ${ch.remoteBalanceFmt}`)
      log(`  Usable:  ${ch.usableCapacityFmt}${ch.canSend ? ' [ok]' : ' [zero]'}`)
      if (ch.offeredTlcBalance > 0n) log(`  TLC out: ${ch.offeredTlcBalance} shannon in-flight`)
      if (ch.receivedTlcBalance > 0n) log(`  TLC in:  ${ch.receivedTlcBalance} shannon in-flight`)
      log(`  Created: ${ch.createdAt.toISOString()}`)
      log('-'.repeat(60))
    }
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('check-open <peerId> <amountCKB>').description('Validate before opening a channel').action(async (peerId: string, amountCKB: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    const { ok, checks } = await checkOpen({ config, peerId, fundingAmountShannon: shannonFromCKB(amountCKB) })
    log(`\nPre-open checks for ${amountCKB} CKB -> ${peerId.slice(0, 16)}...\n`)
    for (const c of checks) log(`  ${c.passed ? '[ok]' : '[x]'} ${c.message}`)
    log('')
    if (ok) {
      log('Safe to open.')
      log(`Run: channel-doctor open ${peerId} ${amountCKB}`)
      return
    }
    log('Fix issues above before opening.')
    process.exit(1)
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('open <peerId> <amountCKB>').description('Open a channel and wait for CHANNEL_READY')
  .option('--private', 'Open a private channel')
  .action(async (peerId: string, amountCKB: string, options: { private?: boolean }, cmd: CommanderCommand) => {
    const config = resolveConfig(cmd)
    try {
      log(`\nOpening channel: ${amountCKB} CKB -> ${peerId.slice(0, 16)}...\n`)
      const result = await openAndWait({
        config,
        peerId,
        fundingAmountShannon: shannonFromCKB(amountCKB),
        isPublic: !options.private,
        onProgress: (msg) => log(`  -> ${msg}`),
      })
      log(`\nChannel ready\n  ID:     ${result.channelId}\n  Local:  ${result.channel.localBalanceFmt}\n  Usable: ${result.channel.usableCapacityFmt}`)
    } catch (e) {
      fail((e as Error).message)
    }
  })

program.command('diagnose <channelId>').description('Diagnose a channel').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    log(`\nDiagnosing ${channelId.slice(0, 16)}...\n`)
    const d = await diagnose(config, channelId)
    log(`  State:  ${d.channel.stateName}\n  Asset:  ${d.channel.asset}\n  Local:  ${d.channel.localBalanceFmt}\n  Usable: ${d.channel.usableCapacityFmt}\n  Code:   ${d.code}\n`)
    log(`  ${d.healthy ? '[ok]' : '[warn]'} ${d.plain}`)
    if (d.suggestion) log(`  Tip: ${d.suggestion}`)
    log('')
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('connect <multiaddr>').description('Connect to a Fiber peer by multiaddr').action(async (multiaddr: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    const result = await connectPeer(config, multiaddr)
    log(`\nConnected to peer ${result.peerId}`)
    log(`Confirmed in peer list: ${result.peer.connected_addr ?? multiaddr}\n`)
  } catch (e) {
    const translated = translateError(e as Error)
    fail([translated.plain, translated.suggestion].filter(Boolean).join('\n'))
  }
})

program.command('track-payment <paymentHash>').description('Poll payment status until it succeeds or fails').action(async (paymentHash: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const lastLength = { value: 0 }
  try {
    const result = await trackPayment(config, paymentHash, ({ status, elapsedMs }) => {
      renderProgressLine(`  -> Status: ${status} (${Math.floor(elapsedMs / 1000)}s elapsed...)`, lastLength)
    })
    if (process.stdout.isTTY) process.stdout.write('\n')

    if (result.status === 'Succeeded') {
      log('\nPayment succeeded.')
      log(`Fee paid: ${formatAmount(result.fee, CKB_ASSET)}\n`)
      return
    }

    const translated = translateError(result.failedError ?? 'Payment failed')
    log('\nPayment failed.')
    log(translated.plain)
    if (translated.suggestion) log(`Tip: ${translated.suggestion}`)
    log('')
    process.exit(1)
  } catch (e) {
    if (process.stdout.isTTY) process.stdout.write('\n')
    fail((e as Error).message)
  }
})

program.command('check-close <channelId>').description('Check if safe to close').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    log(`\nPre-close checks for ${channelId.slice(0, 16)}...\n`)
    const { safe, checks } = await checkClose(config, channelId)
    for (const c of checks) log(`  ${c.passed ? '[ok]' : '[warn]'} ${c.message}`)
    log('')
    if (safe) {
      log('Safe to close.')
      log(`Run: channel-doctor close ${channelId}`)
      return
    }
    log('Not safe to close yet.')
    process.exit(1)
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('close <channelId>').description('Close a channel').option('--force', 'Force-close').action(async (channelId: string, options: { force?: boolean }, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    log(`\nClosing ${channelId.slice(0, 16)}...\n`)
    await closeChannel(config, channelId, { force: options.force, onProgress: (msg) => log(`  -> ${msg}`) })
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('can-pay <amountCKB>').description('Check if you can send a payment').action(async (amountCKB: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  try {
    log(`\nChecking readiness for ${amountCKB} CKB...\n`)
    const result = await canPay(config, shannonFromCKB(amountCKB))
    log(`  Usable: ${result.usableCapacityFmt}\n  ${result.canPay ? '[ok]' : '[x]'} ${result.reason}`)
    if (result.suggestion) log(`  Tip: ${result.suggestion}`)
    log('')
    if (!result.canPay) process.exit(1)
  } catch (e) {
    fail((e as Error).message)
  }
})

program.command('watch <channelId>').description('Watch a channel until it closes or fails').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const startedAt = Date.now()
  let interrupted = false
  const onSigint = () => { interrupted = true }

  process.on('SIGINT', onSigint)
  try {
    while (!interrupted) {
      const channels = await listNormalized(config)
      const channel = channels.find((item) => item.channelId === channelId)
      if (!channel) throw new Error(`Channel ${channelId.slice(0, 14)}... not found.`)
      renderWatchFrame(channel, Date.now() - startedAt)
      if (channel.stateName === 'CLOSED' || channel.stateName === 'FAILED') {
        log(`\nWatch stopped: channel entered ${channel.stateName}.`)
        return
      }
      await sleep(3_000)
    }
    log('\nWatch stopped.')
  } catch (e) {
    fail((e as Error).message)
  } finally {
    process.off('SIGINT', onSigint)
  }
})

program.parseAsync(process.argv).catch((e: unknown) => fail((e as Error).message))
EOF

cat > "$PROJECT_DIR/src/network/index.ts" <<'EOF'
import type { Peer, RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'

export interface ConnectPeerResult {
  peerId: string
  peer: Peer
}

export async function connectPeer(config: RpcConfig, multiaddr: string): Promise<ConnectPeerResult> {
  const peerId = extractPeerId(multiaddr)
  await fiberRpc.connectPeer(config, multiaddr)
  const { peers } = await fiberRpc.listPeers(config)
  const peer = peers.find((item) => item.peer_id === peerId)
  if (!peer) throw new Error(`Peer ${peerId} was not found in list_peers after connect.`)
  return { peerId, peer }
}

function extractPeerId(multiaddr: string): string {
  const match = /\/p2p\/([^/]+)$/.exec(multiaddr)
  if (!match) throw new Error('Invalid multiaddr: expected a trailing /p2p/<peerId> segment.')
  return match[1]
}
EOF

cat > "$PROJECT_DIR/src/payments/index.ts" <<'EOF'
import type { PaymentStatus, RawPayment, RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'
import { hexToBigInt } from '../resolver/index.js'

const PAYMENT_POLL_INTERVAL_MS = 2_000
const PAYMENT_TIMEOUT_MS = 120_000

export interface TrackPaymentProgress {
  status: PaymentStatus
  elapsedMs: number
  payment: RawPayment
}

export interface TrackPaymentResult {
  paymentHash: string
  status: 'Succeeded' | 'Failed'
  elapsedMs: number
  fee: bigint
  failedError: string | null
  payment: RawPayment
}

export async function trackPayment(
  config: RpcConfig,
  paymentHash: string,
  onProgress: (progress: TrackPaymentProgress) => void = () => {},
): Promise<TrackPaymentResult> {
  const startedAt = Date.now()
  const deadline = startedAt + PAYMENT_TIMEOUT_MS

  while (true) {
    const payment = await fiberRpc.getPayment(config, paymentHash)
    const elapsedMs = Date.now() - startedAt
    onProgress({ status: payment.status, elapsedMs, payment })

    if (payment.status === 'Succeeded' || payment.status === 'Failed') {
      return {
        paymentHash,
        status: payment.status,
        elapsedMs,
        fee: hexToBigInt(payment.fee),
        failedError: payment.failed_error,
        payment,
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(`Payment ${paymentHash} did not complete within 120s.`)
    }

    await sleep(PAYMENT_POLL_INTERVAL_MS)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
EOF

cat > "$PROJECT_DIR/test/resolver.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest'
import { resolveAsset, formatAmount, hexToBigInt, CKB_ASSET, CHANNEL_RESERVE_SHANNON } from '../src/resolver/index.js'

describe('resolver', () => {
  it('resolves null script to CKB', () => { expect(resolveAsset(null)).toEqual(CKB_ASSET) })
  it('resolves known RUSD script', () => {
    expect(resolveAsset({ code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a', args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b' }).name).toBe('RUSD')
  })
  it('returns UNKNOWN for unrecognised script', () => { expect(resolveAsset({ code_hash: '0xdeadbeef', args: '0x1234' }).name).toBe('UNKNOWN') })
  it('decodes hex shannon to bigint', () => { expect(hexToBigInt('0xa32aef600')).toBe(43_800_000_000n) })
  it('formats CKB amount correctly', () => { expect(formatAmount(43_800_000_000n, CKB_ASSET)).toBe('438.00000000 CKB') })
  it('channel reserve is 62 CKB', () => { expect(CHANNEL_RESERVE_SHANNON).toBe(6_200_000_000n) })
})
EOF

cat > "$PROJECT_DIR/test/pre-open.test.ts" <<'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkOpen } from '../src/pre-open/index.js'
import * as client from '../src/rpc/client.js'

const PEER_ID = 'QmXen3eUHhywmutEzydCsW4hXBoeVmdET2FJvMX69XJ1Eo'
const CONFIG = { url: 'http://127.0.0.1:8227' }

describe('pre-open', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('passes all checks when peer is connected and amount clears reserve', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/1.2.3.4/tcp/8228' }] })
    const { ok } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })
    expect(ok).toBe(true)
  })

  it('fails peer_connected check when peer is not in list', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [] })
    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })
    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'peer_connected')?.passed).toBe(false)
  })

  it('fails clears_reserve check when funding is below 62 CKB', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/1.2.3.4/tcp/8228' }] })
    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 1_000_000_000n })
    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'clears_reserve')?.passed).toBe(false)
  })

  it('fails asset_known check for unrecognised UDT script', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/1.2.3.4/tcp/8228' }] })
    const { checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n,
      udtTypeScript: { code_hash: '0xdeadbeef', hash_type: 'type', args: '0x1234' } })
    expect(checks.find((c) => c.name === 'asset_known')?.passed).toBe(false)
  })
})
EOF

cat > "$PROJECT_DIR/test/lifecycle.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest'
import { normalizeChannel } from '../src/lifecycle/index.js'
import type { RawChannel } from '../src/rpc/client.js'

const MOCK: RawChannel = {
  channel_id: '0x26ce85d57fb4a1a826cbf4862358862317a83b775090625550d8be12c6ce9569',
  is_public: true,
  channel_outpoint: '0x9bb200000000',
  peer_id: 'QmXen3e',
  funding_udt_type_script: null,
  state: { state_name: 'CHANNEL_READY', state_flags: [] },
  local_balance: '0xa32aef600',
  offered_tlc_balance: '0x0',
  remote_balance: '0x460913c00',
  received_tlc_balance: '0x0',
  latest_commitment_transaction_hash: '0x18ef',
  created_at: '0x195892d237f',
  enabled: true,
  tlc_expiry_delta: '0x5265c00',
  tlc_fee_proportional_millionths: '0x3e8',
}

describe('lifecycle - normalizeChannel', () => {
  it('decodes hex balances correctly', () => {
    const channel = normalizeChannel(MOCK)
    expect(channel.localBalance).toBe(43_800_000_000n)
    expect(channel.remoteBalance).toBe(18_800_000_000n)
  })

  it('computes usable capacity as local - offered - 62 CKB reserve', () => {
    expect(normalizeChannel(MOCK).usableCapacity).toBe(37_600_000_000n)
  })

  it('resolves asset to CKB when udt script is null', () => {
    expect(normalizeChannel(MOCK).asset).toBe('CKB')
  })

  it('sets canSend true when usable capacity is positive', () => {
    expect(normalizeChannel(MOCK).canSend).toBe(true)
  })

  it('sets canReceive true when remote balance is positive', () => {
    expect(normalizeChannel(MOCK).canReceive).toBe(true)
  })

  it('sets canSend false when local balance <= reserve', () => {
    expect(normalizeChannel({ ...MOCK, local_balance: '0x170cdc0' }).canSend).toBe(false)
  })

  it('formats local balance as human-readable CKB string', () => {
    expect(normalizeChannel(MOCK).localBalanceFmt).toBe('438.00000000 CKB')
  })
})
EOF

cat > "$PROJECT_DIR/test/diagnostics.test.ts" <<'EOF'
import { describe, it, expect } from 'vitest'
import { translateError } from '../src/diagnostics/index.js'

describe('diagnostics - translateError', () => {
  it('translates "failed to build route" to gossip delay explanation', () => {
    const result = translateError('SendPaymentError: failed to build route')
    expect(result.plain).toContain('gossip propagation')
    expect(result.suggestion).toContain('20-60 seconds')
  })

  it('translates "no route found" correctly', () => {
    expect(translateError('no route found').plain).toContain('No payment route')
  })

  it('translates "insufficient capacity" correctly', () => {
    expect(translateError('insufficient capacity').plain).toContain('liquidity')
  })

  it('translates "tlc expiry" correctly', () => {
    expect(translateError('tlc expiry too soon').plain).toContain('Time-lock')
  })

  it('translates "connection refused" correctly', () => {
    expect(translateError('connection refused').plain).toContain('Cannot connect to Fiber node')
  })

  it('translates "invoice expired" correctly', () => {
    expect(translateError('invoice expired').plain).toContain('invoice has expired')
  })

  it('translates incorrect payment hash correctly', () => {
    expect(translateError('incorrect payment hash').plain).toContain('does not match the preimage')
  })

  it('translates final incorrect htlc amount correctly', () => {
    expect(translateError('final incorrect htlc amount').plain).toContain('does not match the invoice amount')
  })

  it('returns fallback for unknown errors', () => {
    expect(translateError('something unknown').plain).toContain('Fiber node error')
  })

  it('accepts Error objects', () => {
    expect(translateError(new Error('no route found')).plain).toContain('No payment route')
  })
})
EOF

cat > "$PROJECT_DIR/test/pre-close.test.ts" <<'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkClose } from '../src/pre-close/index.js'
import * as client from '../src/rpc/client.js'
import type { RawChannel } from '../src/rpc/client.js'

const CONFIG = { url: 'http://127.0.0.1:8227' }
const BASE: RawChannel = {
  channel_id: '0x26ce85d57fb4a1a826cbf4862358862317a83b775090625550d8be12c6ce9569',
  is_public: true, channel_outpoint: '0x9bb200000000', peer_id: 'QmXen3e',
  funding_udt_type_script: null, state: { state_name: 'CHANNEL_READY', state_flags: [] },
  local_balance: '0xa32aef600', offered_tlc_balance: '0x0',
  remote_balance: '0x460913c00', received_tlc_balance: '0x0',
  latest_commitment_transaction_hash: '0xabc', created_at: '0x195892d237f',
  enabled: true, tlc_expiry_delta: '0x5265c00', tlc_fee_proportional_millionths: '0x3e8',
}

describe('pre-close', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('is safe when no TLCs in flight', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [BASE] })
    expect((await checkClose(CONFIG, BASE.channel_id)).safe).toBe(true)
  })
  it('is NOT safe when offered_tlc_balance > 0', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [{ ...BASE, offered_tlc_balance: '0x7a120' }] })
    const { safe, checks } = await checkClose(CONFIG, BASE.channel_id)
    expect(safe).toBe(false)
    expect(checks.find((c) => c.name === 'no_offered_tlcs')?.passed).toBe(false)
  })
  it('is NOT safe when received_tlc_balance > 0', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [{ ...BASE, received_tlc_balance: '0x186a0' }] })
    expect((await checkClose(CONFIG, BASE.channel_id)).safe).toBe(false)
  })
  it('throws when channel not found', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [] })
    await expect(checkClose(CONFIG, '0xdeadbeef')).rejects.toThrow('not found')
  })
})
EOF

cat > "$PROJECT_DIR/test/payments.test.ts" <<'EOF'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trackPayment } from '../src/payments/index.js'
import * as client from '../src/rpc/client.js'

const CONFIG = { url: 'http://127.0.0.1:8227' }
const PAYMENT_HASH = '0xabc123'

describe('payments - trackPayment', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('polls until a payment succeeds', async () => {
    vi.useFakeTimers()
    const progress: string[] = []
    vi.spyOn(client.fiberRpc, 'getPayment')
      .mockResolvedValueOnce({
        payment_hash: PAYMENT_HASH,
        status: 'InFlight',
        created_at: '0x0',
        last_updated_at: '0x0',
        failed_error: null,
        fee: '0x0',
      })
      .mockResolvedValueOnce({
        payment_hash: PAYMENT_HASH,
        status: 'Succeeded',
        created_at: '0x0',
        last_updated_at: '0x1',
        failed_error: null,
        fee: '0x174876e800',
      })

    const pending = trackPayment(CONFIG, PAYMENT_HASH, ({ status }) => {
      progress.push(status)
    })

    await vi.advanceTimersByTimeAsync(2_000)
    const result = await pending

    expect(progress).toEqual(['InFlight', 'Succeeded'])
    expect(result.status).toBe('Succeeded')
    expect(result.fee).toBe(100_000_000_000n)
  })

  it('returns failed payments immediately', async () => {
    vi.spyOn(client.fiberRpc, 'getPayment').mockResolvedValue({
      payment_hash: PAYMENT_HASH,
      status: 'Failed',
      created_at: '0x0',
      last_updated_at: '0x1',
      failed_error: 'invoice expired',
      fee: '0x0',
    })

    const result = await trackPayment(CONFIG, PAYMENT_HASH)

    expect(result.status).toBe('Failed')
    expect(result.failedError).toBe('invoice expired')
  })

  it('times out after 120 seconds', async () => {
    vi.useFakeTimers()
    vi.spyOn(client.fiberRpc, 'getPayment').mockResolvedValue({
      payment_hash: PAYMENT_HASH,
      status: 'InFlight',
      created_at: '0x0',
      last_updated_at: '0x0',
      failed_error: null,
      fee: '0x0',
    })

    const pending = trackPayment(CONFIG, PAYMENT_HASH)
    const expectation = expect(pending).rejects.toThrow('did not complete within 120s')
    await vi.advanceTimersByTimeAsync(120_000)
    await expectation
  })
})
EOF

cd "$PROJECT_DIR"
npm install
npm test
npm run build
echo "channel-doctor v2 is ready in $PROJECT_DIR"

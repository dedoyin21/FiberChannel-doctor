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

export type DiagnosisCode =
  | 'healthy'
  | 'not_ready'
  | 'zero_usable'
  | 'gossip_delay'
  | 'graph_unannounced'
  | 'graph_unverified'
  | 'tlcs_in_flight'
  | 'disabled'

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
  maxChannelCapacity: bigint
  maxChannelCapacityFmt: string
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
  if (raw.is_public) {
    const graphStatus = await inspectGraphStatus(config, raw.channel_outpoint, ch.createdAt)
    if (graphStatus.code) {
      return mk(ch, graphStatus.code, graphStatus.healthy, graphStatus.plain, graphStatus.suggestion)
    }
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

  return mk(
    ch,
    'healthy',
    true,
    raw.is_public
      ? `Channel is healthy and visible in the public graph. Usable send capacity: ${ch.usableCapacityFmt}.`
      : `Channel is healthy. This is a private channel, so public graph visibility is not expected. Usable send capacity: ${ch.usableCapacityFmt}.`,
    '',
  )
}

export async function canPay(config: RpcConfig, amountShannon: bigint): Promise<ReadinessResult> {
  const { channels } = await fiberRpc.listChannels(config)
  const normalized = channels
    .filter((channel) => channel.state.state_name === 'CHANNEL_READY' && channel.enabled)
    .map(normalizeChannel)
  const totalUsable = normalized.reduce((sum, channel) => sum + channel.usableCapacity, 0n)
  const maxChannelCapacity = normalized.reduce((max, channel) =>
    channel.usableCapacity > max ? channel.usableCapacity : max, 0n)

  if (normalized.length === 0) {
    return {
      canPay: false,
      reason: 'No enabled CHANNEL_READY channels found.',
      suggestion: 'Open a channel first using channel-doctor open.',
      usableCapacity: 0n,
      usableCapacityFmt: '0 CKB',
      maxChannelCapacity: 0n,
      maxChannelCapacityFmt: '0 CKB',
    }
  }

  if (maxChannelCapacity < amountShannon) {
    return {
      canPay: false,
      reason: `No single ready channel has enough usable capacity for ${amountShannon} shannon. Largest local send window is ${maxChannelCapacity} shannon, even though total ready capacity is ${totalUsable} shannon.`,
      suggestion: `Open or rebalance a channel with at least ${amountShannon} shannon of usable local capacity.`,
      usableCapacity: totalUsable,
      usableCapacityFmt: `${totalUsable} shannon`,
      maxChannelCapacity,
      maxChannelCapacityFmt: `${maxChannelCapacity} shannon`,
    }
  }

  return {
    canPay: true,
    reason: `At least one ready channel has enough local send capacity for ${amountShannon} shannon.`,
    suggestion: 'This only verifies local outgoing capacity. Destination reachability and end-to-end route availability are not confirmed by can-pay.',
    usableCapacity: totalUsable,
    usableCapacityFmt: `${totalUsable} shannon`,
    maxChannelCapacity,
    maxChannelCapacityFmt: `${maxChannelCapacity} shannon`,
  }
}

function mk(ch: NormalizedChannel, code: DiagnosisCode, healthy: boolean, plain: string, suggestion: string): Diagnosis {
  return { channelId: ch.channelId, code, healthy, channel: ch, plain, suggestion }
}

async function inspectGraphStatus(
  config: RpcConfig,
  channelOutpoint: string,
  createdAt: Date,
): Promise<{ code?: DiagnosisCode; healthy: boolean; plain: string; suggestion: string }> {
  try {
    const announced = await isChannelVisibleInGraph(config, channelOutpoint)
    if (announced) return { healthy: true, plain: '', suggestion: '' }

    const ageMs = Date.now() - createdAt.getTime()
    if (ageMs < 90_000) {
      return {
        code: 'gossip_delay',
        healthy: false,
        plain: `Channel is CHANNEL_READY but not yet visible in the public graph (channel is ${Math.round(ageMs / 1000)}s old).`,
        suggestion: 'Wait 20-60 seconds after CHANNEL_READY for graph propagation, then re-run diagnose.',
      }
    }

    return {
      code: 'graph_unannounced',
      healthy: false,
      plain: 'Channel is locally ready but still not visible in the public graph.',
      suggestion: 'Inspect graph_channels and Fiber node logs to confirm gossip propagation and funding confirmation.',
    }
  } catch (err) {
    return {
      code: 'graph_unverified',
      healthy: true,
      plain: `Channel is locally healthy, but graph visibility could not be verified: ${(err as Error).message}`,
      suggestion: 'Check that graph_channels RPC is available before treating public-route reachability as verified.',
    }
  }
}

function normalizeOutpoint(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  return JSON.stringify(value)?.toLowerCase() ?? ''
}

async function isChannelVisibleInGraph(config: RpcConfig, channelOutpoint: string): Promise<boolean> {
  const target = normalizeOutpoint(channelOutpoint)
  const seenCursors = new Set<string>()
  let after: string | undefined

  while (true) {
    const { channels, last_cursor } = await fiberRpc.graphChannels(config, after ? { limit: '0x64', after } : { limit: '0x64' })
    if (channels.some((channel) => normalizeOutpoint(channel.channel_outpoint) === target)) return true

    if (!last_cursor) return false
    const cursor = last_cursor.toLowerCase()
    if (seenCursors.has(cursor)) return false
    seenCursors.add(cursor)

    if (channels.length === 0) return false
    after = last_cursor
  }
}

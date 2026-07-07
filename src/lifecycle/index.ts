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
const OPENED_CHANNEL_TIMESTAMP_GRACE_MS = 1_000

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

  const { channels: existingPeerChannels } = await fiberRpc.listChannels(config, peerId)
  const existingChannelIds = new Set(existingPeerChannels.map((channel) => channel.channel_id))
  const openStartedAt = Date.now()

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
  let trackedChannelId: string | undefined

  while (Date.now() < deadline) {
    const { channels } = await fiberRpc.listChannels(config, peerId)
    const match = findOpenedChannel(channels, {
      existingChannelIds,
      temporaryChannelId: temporary_channel_id,
      openStartedAt,
      trackedChannelId,
    })

    if (match.error) throw new Error(match.error)
    if (match.channel) trackedChannelId = match.channel.channel_id

    if (match.channel?.state.state_name === 'CHANNEL_READY') {
      channel = match.channel
      onProgress('CHANNEL_READY [ok]')
      break
    }

    if (match.channel) onProgress(`State: ${match.channel.state.state_name} - still waiting...`)
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

function findOpenedChannel(
  channels: RawChannel[],
  options: {
    existingChannelIds: Set<string>
    temporaryChannelId: string
    openStartedAt: number
    trackedChannelId?: string
  },
): { channel?: RawChannel; error?: string } {
  const { existingChannelIds, temporaryChannelId, openStartedAt, trackedChannelId } = options

  if (trackedChannelId) {
    const tracked = channels.find((channel) => channel.channel_id === trackedChannelId)
    if (tracked) return { channel: tracked }
  }

  const tempMatch = channels.find((channel) => channel.channel_id === temporaryChannelId)
  if (tempMatch) return { channel: tempMatch }

  const newChannels = channels.filter((channel) => !existingChannelIds.has(channel.channel_id))
  if (newChannels.length === 1) return { channel: newChannels[0] }

  const freshChannels = newChannels.filter((channel) => {
    const createdAt = Number(hexToBigInt(channel.created_at))
    return createdAt >= openStartedAt - OPENED_CHANNEL_TIMESTAMP_GRACE_MS
  })
  if (freshChannels.length === 1) return { channel: freshChannels[0] }

  const ambiguous = freshChannels.length > 1 ? freshChannels : newChannels
  if (ambiguous.length > 1) {
    const ids = ambiguous.map((candidate) => candidate.channel_id.slice(0, 14)).join(', ')
    return {
      error: `Unable to uniquely identify the newly opened channel for peer ${ambiguous[0]?.peer_id.slice(0, 14)}.... Multiple new channels appeared after open (${ids}...).`,
    }
  }

  return {}
}

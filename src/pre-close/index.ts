import type { RpcConfig } from '../rpc/client.js'
import { fiberRpc, RpcError } from '../rpc/client.js'
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
  try {
    await fiberRpc.closeChannel(config, channelId, force)
  } catch (error) {
    if (!isMethodNotFound(error)) throw error

    onProgress('close_channel is unavailable on this Fiber version, retrying with shutdown_channel...')
    await fiberRpc.shutdownChannel(config, { channel_id: channelId, force })
  }

  onProgress('Close request submitted [ok]')
}

function isMethodNotFound(error: unknown): boolean {
  if (error instanceof RpcError) {
    return error.code === -32601 || error.message.toLowerCase().includes('method not found')
  }

  return error instanceof Error && error.message.toLowerCase().includes('method not found')
}

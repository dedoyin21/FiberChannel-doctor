import type { RawChannel, RpcConfig } from '../rpc/client.js'
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

const BLOCKING_CHANNEL_STATES = new Set<RawChannel['state']['state_name']>([
  'WAITING_TLC_ACK',
  'AWAITING_TX_SIGNATURES',
  'AWAITING_CHANNEL_READY',
  'CHANNEL_READY',
  'SHUTTING_DOWN',
])

export async function checkOpen(params: PreOpenParams): Promise<CheckResult> {
  const { config, peerId, fundingAmountShannon, udtTypeScript } = params
  const checks: Check[] = []
  const asset: AssetInfo = resolveAsset(udtTypeScript ?? null)

  try {
    const info = await fiberRpc.nodeInfo(config)
    const hasIdentity = Boolean(info.pubkey)
    checks.push({
      name: 'node_ready',
      passed: hasIdentity,
      message: hasIdentity
        ? `Connected to Fiber node ${info.version}${info.addresses.length ? ` (${info.addresses.length} advertised address${info.addresses.length === 1 ? '' : 'es'})` : ''}`
        : 'Fiber node responded to node_info but did not return an identity pubkey.',
    })
  } catch (err) {
    checks.push({
      name: 'node_ready',
      passed: false,
      message: `Cannot query Fiber node identity: ${(err as Error).message}`,
    })
  }

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

  try {
    const { channels } = await fiberRpc.listChannels(config, peerId)
    const blocking = channels.filter((channel) => BLOCKING_CHANNEL_STATES.has(channel.state.state_name))
    checks.push({
      name: 'no_conflicting_channel',
      passed: blocking.length === 0,
      message: blocking.length === 0
        ? `No existing active or pending channel found for peer ${peerId.slice(0, 12)}...`
        : `Peer ${peerId.slice(0, 12)}... already has ${blocking.length} non-closed channel(s) in states: ${blocking.map((channel) => channel.state.state_name).join(', ')}. Opening another channel may be unintentional.`,
    })
  } catch (err) {
    checks.push({
      name: 'no_conflicting_channel',
      passed: false,
      message: `Cannot inspect existing channels for peer ${peerId.slice(0, 12)}...: ${(err as Error).message}`,
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

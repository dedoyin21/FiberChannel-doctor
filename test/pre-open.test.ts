import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkOpen } from '../src/pre-open/index.js'
import * as client from '../src/rpc/client.js'
import type { RawChannel } from '../src/rpc/client.js'

const PEER_ID = 'QmXen3eUHhywmutEzydCsW4hXBoeVmdET2FJvMX69XJ1Eo'
const CONFIG = { url: 'http://127.0.0.1:8227' }
const BASE_CHANNEL: RawChannel = {
  channel_id: '0x26ce85d57fb4a1a826cbf4862358862317a83b775090625550d8be12c6ce9569',
  is_public: true,
  channel_outpoint: '0x9bb200000000',
  peer_id: PEER_ID,
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

function mockHealthyNode(): void {
  vi.spyOn(client.fiberRpc, 'nodeInfo').mockResolvedValue({
    version: '0.8.1',
    pubkey: '0xnode',
    features: [],
    addresses: ['/ip4/127.0.0.1/tcp/8228/p2p/0xnode'],
  })
  vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/1.2.3.4/tcp/8228' }] })
  vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [] })
}

describe('pre-open', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('passes all checks when peer is connected and amount clears reserve', async () => {
    mockHealthyNode()
    const { ok } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })
    expect(ok).toBe(true)
  })

  it('fails peer_connected check when peer is not in list', async () => {
    vi.spyOn(client.fiberRpc, 'nodeInfo').mockResolvedValue({
      version: '0.8.1',
      pubkey: '0xnode',
      features: [],
      addresses: [],
    })
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [] })
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [] })
    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })
    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'peer_connected')?.passed).toBe(false)
  })

  it('fails clears_reserve check when funding is below 62 CKB', async () => {
    mockHealthyNode()
    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 1_000_000_000n })
    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'clears_reserve')?.passed).toBe(false)
  })

  it('fails asset_known check for unrecognised UDT script', async () => {
    mockHealthyNode()
    const { checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n,
      udtTypeScript: { code_hash: '0xdeadbeef', hash_type: 'type', args: '0x1234' } })
    expect(checks.find((c) => c.name === 'asset_known')?.passed).toBe(false)
  })

  it('fails when node identity cannot be queried', async () => {
    vi.spyOn(client.fiberRpc, 'nodeInfo').mockRejectedValue(new Error('rpc unavailable'))
    vi.spyOn(client.fiberRpc, 'listPeers').mockResolvedValue({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/1.2.3.4/tcp/8228' }] })
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [] })

    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })

    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'node_ready')?.passed).toBe(false)
  })

  it('fails when the peer already has a non-closed channel', async () => {
    mockHealthyNode()
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [BASE_CHANNEL] })

    const { ok, checks } = await checkOpen({ config: CONFIG, peerId: PEER_ID, fundingAmountShannon: 50_000_000_000n })

    expect(ok).toBe(false)
    expect(checks.find((c) => c.name === 'no_conflicting_channel')?.passed).toBe(false)
  })
})

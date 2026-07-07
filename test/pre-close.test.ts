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

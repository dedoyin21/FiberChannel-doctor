import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeChannel, openAndWait } from '../src/lifecycle/index.js'
import type { RawChannel } from '../src/rpc/client.js'
import * as client from '../src/rpc/client.js'

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
const CONFIG = { url: 'http://127.0.0.1:8227' }

describe('lifecycle - normalizeChannel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

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

  it('tracks the newly opened channel instead of an older ready channel with the same peer', async () => {
    vi.useFakeTimers()

    const existingReady = { ...MOCK, channel_id: '0xexisting', created_at: '0x0' }
    const newPending = {
      ...MOCK,
      channel_id: '0xnew',
      state: { state_name: 'AWAITING_CHANNEL_READY', state_flags: [] },
      created_at: '0x1',
    } satisfies RawChannel
    const newReady = {
      ...newPending,
      state: { state_name: 'CHANNEL_READY', state_flags: [] },
    } satisfies RawChannel

    vi.spyOn(client.fiberRpc, 'openChannel').mockResolvedValue({ temporary_channel_id: '0xtemp' })
    vi.spyOn(client.fiberRpc, 'listChannels')
      .mockResolvedValueOnce({ channels: [existingReady] })
      .mockResolvedValueOnce({ channels: [existingReady, newPending] })
      .mockResolvedValueOnce({ channels: [existingReady, newReady] })

    const pending = openAndWait({
      config: CONFIG,
      peerId: MOCK.peer_id,
      fundingAmountShannon: 50_000_000_000n,
      timeoutMs: 10_000,
      gossipWaitMs: 0,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    const result = await pending

    expect(result.channelId).toBe('0xnew')
    expect(result.temporaryChannelId).toBe('0xtemp')
  })

  it('fails instead of guessing when multiple new channels appear after open', async () => {
    vi.useFakeTimers()

    const existingReady = { ...MOCK, channel_id: '0xexisting', created_at: '0x0' }
    const newPendingA = {
      ...MOCK,
      channel_id: '0xnew-a',
      state: { state_name: 'AWAITING_CHANNEL_READY', state_flags: [] },
      created_at: '0x1',
    } satisfies RawChannel
    const newPendingB = {
      ...MOCK,
      channel_id: '0xnew-b',
      state: { state_name: 'AWAITING_CHANNEL_READY', state_flags: [] },
      created_at: '0x2',
    } satisfies RawChannel

    vi.spyOn(client.fiberRpc, 'openChannel').mockResolvedValue({ temporary_channel_id: '0xtemp' })
    vi.spyOn(client.fiberRpc, 'listChannels')
      .mockResolvedValueOnce({ channels: [existingReady] })
      .mockResolvedValueOnce({ channels: [existingReady, newPendingA, newPendingB] })

    await expect(openAndWait({
      config: CONFIG,
      peerId: MOCK.peer_id,
      fundingAmountShannon: 50_000_000_000n,
      timeoutMs: 10_000,
      gossipWaitMs: 0,
    })).rejects.toThrow('Unable to uniquely identify the newly opened channel')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { diagnose, translateError } from '../src/diagnostics/index.js'
import * as client from '../src/rpc/client.js'
import type { RawChannel } from '../src/rpc/client.js'

const CONFIG = { url: 'http://127.0.0.1:8227' }
const BASE_CHANNEL: RawChannel = {
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

describe('diagnostics - translateError', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

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

  it('marks a public channel healthy when it is visible in graph_channels', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [BASE_CHANNEL] })
    vi.spyOn(client.fiberRpc, 'graphChannels').mockResolvedValue({
      channels: [{ channel_outpoint: BASE_CHANNEL.channel_outpoint }],
    })

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('healthy')
    expect(result.healthy).toBe(true)
    expect(result.plain).toContain('visible in the public graph')
  })

  it('paginates graph_channels before deciding a public channel is missing', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [BASE_CHANNEL] })
    vi.spyOn(client.fiberRpc, 'graphChannels')
      .mockResolvedValueOnce({
        channels: [{ channel_outpoint: '0xfirst-page' }],
        last_cursor: '0xcursor-1',
      })
      .mockResolvedValueOnce({
        channels: [{ channel_outpoint: BASE_CHANNEL.channel_outpoint }],
      })

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('healthy')
    expect(result.healthy).toBe(true)
  })

  it('reports gossip delay when a fresh public channel is not yet in graph_channels', async () => {
    vi.setSystemTime(new Date('2026-07-06T12:00:30.000Z'))
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({
      channels: [{ ...BASE_CHANNEL, created_at: `0x${Date.parse('2026-07-06T12:00:00.000Z').toString(16)}` }],
    })
    vi.spyOn(client.fiberRpc, 'graphChannels').mockResolvedValue({ channels: [] })

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('gossip_delay')
    expect(result.healthy).toBe(false)
  })

  it('reports graph_unannounced when an older public channel is still missing from graph_channels', async () => {
    vi.setSystemTime(new Date('2026-07-06T12:05:00.000Z'))
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({
      channels: [{ ...BASE_CHANNEL, created_at: `0x${Date.parse('2026-07-06T12:00:00.000Z').toString(16)}` }],
    })
    vi.spyOn(client.fiberRpc, 'graphChannels').mockResolvedValue({ channels: [] })

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('graph_unannounced')
    expect(result.healthy).toBe(false)
  })

  it('does not require graph visibility for private channels', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({
      channels: [{ ...BASE_CHANNEL, is_public: false }],
    })

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('healthy')
    expect(result.healthy).toBe(true)
    expect(result.plain).toContain('private channel')
  })

  it('reports graph_unverified when graph rpc cannot be queried', async () => {
    vi.spyOn(client.fiberRpc, 'listChannels').mockResolvedValue({ channels: [BASE_CHANNEL] })
    vi.spyOn(client.fiberRpc, 'graphChannels').mockRejectedValue(new Error('graph unavailable'))

    const result = await diagnose(CONFIG, BASE_CHANNEL.channel_id)

    expect(result.code).toBe('graph_unverified')
    expect(result.healthy).toBe(true)
    expect(result.plain).toContain('could not be verified')
  })
})

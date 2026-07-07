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

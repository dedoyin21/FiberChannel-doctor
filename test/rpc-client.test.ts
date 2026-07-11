import { afterEach, describe, expect, it, vi } from 'vitest'
import { rpcCall } from '../src/rpc/client.js'

describe('rpc client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes json-rpc error details for non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ error: { code: -32000, message: 'forbidden by policy' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(rpcCall({ url: 'http://127.0.0.1:8227' }, 'open_channel', [])).rejects.toEqual(expect.objectContaining({
      name: 'RpcError',
      code: 403,
      method: 'open_channel',
      message: expect.stringContaining('forbidden by policy'),
    }))

    await expect(rpcCall({ url: 'http://127.0.0.1:8227' }, 'open_channel', [])).rejects.toThrow(
      'This RPC target may be read-only or require authorization for state-changing methods.',
    )
  })

  it('includes proxy detail text for non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: 'Fiber RPC proxy failed.',
        detail: 'connect ECONNREFUSED 127.0.0.1:8227',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(rpcCall({ url: 'http://127.0.0.1:8227' }, 'list_channels', [])).rejects.toEqual(expect.objectContaining({
      name: 'RpcError',
      code: 502,
      method: 'list_channels',
      message: 'HTTP 502 from Fiber node: connect ECONNREFUSED 127.0.0.1:8227',
    }))
  })

  it('preserves transport failure handling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')))

    await expect(rpcCall({ url: 'http://127.0.0.1:8227' }, 'node_info', [])).rejects.toEqual(expect.objectContaining({
      name: 'RpcError',
      code: -2,
      method: 'node_info',
      message: 'Cannot reach Fiber node at http://127.0.0.1:8227: socket hang up',
    }))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fiberRpc, rpcCall } from '../src/rpc/client.js'

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

  it('adds a bearer authorization header when an auth token is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { version: '0.9.0-rc7', pubkey: '02', features: [], addresses: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await rpcCall(
      { url: 'http://127.0.0.1:8227', authToken: 'demo-token' },
      'node_info',
      [],
    )

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8227', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer demo-token',
      }),
    }))
  })

  it('normalizes list_peers responses from newer Fiber nodes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          peers: [
            {
              pubkey: '0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201',
              address: '/ip4/102.89.34.243/tcp/8228/p2p/QmU2xGRcAu5eeMoiqeqbTP3utQhYKYje8Ycn3Rh1qXHrFu',
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(fiberRpc.listPeers({ url: 'http://127.0.0.1:8227' })).resolves.toEqual({
      peers: [
        {
          peer_id: 'QmU2xGRcAu5eeMoiqeqbTP3utQhYKYje8Ycn3Rh1qXHrFu',
          connected_addr: '/ip4/102.89.34.243/tcp/8228/p2p/QmU2xGRcAu5eeMoiqeqbTP3utQhYKYje8Ycn3Rh1qXHrFu',
          pubkey: '0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201',
        },
      ],
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectPeer } from '../src/network/index.js'
import * as client from '../src/rpc/client.js'

const CONFIG = { url: 'http://127.0.0.1:8227' }
const PEER_ID = 'QmU2xGRcAu5eeMoiqeqbTP3utQhYKYje8Ycn3Rh1qXHrFu'
const MULTIADDR = `/ip4/102.89.34.243/tcp/8228/p2p/${PEER_ID}`

describe('network - connectPeer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('confirms the exact peer id when it appears in list_peers', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers')
      .mockResolvedValueOnce({ peers: [] })
      .mockResolvedValueOnce({ peers: [{ peer_id: PEER_ID, connected_addr: '/ip4/102.89.34.243/tcp/8228', pubkey: null }] })
    vi.spyOn(client.fiberRpc, 'connectPeer').mockResolvedValue()

    const result = await connectPeer(CONFIG, MULTIADDR)

    expect(result.peerId).toBe(PEER_ID)
    expect(result.peer.peer_id).toBe(PEER_ID)
  })

  it('falls back to connected_addr when the node reports the peer under a different id format', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers')
      .mockResolvedValueOnce({ peers: [] })
      .mockResolvedValueOnce({
        peers: [{ peer_id: '0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201', connected_addr: '/ip4/102.89.34.243/tcp/8228', pubkey: null }],
      })
    vi.spyOn(client.fiberRpc, 'connectPeer').mockResolvedValue()

    const result = await connectPeer(CONFIG, MULTIADDR)

    expect(result.peer.peer_id).toBe('0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201')
  })

  it('falls back to the single new peer when the connected address is not exposed', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers')
      .mockResolvedValueOnce({ peers: [{ peer_id: 'QmExisting', connected_addr: '/ip4/1.2.3.4/tcp/8228', pubkey: null }] })
      .mockResolvedValueOnce({
        peers: [
          { peer_id: 'QmExisting', connected_addr: '/ip4/1.2.3.4/tcp/8228', pubkey: null },
          { peer_id: '0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201', connected_addr: null, pubkey: null },
        ],
      })
    vi.spyOn(client.fiberRpc, 'connectPeer').mockResolvedValue()

    const result = await connectPeer(CONFIG, MULTIADDR)

    expect(result.peer.peer_id).toBe('0207142582c15f8bbab144ab35fe340cc62f98ee8e3e63b8b23d7177d4d9909201')
  })

  it('fails with a clearer message when no matching peer can be confirmed', async () => {
    vi.spyOn(client.fiberRpc, 'listPeers')
      .mockResolvedValueOnce({ peers: [] })
      .mockResolvedValueOnce({ peers: [] })
    vi.spyOn(client.fiberRpc, 'connectPeer').mockResolvedValue()

    await expect(connectPeer(CONFIG, MULTIADDR)).rejects.toThrow('may report this peer under a different ID format')
  })
})

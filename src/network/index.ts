import type { Peer, RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'

export interface ConnectPeerResult {
  peerId: string
  peer: Peer
}

export async function connectPeer(config: RpcConfig, multiaddr: string): Promise<ConnectPeerResult> {
  const peerId = extractPeerId(multiaddr)
  const { peers: peersBefore } = await fiberRpc.listPeers(config)
  await fiberRpc.connectPeer(config, multiaddr)
  const { peers: peersAfter } = await fiberRpc.listPeers(config)
  const peer = findConnectedPeer(peersBefore, peersAfter, multiaddr, peerId)
  if (!peer) {
    throw new Error(
      `Peer ${peerId} was not found in list_peers after connect. The node may report this peer under a different ID format, or the connection may have dropped immediately.`,
    )
  }
  return { peerId, peer }
}

function extractPeerId(multiaddr: string): string {
  const match = /\/p2p\/([^/]+)$/.exec(multiaddr)
  if (!match) throw new Error('Invalid multiaddr: expected a trailing /p2p/<peerId> segment.')
  return match[1]
}

function findConnectedPeer(peersBefore: Peer[], peersAfter: Peer[], multiaddr: string, peerId: string): Peer | undefined {
  const exact = peersAfter.find((item) => item.peer_id === peerId)
  if (exact) return exact

  const endpoint = parseEndpoint(multiaddr)
  if (endpoint) {
    const byAddress = peersAfter.find((item) => {
      const connected = item.connected_addr ? parseEndpoint(item.connected_addr) : null
      return connected?.host === endpoint.host && connected.port === endpoint.port
    })
    if (byAddress) return byAddress
  }

  const existingPeerIds = new Set(peersBefore.map((item) => item.peer_id))
  const newPeers = peersAfter.filter((item) => !existingPeerIds.has(item.peer_id))
  if (newPeers.length === 1) return newPeers[0]

  return undefined
}

function parseEndpoint(multiaddr: string): { host: string; port: string } | null {
  const ip4 = /\/ip4\/([^/]+)\/tcp\/([^/]+)/.exec(multiaddr)
  if (ip4) return { host: ip4[1], port: ip4[2] }

  const dns = /\/dns(?:4|6)?\/([^/]+)\/tcp\/([^/]+)/.exec(multiaddr)
  if (dns) return { host: dns[1], port: dns[2] }

  const ip6 = /\/ip6\/([^/]+)\/tcp\/([^/]+)/.exec(multiaddr)
  if (ip6) return { host: ip6[1], port: ip6[2] }

  return null
}

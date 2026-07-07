import type { Peer, RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'

export interface ConnectPeerResult {
  peerId: string
  peer: Peer
}

export async function connectPeer(config: RpcConfig, multiaddr: string): Promise<ConnectPeerResult> {
  const peerId = extractPeerId(multiaddr)
  await fiberRpc.connectPeer(config, multiaddr)
  const { peers } = await fiberRpc.listPeers(config)
  const peer = peers.find((item) => item.peer_id === peerId)
  if (!peer) throw new Error(`Peer ${peerId} was not found in list_peers after connect.`)
  return { peerId, peer }
}

function extractPeerId(multiaddr: string): string {
  const match = /\/p2p\/([^/]+)$/.exec(multiaddr)
  if (!match) throw new Error('Invalid multiaddr: expected a trailing /p2p/<peerId> segment.')
  return match[1]
}

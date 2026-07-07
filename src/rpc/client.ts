export interface RpcConfig {
  url: string
  timeout?: number
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly method: string,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

let _requestId = 0

export async function rpcCall<T>(
  config: RpcConfig,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const id = ++_requestId
  const timeout = config.timeout ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    })
    if (!res.ok) throw new RpcError(`HTTP ${res.status} from Fiber node`, res.status, method)
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } }
    if (json.error) throw new RpcError(json.error.message, json.error.code, method)
    return json.result as T
  } catch (err) {
    if (err instanceof RpcError) throw err
    if ((err as Error).name === 'AbortError') throw new RpcError(`Timeout after ${timeout}ms`, -1, method)
    throw new RpcError(`Cannot reach Fiber node at ${config.url}: ${(err as Error).message}`, -2, method)
  } finally {
    clearTimeout(timer)
  }
}

export interface Peer { peer_id: string; connected_addr: string | null }
export interface UdtTypeScript { code_hash: string; hash_type: 'type' | 'data' | 'data1'; args: string }
export interface NodeInfo {
  version: string
  commit_hash?: string
  pubkey: string
  features: string[]
  node_name?: string | null
  addresses: string[]
  chain_hash?: string
  open_channel_auto_accept_min_ckb_funding_amount?: string
  auto_accept_channel_ckb_funding_amount?: string
  tlc_expiry_delta?: string
  tlc_min_value?: string
  tlc_fee_proportional_millionths?: string
  channel_count?: string
  pending_channel_count?: string
  peers_count?: string
  udt_cfg_infos?: unknown
}
export interface GraphChannelInfo {
  channel_outpoint: unknown
  node1?: string
  node2?: string
  created_timestamp?: string
  capacity?: string
  chain_hash?: string
  udt_type_script?: UdtTypeScript | null
}
export interface ChannelState {
  state_name: 'WAITING_TLC_ACK' | 'AWAITING_TX_SIGNATURES' | 'AWAITING_CHANNEL_READY' | 'CHANNEL_READY' | 'SHUTTING_DOWN' | 'CLOSED' | 'FAILED'
  state_flags: string[]
}
export interface RawChannel {
  channel_id: string; is_public: boolean; channel_outpoint: string; peer_id: string
  funding_udt_type_script: UdtTypeScript | null; state: ChannelState
  local_balance: string; offered_tlc_balance: string; remote_balance: string
  received_tlc_balance: string; latest_commitment_transaction_hash: string
  created_at: string; enabled: boolean; tlc_expiry_delta: string; tlc_fee_proportional_millionths: string
}
export type PaymentStatus = 'Created' | 'InFlight' | 'Succeeded' | 'Failed'
export interface RawPayment {
  payment_hash: string; status: PaymentStatus; created_at: string
  last_updated_at: string; failed_error: string | null; fee: string
}

export const fiberRpc = {
  nodeInfo: (cfg: RpcConfig) => rpcCall<NodeInfo>(cfg, 'node_info', []),
  graphChannels: (cfg: RpcConfig, params: { limit?: string; after?: string } = {}) =>
    rpcCall<{ channels: GraphChannelInfo[]; last_cursor?: string }>(cfg, 'graph_channels', [params]),
  listPeers: (cfg: RpcConfig) => rpcCall<{ peers: Peer[] }>(cfg, 'list_peers', [{}]),
  connectPeer: (cfg: RpcConfig, address: string, save = true) => rpcCall<void>(cfg, 'connect_peer', [{ address, save }]),
  openChannel: (cfg: RpcConfig, params: { peer_id: string; funding_amount: string; public?: boolean; funding_udt_type_script?: UdtTypeScript }) =>
    rpcCall<{ temporary_channel_id: string }>(cfg, 'open_channel', [params]),
  listChannels: (cfg: RpcConfig, peer_id?: string) =>
    rpcCall<{ channels: RawChannel[] }>(cfg, 'list_channels', [peer_id ? { peer_id } : {}]),
  sendPayment: (cfg: RpcConfig, params: { invoice?: string; amount?: string; payment_hash?: string; dry_run?: boolean }) =>
    rpcCall<RawPayment>(cfg, 'send_payment', [params]),
  getPayment: (cfg: RpcConfig, payment_hash: string) => rpcCall<RawPayment>(cfg, 'get_payment', [{ payment_hash }]),
  closeChannel: (cfg: RpcConfig, channel_id: string, force = false) => rpcCall<void>(cfg, 'close_channel', [{ channel_id, force }]),
}

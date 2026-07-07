import type { PaymentStatus, RawPayment, RpcConfig } from '../rpc/client.js'
import { fiberRpc } from '../rpc/client.js'
import { hexToBigInt } from '../resolver/index.js'

const PAYMENT_POLL_INTERVAL_MS = 2_000
const PAYMENT_TIMEOUT_MS = 120_000

export interface TrackPaymentProgress {
  status: PaymentStatus
  elapsedMs: number
  payment: RawPayment
}

export interface TrackPaymentResult {
  paymentHash: string
  status: 'Succeeded' | 'Failed'
  elapsedMs: number
  fee: bigint
  failedError: string | null
  payment: RawPayment
}

export async function trackPayment(
  config: RpcConfig,
  paymentHash: string,
  onProgress: (progress: TrackPaymentProgress) => void = () => {},
): Promise<TrackPaymentResult> {
  const startedAt = Date.now()
  const deadline = startedAt + PAYMENT_TIMEOUT_MS

  while (true) {
    const payment = await fiberRpc.getPayment(config, paymentHash)
    const elapsedMs = Date.now() - startedAt
    onProgress({ status: payment.status, elapsedMs, payment })

    if (payment.status === 'Succeeded' || payment.status === 'Failed') {
      return {
        paymentHash,
        status: payment.status,
        elapsedMs,
        fee: hexToBigInt(payment.fee),
        failedError: payment.failed_error,
        payment,
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(`Payment ${paymentHash} did not complete within 120s.`)
    }

    await sleep(PAYMENT_POLL_INTERVAL_MS)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

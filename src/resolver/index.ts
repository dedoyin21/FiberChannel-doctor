export interface AssetInfo { name: string; symbol: string; decimals: number }

const KNOWN_ASSETS: Record<string, AssetInfo> = {
  '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a:0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b':
    { name: 'RUSD', symbol: 'RUSD', decimals: 8 },
}

export const CKB_ASSET: AssetInfo = { name: 'CKB', symbol: 'CKB', decimals: 8 }
export const CHANNEL_RESERVE_SHANNON = 6_200_000_000n

export function resolveAsset(script: { code_hash: string; args: string } | null): AssetInfo {
  if (!script) return CKB_ASSET
  const key = `${script.code_hash.toLowerCase()}:${script.args.toLowerCase()}`
  return KNOWN_ASSETS[key] ?? { name: 'UNKNOWN', symbol: '???', decimals: 8 }
}

export function hexToBigInt(hex: string): bigint { return BigInt(hex) }

export function formatAmount(shannon: bigint, asset: AssetInfo): string {
  const divisor = 10n ** BigInt(asset.decimals)
  const whole = shannon / divisor
  const frac = shannon % divisor
  return `${whole}.${frac.toString().padStart(asset.decimals, '0')} ${asset.symbol}`
}

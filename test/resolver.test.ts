import { describe, it, expect } from 'vitest'
import { resolveAsset, formatAmount, hexToBigInt, CKB_ASSET, CHANNEL_RESERVE_SHANNON } from '../src/resolver/index.js'

describe('resolver', () => {
  it('resolves null script to CKB', () => { expect(resolveAsset(null)).toEqual(CKB_ASSET) })
  it('resolves known RUSD script', () => {
    expect(resolveAsset({ code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a', args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b' }).name).toBe('RUSD')
  })
  it('returns UNKNOWN for unrecognised script', () => { expect(resolveAsset({ code_hash: '0xdeadbeef', args: '0x1234' }).name).toBe('UNKNOWN') })
  it('decodes hex shannon to bigint', () => { expect(hexToBigInt('0xa32aef600')).toBe(43_800_000_000n) })
  it('formats CKB amount correctly', () => { expect(formatAmount(43_800_000_000n, CKB_ASSET)).toBe('438.00000000 CKB') })
  it('channel reserve is 62 CKB', () => { expect(CHANNEL_RESERVE_SHANNON).toBe(6_200_000_000n) })
})

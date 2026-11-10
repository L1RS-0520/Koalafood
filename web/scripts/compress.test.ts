// 压缩算法单元自测（纯逻辑，编码器注入）：node --test --experimental-strip-types scripts/compress.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPRESS, CompressError, pickEncoding } from '../src/lib/compress.ts'

/** 假编码器：体积 ≈ 像素数 × 系数 × 质量 */
const fake = (bytesPerPx: number) => {
  const calls: { w: number; h: number; q: number }[] = []
  const enc = async (w: number, h: number, q: number) => {
    calls.push({ w, h, q })
    return { size: Math.round(w * h * bytesPerPx * q) }
  }
  return { enc, calls }
}

test('常量：长边 1600、目标 500KB、上限 1MB', () => {
  assert.equal(COMPRESS.maxSide, 1600)
  assert.equal(COMPRESS.targetBytes, 500 * 1024)
  assert.equal(COMPRESS.hardMaxBytes, 1024 * 1024)
})

test('大图先缩到长边 1600，再按质量找到 ≤500KB', async () => {
  const { enc, calls } = fake(0.5)
  const r = await pickEncoding(4032, 3024, enc)
  assert.equal(Math.max(r.w, r.h), 1600)
  assert.equal(r.h, Math.round(3024 * (1600 / 4032)))
  assert.ok(r.result.size <= COMPRESS.targetBytes)
  assert.equal(calls[0].q, COMPRESS.qualities[0]) // 从最高质量开始试
})

test('小图不放大', async () => {
  const { enc } = fake(0.1)
  const r = await pickEncoding(800, 600, enc)
  assert.deepEqual([r.w, r.h], [800, 600])
})

test('先降质量再缩尺寸：同一尺寸把质量试完才缩小', async () => {
  const { enc, calls } = fake(3) // 很难压
  const r = await pickEncoding(1600, 1200, enc)
  const firstSizeCalls = calls.filter((c) => c.w === 1600)
  assert.equal(firstSizeCalls.length, COMPRESS.qualities.length)
  assert.ok(r.w < 1600)
  assert.ok(r.result.size <= COMPRESS.hardMaxBytes)
})

test('到不了 500KB 但有 ≤1MB 的，取该尺寸下画质最高的那个', async () => {
  // 1600x1200 × 0.6 × q：q=0.82 → 944KB(≤1MB)，最低 q=0.42 → 483KB(<500KB) 会命中目标
  // 构造：目标设很低，迫使走“best”分支
  const { enc } = fake(0.6)
  const r = await pickEncoding(1600, 1200, enc, { targetBytes: 10 })
  assert.equal(r.q, COMPRESS.qualities[0])
  assert.ok(r.result.size <= COMPRESS.hardMaxBytes)
  assert.equal(r.w, 1600)
})

test('结果必然 ≤1MB；实在压不下抛 TOO_BIG', async () => {
  const enc = async () => ({ size: 5 * 1024 * 1024 })
  await assert.rejects(
    () => pickEncoding(1600, 1200, enc),
    (e: unknown) => e instanceof CompressError && e.code === 'TOO_BIG',
  )
})

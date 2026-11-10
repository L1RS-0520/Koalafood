// 压缩算法单元自测（纯逻辑，编码器注入）：node --test --experimental-strip-types scripts/compress.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMPRESS, CompressError, compressPct, compressProblem, extLabel, mb1, pickEncoding, precheckPhoto, PROBLEM_TEXT } from '../src/lib/compress.ts'
import { heicPhotoText, tooBigPhotoText } from '../src/api/contract.ts'

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

// —— round-2：不合格照片进网格标红 + 每张压缩进度 ——

test('TOO_BIG 带上能压到的最小体积（用来写“压完 1.3MB”）', async () => {
  let n = 0
  const enc = async () => ({ size: 2 * 1024 * 1024 - n++ * 1000 })
  await assert.rejects(
    () => pickEncoding(1600, 1200, enc),
    (e: unknown) => e instanceof CompressError && e.code === 'TOO_BIG' && e.bytes === 2 * 1024 * 1024 - (n - 1) * 1000,
  )
})

test('onTry 每编码一次回调一次，次数和 tries 一致', async () => {
  const seen: number[] = []
  const { enc } = fake(3)
  const r = await pickEncoding(1600, 1200, enc, { onTry: (t) => seen.push(t) })
  assert.deepEqual(seen, Array.from({ length: r.tries }, (_, i) => i + 1))
})

test('compressPct：15 起步、单调递增、压缩中不到 100', () => {
  let prev = compressPct(0)
  assert.equal(prev, 15)
  for (let t = 1; t < 60; t++) {
    const p = compressPct(t)
    assert.ok(p >= prev && p <= 95, `t=${t} p=${p}`)
    prev = p
  }
})

test('precheckPhoto：HEIC（按 MIME 或扩展名）→ 格式不支持 + 定稿文案，不能预览', () => {
  for (const f of [{ name: 'IMG_2034.HEIC', type: 'image/heic', size: 100 }, { name: 'a.heif', type: '', size: 100 }]) {
    const p = precheckPhoto(f)!
    assert.equal(p.kind, 'heic')
    assert.equal(p.tag, '格式不支持')
    assert.equal(p.detail, heicPhotoText(f.name))
    assert.ok(p.noPreview)
  }
})

test('precheckPhoto：超 10MB（10,485,760 字节为界）→ 超过 10MB + 定稿文案，可以预览', () => {
  assert.equal(precheckPhoto({ name: 'ok.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 }), null)
  const p = precheckPhoto({ name: 'IMG_1988.jpg', type: 'image/jpeg', size: 12.4 * 1024 * 1024 })!
  assert.equal(p.kind, 'tooBig')
  assert.equal(p.tag, '超过 10MB')
  assert.equal(p.detail, tooBigPhotoText('IMG_1988.jpg', 12.4))
  assert.equal(p.detail, '「IMG_1988.jpg」有 12.4 MB，超过 10MB 了，换一张小一点的吧')
  assert.ok(!p.noPreview)
})

test('precheckPhoto：gif/pdf 等 → 格式不支持；jpg/png/webp 合格', () => {
  assert.equal(precheckPhoto({ name: 'a.gif', type: 'image/gif', size: 10 })!.kind, 'type')
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(precheckPhoto({ name: 'a', type, size: 10 }), null)
})

test('compressProblem：压完仍 >1MB → “压完 1.3MB” + 设计原文 + “文件名 · 压缩后 1.3MB”', () => {
  const p = compressProblem('IMG_2101.jpg', new CompressError('TOO_BIG', 'x', Math.round(1.3 * 1024 * 1024)))
  assert.equal(p.kind, 'compressedTooBig')
  assert.equal(p.tag, '压完 1.3MB')
  assert.equal(p.detail, '这张压缩后还是超过 1MB，传不上去，换一张或删掉它吧')
  assert.equal(p.detail, PROBLEM_TEXT.compressedTooBig)
  assert.equal(p.meta, 'IMG_2101.jpg · 压缩后 1.3MB')
})

test('compressProblem：解码失败 → 打不开，不能预览；HEIC 解码失败按格式不支持', () => {
  const p = compressProblem('x.jpg', new CompressError('DECODE', '「x.jpg」打不开'))
  assert.equal(p.tag, '打不开')
  assert.ok(p.noPreview)
  assert.equal(compressProblem('y.heic', new CompressError('DECODE', heicPhotoText('y.heic'))).tag, '格式不支持')
  assert.equal(compressProblem('z.jpg', new Error('boom')).detail, '「z.jpg」处理失败，换一张试试')
})

test('mb1 / extLabel', () => {
  assert.equal(mb1(1.3 * 1024 * 1024), '1.3MB')
  assert.equal(extLabel('IMG_2034.HEIC'), 'HEIC')
  assert.equal(extLabel('noext'), '文件')
})

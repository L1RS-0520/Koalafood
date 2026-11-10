// 定稿文案单元测试（产品审核 round-1 第三节 ②）：node --test --experimental-strip-types scripts/copy.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONFIRMED_TEXT, isHeic, PHOTO_TEXT, STORAGE_ERROR_TEXT, STORAGE_TEXT } from '../src/api/contract.ts'

test('HEIC 提示：§12-5 原文前加文件名', () => {
  assert.equal(PHOTO_TEXT.heic('IMG_0001.HEIC'), '「IMG_0001.HEIC」是 HEIC 格式，请换成 JPG/PNG（iPhone 可在 设置-相机-格式 选‘兼容性最佳’）')
})

test('原图超 10MB：X 保留 1 位小数', () => {
  assert.equal(PHOTO_TEXT.tooBig('big.jpg', 12.34 * 1024 * 1024), '「big.jpg」有 12.3 MB，超过 10MB 了，换一张小一点的吧')
  assert.equal(PHOTO_TEXT.tooBig('a.png', 10 * 1024 * 1024 + 1), '「a.png」有 10.0 MB，超过 10MB 了，换一张小一点的吧')
})

test('isHeic：按 MIME 或扩展名', () => {
  assert.ok(isHeic({ type: 'image/heic', name: 'x' }))
  assert.ok(isHeic({ type: '', name: 'IMG.HEIF' }))
  assert.ok(!isHeic({ type: 'image/jpeg', name: 'a.jpg' }))
})

test('429 副文案：上传页和编辑页分开', () => {
  assert.equal(STORAGE_TEXT.quotaHintUpload, '已填写的内容都还在，不用重填，明天直接点上传就行')
  assert.equal(STORAGE_TEXT.quotaHint, '已填写的内容都还在，不用重填；不加新照片的修改照常可以保存')
  assert.equal(STORAGE_ERROR_TEXT.STORAGE_QUOTA, '今天食堂的照片柜塞满啦，明天再来传吧～')
})

test('507 弹框标题和正文', () => {
  assert.equal(STORAGE_ERROR_TEXT.STORAGE_FULL, '照片柜满啦，删掉一些旧照片才能继续上传～')
  assert.equal(STORAGE_TEXT.fullBody, '这次填的内容都还在，删掉一些不要的照片后，再点保存就行。')
})

test('容量提示 §12-24', () => {
  assert.equal(STORAGE_TEXT.danger, '照片柜快满啦（已用 95%），赶紧删掉一些旧照片吧')
  assert.equal(STORAGE_TEXT.hint, '在菜品编辑页可以删掉不要的照片')
})

test('确认后提示 §5.7', () => {
  assert.equal(CONFIRMED_TEXT, '已确认，菜谱上线啦！')
})

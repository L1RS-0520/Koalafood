-- 存储用量：照片字节数（容量上限 STORAGE_LIMIT_BYTES）+ KV 每天写入/删除次数（KV_DAILY_WRITE_LIMIT）
ALTER TABLE dish_photos ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orphan_photos ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
-- D1 存储方式下可直接回填；KV/R2 存储方式用 scripts/backfill-photo-sizes 回填
UPDATE dish_photos SET size = (SELECT b.size FROM photo_blobs b WHERE b.key = dish_photos.r2_key)
  WHERE size = 0 AND EXISTS (SELECT 1 FROM photo_blobs b WHERE b.key = dish_photos.r2_key);

-- 每个 UTC 日（与 Cloudflare 免费额度 00:00 UTC 重置对齐）对 KV 的 put + delete 次数
CREATE TABLE IF NOT EXISTS kv_usage (
  day  TEXT PRIMARY KEY,          -- YYYY-MM-DD（UTC）
  ops  INTEGER NOT NULL DEFAULT 0
);

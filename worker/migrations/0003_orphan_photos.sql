-- 删除照片时存储侧删除失败（如 KV 当天删除额度用完）的键，D1 里菜和照片记录已删；
-- 下次有写入操作时后台顺手重试清理，成功后从本表移除。
CREATE TABLE IF NOT EXISTS orphan_photos (
  key         TEXT PRIMARY KEY,
  store       TEXT NOT NULL,          -- kv | r2 | d1
  reason      TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  last_try_at TEXT
);

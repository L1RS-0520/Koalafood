-- PHOTO_STORE=d1 时使用：照片二进制存 D1（其他存储方式下此表为空，不占空间）
-- D1 单行/BLOB 上限 2,000,000 字节，后端单张照片上限 1MB（1,048,576 字节）
CREATE TABLE IF NOT EXISTS photo_blobs (
  key           TEXT PRIMARY KEY,      -- 与 dish_photos.r2_key 相同：uuid.扩展名
  content_type  TEXT NOT NULL,
  size          INTEGER NOT NULL,
  data          BLOB NOT NULL,
  created_at    TEXT NOT NULL
);

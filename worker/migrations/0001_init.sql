-- 考拉食堂 初始表结构（接口约定 v2.1 最终定稿 + v2.2 多图：厨驼写菜谱 + 手写保底；已去掉 Workers AI）
CREATE TABLE IF NOT EXISTS dishes (
  id                 TEXT PRIMARY KEY,                -- UUID
  name               TEXT NOT NULL,                   -- 菜名 ≤30 字
  category           TEXT NOT NULL,                   -- 六个固定分类之一
  note               TEXT,                            -- 备注 ≤200 字，可空
  -- 正式内容（顶层展示）
  ingredients        TEXT NOT NULL DEFAULT '[]',      -- JSON: [{name,amount}]
  steps              TEXT NOT NULL DEFAULT '[]',      -- JSON: [{text,heat,time,caption}]
  tips               TEXT NOT NULL DEFAULT '[]',      -- JSON: [string]
  servings           TEXT,
  total_time         TEXT,
  source             TEXT NOT NULL DEFAULT 'manual',  -- chef | manual（正式内容来源）
  -- 厨驼任务
  chef_status        TEXT NOT NULL DEFAULT 'confirmed', -- pending | draft | confirmed
  draft              TEXT,                            -- JSON，仅 draft 状态非空：{ingredients,steps,tips,servings,total_time,chef_message}
  requested_note     TEXT,                            -- 大王给厨驼的要求（ask-chef 的 note）
  chef_requested_at  TEXT,
  claimed_at         TEXT,
  draft_at           TEXT,                            -- 厨驼交稿时间
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dishes_created ON dishes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dishes_category_created ON dishes(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dishes_chef ON dishes(chef_status, chef_requested_at);

-- 菜品照片（v2.2：每道菜 1–9 张，position 最小的为封面）
CREATE TABLE IF NOT EXISTS dish_photos (
  id            TEXT PRIMARY KEY,                     -- UUID
  dish_id       TEXT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,                 -- R2 对象键：uuid.扩展名
  content_type  TEXT NOT NULL,
  position      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dish_photos_dish ON dish_photos(dish_id, position);

-- 简单键值设置（chef_enabled 等）
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('chef_enabled', 'true');

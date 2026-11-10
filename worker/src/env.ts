export interface Env {
  DB: D1Database;
  PHOTOS?: R2Bucket;           // PHOTO_STORE=r2（只在 --env r2 时绑定）
  PHOTOS_KV?: KVNamespace;     // PHOTO_STORE=kv
  KV_DAILY_WRITE_LIMIT?: string; // KV 每个 UTC 日 put+delete 上限，默认 1000（本地测试可设 5）
  STORAGE_LIMIT_BYTES?: string;  // 照片总容量安全上限，默认 996147200（950MB，1024 进制）
  STORAGE_USED_SIM?: string;     // 本地模拟已用字节数（线上=配了 ACCESS_TEAM_DOMAIN 时忽略）
  PHOTO_STORE?: string;        // kv（默认）| r2 | d1
  ASSETS: Fetcher;
  CHEF_KEY?: string;
  CHEF_CLAIM_TTL_MIN?: string;
  CHEF_MOCK?: string;
  DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

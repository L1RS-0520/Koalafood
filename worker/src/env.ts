export interface Env {
  DB: D1Database;
  PHOTOS?: R2Bucket;           // PHOTO_STORE=r2
  PHOTOS_KV?: KVNamespace;     // PHOTO_STORE=kv
  PHOTO_STORE?: string;        // kv（默认）| r2 | d1
  ASSETS: Fetcher;
  CHEF_KEY?: string;
  CHEF_CLAIM_TTL_MIN?: string;
  CHEF_MOCK?: string;
  DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  CHEF_KEY?: string;
  CHEF_CLAIM_TTL_MIN?: string;
  CHEF_MOCK?: string;
  DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

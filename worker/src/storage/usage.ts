/**
 * 存储用量守门（在生成器/存储实现之外的一层）：
 * - 容量：SUM(dish_photos.size) + SUM(orphan_photos.size) + 本次字节 > STORAGE_LIMIT_BYTES → 507 STORAGE_FULL
 * - 次数：KV 每个 UTC 日的 put+delete 次数（kv_usage 表）+ 本次次数 > KV_DAILY_WRITE_LIMIT → 429 STORAGE_QUOTA
 * 两项都在写任何照片之前检查，保证不写一半。
 */
import type { Env } from "../env.ts";
import { isLocalEnv } from "../auth.ts";

/** 容量上限 950MB（1024 进制：950×1024×1024 = 996,147,200 字节；KV 免费版总容量 1 GB，留余量）。
 * 线上固定用这个值；STORAGE_LIMIT_BYTES 只在本地生效（调小测 507） */
export const DEFAULT_STORAGE_LIMIT_BYTES = 950 * 1024 * 1024; // 996,147,200
/** 默认每天 1,000 次（KV 免费版：写入 1,000 次/天、删除 1,000 次/天；这里把写入+删除合并计数，更保守） */
export const DEFAULT_KV_DAILY_WRITE_LIMIT = 1000;

export class StorageQuotaError extends Error {
  constructor(message = "存储每天的写入额度已用完") { super(message); this.name = "StorageQuotaError"; }
}
export class StorageFullError extends Error {
  constructor(message = "照片仓库已满") { super(message); this.name = "StorageFullError"; }
}

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v !== undefined && v !== "" ? n : d; };
export const storageLimitBytes = (env: Env) => (isLocalEnv(env) ? num(env.STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT_BYTES) : DEFAULT_STORAGE_LIMIT_BYTES);
/** 剩余张数按每张 500KB = 512,000 字节估算 */
export const PHOTO_ESTIMATE_BYTES = 512000;
export const photosLeft = (used: number, limit: number) => Math.floor(Math.max(0, limit - used) / PHOTO_ESTIMATE_BYTES);
/** level：<80% ok；≥80% warn；≥95% danger（danger 只用于红色提示，不等于 STORAGE_FULL，不拦上传；拦不拦只看 已用+本次 > 上限） */
/** 按实际字节判断，不用四舍五入后的 percent：79.96% 显示 80.0 但仍是 ok */
export const capacityLevel = (used: number, limit: number): "ok" | "warn" | "danger" =>
  used * 100 >= limit * 95 ? "danger" : used * 100 >= limit * 80 ? "warn" : "ok";
export const kvDailyLimit = (env: Env) => num(env.KV_DAILY_WRITE_LIMIT, DEFAULT_KV_DAILY_WRITE_LIMIT);
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);


/**
 * 已用字节 = SUM(dish_photos.size) + SUM(orphan_photos.size)。
 * 本地模拟开关 STORAGE_USED_SIM=<字节数>：把已用量直接模拟成这个数（只在本地生效，线上一律忽略）。
 */
export async function usedBytes(env: Env): Promise<{ bytes: number; photos: number; simulated: boolean }> {
  const db = env.DB;
  const a = await db.prepare("SELECT COALESCE(SUM(size),0) AS b, COUNT(*) AS n FROM dish_photos").first<{ b: number; n: number }>();
  const sim = env.STORAGE_USED_SIM?.trim();
  if (sim && isLocalEnv(env) && Number.isFinite(Number(sim)) && Number(sim) >= 0)
    return { bytes: Number(sim), photos: a?.n ?? 0, simulated: true };
  const o = await db.prepare("SELECT COALESCE(SUM(size),0) AS b FROM orphan_photos").first<{ b: number }>();
  return { bytes: (a?.b ?? 0) + (o?.b ?? 0), photos: a?.n ?? 0, simulated: false };
}

export async function opsToday(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT ops FROM kv_usage WHERE day = ?").bind(utcDay()).first<{ ops: number }>();
  return r?.ops ?? 0;
}

export async function opsRemaining(env: Env): Promise<number> {
  return Math.max(0, kvDailyLimit(env) - (await opsToday(env.DB)));
}

export async function addOps(db: D1Database, n = 1) {
  await db.prepare("INSERT INTO kv_usage(day, ops) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ops = ops + excluded.ops")
    .bind(utcDay(), n).run();
}

/** 写照片前的统一检查：同时超时先判容量（507），再判次数（429，仅 KV 计数） */
export async function checkBeforeWrite(env: Env, kind: string, addBytes: number, ops: number) {
  const { bytes } = await usedBytes(env);
  const limit = storageLimitBytes(env);
  if (bytes + addBytes > limit) throw new StorageFullError(`已用 ${bytes} + 本次 ${addBytes} > 上限 ${limit}`);
  if (kind === "kv") await checkOps(env, ops);
}

export async function checkOps(env: Env, ops: number) {
  const used = await opsToday(env.DB), limit = kvDailyLimit(env);
  if (used + ops > limit) throw new StorageQuotaError(`今天 KV 已用 ${used} 次，本次需要 ${ops} 次，上限 ${limit}`);
}

export async function storageReport(env: Env, kind: string) {
  const { bytes, photos } = await usedBytes(env);
  const limit = storageLimitBytes(env);
  const raw = limit > 0 ? (bytes / limit) * 100 : 100;
  const percent = Math.round(raw * 10) / 10;
  return {
    store: kind,
    photo_count: photos,
    capacity: { used_bytes: bytes, limit_bytes: limit, percent, level: capacityLevel(bytes, limit), photos_left: photosLeft(bytes, limit) },
    daily_ops: { used: await opsToday(env.DB), limit: kvDailyLimit(env) },
  };
}

/**
 * 照片存储抽象层（可替换）。路由只依赖 PhotoStore，不直接碰 R2/KV/D1。
 * 用环境变量 PHOTO_STORE 选实现：kv（默认）| r2（备选）| d1。方案对比见 docs/照片存储方案.md。
 * 键：uuid.扩展名（dish_photos.r2_key 列保存，列名沿用 r2_key，实际是“存储键”）。
 */
import type { Env } from "../env.ts";
import { StorageQuotaError, addOps, checkOps } from "./usage.ts";
export { StorageQuotaError };

/**
 * KV 报错统一转换为 StorageQuotaError。依据官方文档：
 * - KV 免费版每天 1,000 次写入、1,000 次删除，超过后“该类操作直接报错”（不扣费），UTC 0 点重置；
 *   https://developers.cloudflare.com/kv/platform/pricing/
 * - 同一个键每秒最多写 1 次，超过抛 429 限流错误；https://developers.cloudflare.com/kv/api/write-key-value-pairs/
 * 官方文档没有给出报错的确切文字，所以按错误信息里的 limit/exceed/quota/429/too many 关键字判断。
 * 另外后端自己按 kv_usage 表计数（见 usage.ts），正常情况下在 KV 报错之前就会先拦下。
 */
const QUOTA_RE = /limit|exceed|quota|429|too many|rate/i;
export function toStorageError(e: unknown): unknown {
  if (e instanceof StorageQuotaError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return QUOTA_RE.test(msg) ? new StorageQuotaError(msg) : e;
}

export interface StoredPhoto { body: ReadableStream | ArrayBuffer; contentType: string; etag: string; size?: number }

export interface PhotoStore {
  readonly kind: "r2" | "kv" | "d1";
  put(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredPhoto | null>;
  delete(key: string): Promise<void>;
}

/** R2：对象存储（备选；开通需绑定付款方式，超免费额度会计费） */
export class R2PhotoStore implements PhotoStore {
  readonly kind = "r2" as const;
  constructor(private bucket: R2Bucket) {}
  async put(key: string, bytes: ArrayBuffer, contentType: string) {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const o = await this.bucket.get(key);
    if (!o) return null;
    return { body: o.body, contentType: o.httpMetadata?.contentType ?? "application/octet-stream", etag: o.httpEtag, size: o.size };
  }
  async delete(key: string) { await this.bucket.delete(key); }
}

/** KV：键值存储（默认）。值 ≤25 MiB；内容类型放 metadata。每次 put/delete 都计入 kv_usage，超上限先拦 */
export class KvPhotoStore implements PhotoStore {
  readonly kind = "kv" as const;
  constructor(private kv: KVNamespace, private env: Env) {}
  async put(key: string, bytes: ArrayBuffer, contentType: string) {
    await checkOps(this.env, 1);
    try { await this.kv.put(`photo:${key}`, bytes, { metadata: { contentType, size: bytes.byteLength } }); }
    catch (e) { throw toStorageError(e); }
    finally { await addOps(this.env.DB, 1); } // 失败的请求也可能被 KV 计数，保守起见都记
  }
  async get(key: string) {
    const r = await this.kv.getWithMetadata<{ contentType?: string; size?: number }>(`photo:${key}`, "arrayBuffer");
    if (!r.value) return null;
    return { body: r.value, contentType: r.metadata?.contentType ?? "application/octet-stream", etag: `"${key}"`, size: r.value.byteLength };
  }
  async delete(key: string) {
    await checkOps(this.env, 1);
    try { await this.kv.delete(`photo:${key}`); }
    catch (e) { throw toStorageError(e); }
    finally { await addOps(this.env.DB, 1); }
  }
}

/** D1：照片 BLOB 存在单独的 photo_blobs 表（单行上限 2,000,000 字节，所以单张必须 ≤1MB） */
export class D1PhotoStore implements PhotoStore {
  readonly kind = "d1" as const;
  constructor(private db: D1Database) {}
  async put(key: string, bytes: ArrayBuffer, contentType: string) {
    await this.db.prepare("INSERT INTO photo_blobs(key, content_type, size, data, created_at) VALUES (?,?,?,?,?)")
      .bind(key, contentType, bytes.byteLength, bytes, new Date().toISOString()).run();
  }
  async get(key: string) {
    const r = await this.db.prepare("SELECT content_type, data FROM photo_blobs WHERE key = ?").bind(key)
      .first<{ content_type: string; data: ArrayBuffer | number[] }>();
    if (!r) return null;
    const body = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data).buffer;
    return { body, contentType: r.content_type, etag: `"${key}"`, size: body.byteLength };
  }
  async delete(key: string) { await this.db.prepare("DELETE FROM photo_blobs WHERE key = ?").bind(key).run(); }
}

export function getPhotoStore(env: Env): PhotoStore {
  const kind = (env.PHOTO_STORE ?? "kv").trim().toLowerCase() || "kv";
  if (kind === "r2") {
    if (!env.PHOTOS) throw new Error("PHOTO_STORE=r2 但没有 R2 绑定 PHOTOS；默认配置不含 R2，本地用 R2 请加 --env r2 启动");
    return new R2PhotoStore(env.PHOTOS);
  }
  if (kind === "kv") {
    if (!env.PHOTOS_KV) throw new Error("PHOTO_STORE=kv 但没有绑定 PHOTOS_KV（KV）");
    return new KvPhotoStore(env.PHOTOS_KV, env);
  }
  if (kind === "d1") return new D1PhotoStore(env.DB);
  throw new Error(`PHOTO_STORE 只能是 r2、kv、d1，现在是 ${kind}`);
}

/**
 * 照片存储抽象层（可替换）。路由只依赖 PhotoStore，不直接碰 R2/KV/D1。
 * 用环境变量 PHOTO_STORE 选实现：kv（默认）| r2（备选）| d1。方案对比见 docs/照片存储方案.md。
 * 键：uuid.扩展名（dish_photos.r2_key 列保存，列名沿用 r2_key，实际是“存储键”）。
 */
import type { Env } from "../env.ts";

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

/** KV：键值存储（默认）。值 ≤25 MiB；内容类型放 metadata。免费版超额直接报错不扣费 */
export class KvPhotoStore implements PhotoStore {
  readonly kind = "kv" as const;
  constructor(private kv: KVNamespace) {}
  async put(key: string, bytes: ArrayBuffer, contentType: string) {
    await this.kv.put(`photo:${key}`, bytes, { metadata: { contentType, size: bytes.byteLength } });
  }
  async get(key: string) {
    const r = await this.kv.getWithMetadata<{ contentType?: string; size?: number }>(`photo:${key}`, "arrayBuffer");
    if (!r.value) return null;
    return { body: r.value, contentType: r.metadata?.contentType ?? "application/octet-stream", etag: `"${key}"`, size: r.value.byteLength };
  }
  async delete(key: string) { await this.kv.delete(`photo:${key}`); }
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
    if (!env.PHOTOS) throw new Error("PHOTO_STORE=r2 但没有绑定 PHOTOS（R2）");
    return new R2PhotoStore(env.PHOTOS);
  }
  if (kind === "kv") {
    if (!env.PHOTOS_KV) throw new Error("PHOTO_STORE=kv 但没有绑定 PHOTOS_KV（KV）");
    return new KvPhotoStore(env.PHOTOS_KV);
  }
  if (kind === "d1") return new D1PhotoStore(env.DB);
  throw new Error(`PHOTO_STORE 只能是 r2、kv、d1，现在是 ${kind}`);
}

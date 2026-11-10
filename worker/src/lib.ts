import type { Context } from "hono";

export const CATEGORIES = ["家常菜", "汤羹", "主食", "小吃点心", "甜品饮品", "其他"] as const;
/** 单张照片服务端上限 1MB（1,048,576 字节）；前端上传前先压缩。D1 单行上限 2MB，所以三种存储都放得下 */
export const MAX_PHOTO_BYTES = 1024 * 1024;
export const NAME_MAX = 30;
export const NOTE_MAX = 200;

export type ErrorCode =
  | "VALIDATION" | "UNAUTHORIZED" | "CHEF_DISABLED" | "NOT_FOUND"
  | "CONFLICT" | "BAD_STATE" | "TOO_LARGE" | "BAD_TYPE" | "STORAGE_QUOTA" | "STORAGE_FULL" | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400, UNAUTHORIZED: 401, CHEF_DISABLED: 403, NOT_FOUND: 404,
  CONFLICT: 409, BAD_STATE: 409, TOO_LARGE: 413, BAD_TYPE: 415, STORAGE_QUOTA: 429, STORAGE_FULL: 507, INTERNAL: 500,
};

/** details 元素：一般是中文字符串；v2.3.3 起「只写了编号」等可定位的问题是对象 {field, index(从 1 起), reason, message} */
export type ErrorDetail = string | { field: string; index: number; reason: string; message: string };

export class ApiError extends Error {
  code: ErrorCode; details?: ErrorDetail[];
  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) { super(message); this.code = code; this.details = details; }
  get status() { return STATUS[this.code]; }
}

export function errorResponse(c: Context, e: ApiError) {
  const body: Record<string, unknown> = { code: e.code, message: e.message };
  if (e.details?.length) body.details = e.details;
  return c.json({ error: body }, e.status as 400);
}

export const charLen = (s: string) => Array.from(s).length;
export const nowIso = () => new Date().toISOString();

export function checkName(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new ApiError("VALIDATION", "请填写菜名");
  const s = v.trim();
  if (charLen(s) > NAME_MAX) throw new ApiError("VALIDATION", `菜名最多 ${NAME_MAX} 个字，现在是 ${charLen(s)} 个字`);
  return s;
}

export function checkCategory(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new ApiError("VALIDATION", "请选择分类");
  const s = v.trim();
  if (!(CATEGORIES as readonly string[]).includes(s))
    throw new ApiError("VALIDATION", `分类只能是：${CATEGORIES.join("、")}`);
  return s;
}

/** 备注：空串/空白 → null */
export function checkNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ApiError("VALIDATION", "备注必须是文字");
  const s = v.trim();
  if (!s) return null;
  if (charLen(s) > NOTE_MAX) throw new ApiError("VALIDATION", `备注最多 ${NOTE_MAX} 个字，现在是 ${charLen(s)} 个字`);
  return s;
}

export function checkShortText(v: unknown, label: string, max = 20): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") throw new ApiError("VALIDATION", `${label}必须是文字`);
  const s = v.trim();
  if (!s) return null;
  if (charLen(s) > max) throw new ApiError("VALIDATION", `${label}最多 ${max} 个字`);
  return s;
}

// ---------- 照片：靠 magic bytes 判断类型 ----------
export interface PhotoInfo { ext: "jpg" | "png" | "webp"; type: string; bytes: ArrayBuffer }

export function sniffImage(buf: Uint8Array): PhotoInfo["ext"] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return "png";
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
const TYPE_OF = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** KB = ceil(字节/1024)，千分位逗号：「照片太大了（1,030KB），上限 1,024KB」；批量时前缀「第 N 张」 */
export const fmtKB = (bytes: number) => Math.ceil(bytes / 1024).toLocaleString("en-US") + "KB";
export const tooLargeMessage = (size: number, index?: number) =>
  `${index ? `第 ${index} 张` : ""}照片太大了（${fmtKB(size)}），上限 ${fmtKB(MAX_PHOTO_BYTES)}`;

export async function readPhoto(v: unknown): Promise<PhotoInfo> {
  if (!v || typeof v === "string" || typeof (v as File).arrayBuffer !== "function")
    throw new ApiError("VALIDATION", "请上传一张菜品照片");
  const f = v as File;
  if (f.size === 0) throw new ApiError("VALIDATION", "照片是空文件，请重新选择");
  if (f.size > MAX_PHOTO_BYTES)
    throw new ApiError("TOO_LARGE", tooLargeMessage(f.size));
  const bytes = await f.arrayBuffer();
  const ext = sniffImage(new Uint8Array(bytes.slice(0, 16)));
  if (!ext) throw new ApiError("BAD_TYPE", "照片格式不支持，只能上传 jpg、png 或 webp 图片");
  return { ext, type: TYPE_OF[ext], bytes };
}

export const PHOTO_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** 恒定时间比较：先各自 SHA-256，长度一致后用 timingSafeEqual */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  // workerd 提供 crypto.subtle.timingSafeEqual
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?(a: ArrayBuffer, b: ArrayBuffer): boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(ha, hb);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** v2.3.3 R1-08：JSON 请求体上限（厨驼交稿 / PATCH / confirm），64KB = 65,536 字节 */
export const MAX_JSON_BYTES = 64 * 1024;
export const bodyTooLargeMessage = (bytes: number) => `内容太大了（${fmtKB(bytes)}），上限 ${MAX_JSON_BYTES / 1024}KB`;

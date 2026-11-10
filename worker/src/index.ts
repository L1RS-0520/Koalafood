/**
 * 考拉食堂 Worker（接口约定 v2.3：读公开 /api/*，写入 /api/kitchen/*，厨驼 /api/chef/*）
 */
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env.ts";
import {
  ApiError, errorResponse, CATEGORIES, checkName, checkCategory, checkNote, checkShortText,
  readPhoto, PHOTO_KEY_RE, safeEqual, nowIso, type PhotoInfo,
} from "./lib.ts";
import { toDish, toTask, draftColumns, getDish, getPhotos, getChefEnabled, type DishRow, type PhotoRow } from "./db.ts";
import { normalizeDraft, type RecipeDraft } from "./generator/draft.ts";
import { mockDraft } from "./generator/mock-chef.ts";
import { getPhotoStore } from "./storage/photo-store.ts";
import { StorageQuotaError, StorageFullError, checkBeforeWrite, storageReport } from "./storage/usage.ts";
import { getViewer, accessConfigured, devAuthEnabled, DEV_COOKIE, type Viewer } from "./auth.ts";

type Vars = { viewer: Viewer };
type C = Context<{ Bindings: Env; Variables: Vars }>;
const app = new Hono<{ Bindings: Env; Variables: Vars }>();
const MAX_PHOTOS = 9;
const CHEF_MOCK_DELAY_MS = 20_000;

// ---------- 通用 ----------
const STORAGE_QUOTA_MSG = "今天传太多了，明天再传";
const STORAGE_FULL_MSG = "食堂的照片仓库满了，先删点旧照片";
app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c, err);
  if (err instanceof StorageFullError) {
    console.warn("存储容量：", err.message);
    return errorResponse(c, new ApiError("STORAGE_FULL", STORAGE_FULL_MSG));
  }
  if (err instanceof StorageQuotaError) {
    console.warn("存储额度：", err.message);
    return errorResponse(c, new ApiError("STORAGE_QUOTA", STORAGE_QUOTA_MSG));
  }
  console.error("未处理错误", err);
  return errorResponse(c, new ApiError("INTERNAL", "服务器开小差了，请稍后再试"));
});
app.notFound((c) => errorResponse(c, new ApiError("NOT_FOUND", "没有这个接口")));

// 开发期 CORS 放开（配置了 Access 的线上环境不放开）
app.use("/api/*", async (c, next) => {
  if (accessConfigured(c.env)) return next();
  return cors({
    origin: (o) => o || "*", credentials: true,
    allowHeaders: ["Content-Type", "X-Chef-Key"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })(c, next);
});

app.use("/api/*", async (c, next) => { c.set("viewer", await getViewer(c.req.raw, c.env)); await next(); });

async function readJson(c: C): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new ApiError("VALIDATION", "请求内容不是合法的 JSON"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ApiError("VALIDATION", "请求内容必须是 JSON 对象");
  return v as Record<string, unknown>;
}
async function readForm(c: C): Promise<FormData> {
  try { return await c.req.formData(); }
  catch { throw new ApiError("VALIDATION", "请用 multipart/form-data 格式提交（含照片）"); }
}
async function mustDish(db: D1Database, id: string): Promise<DishRow> {
  const d = await getDish(db, id);
  if (!d) throw new ApiError("NOT_FOUND", "这道菜不存在，可能已经被删除了");
  return d;
}
async function dishJson(c: C, id: string, full?: boolean) {
  const d = await mustDish(c.env.DB, id);
  const dish = toDish(d, await getPhotos(c.env.DB, id));
  if (!(full ?? c.get("viewer").logged_in)) { dish.draft = null; dish.requested_note = null; }
  return dish;
}

// ---------- 照片 ----------
async function readPhotos(form: FormData, min: number, max: number): Promise<PhotoInfo[]> {
  if (form.has("photo")) throw new ApiError("VALIDATION", "照片字段名已改为 photos（可重复），请不要再用 photo");
  const files = form.getAll("photos").filter((f) => typeof f !== "string" || f !== "");
  if (files.length < min) throw new ApiError("VALIDATION", "请至少上传 1 张菜品照片");
  if (files.length > max) throw new ApiError("VALIDATION", `照片最多 ${MAX_PHOTOS} 张，这次最多还能传 ${max} 张`);
  const out: PhotoInfo[] = [];
  for (const [i, f] of files.entries()) {
    try { out.push(await readPhoto(f)); }
    catch (e) {
      if (e instanceof ApiError && files.length > 1) throw new ApiError(e.code, `第 ${i + 1} 张照片：${e.message}`);
      throw e;
    }
  }
  return out;
}
async function putPhotos(env: Env, dishId: string, photos: PhotoInfo[], startPos: number) {
  const store = getPhotoStore(env);
  // 写任何照片之前：先容量（507），再每天次数（429）
  await checkBeforeWrite(env, store.kind, photos.reduce((s, p) => s + p.bytes.byteLength, 0), photos.length);
  const now = nowIso();
  const rows: PhotoRow[] = [];
  try {
    for (const [i, p] of photos.entries()) {
      const key = `${crypto.randomUUID()}.${p.ext}`;
      await store.put(key, p.bytes, p.type);
      rows.push({ id: crypto.randomUUID(), dish_id: dishId, r2_key: key, content_type: p.type, size: p.bytes.byteLength, position: startPos + i, created_at: now });
    }
  } catch (e) {
    await removeStored(env, rows.map((r) => ({ key: r.r2_key, size: r.size })), "上传中途失败的清理");
    throw e;
  }
  return rows;
}

/** 删存储里的照片：尽力而为；失败（含额度用完）记进 orphan_photos，下次写入时后台重试。永不抛错 */
async function removeStored(env: Env, items: { key: string; size: number }[], reason: string) {
  const store = getPhotoStore(env);
  const now = nowIso();
  for (const { key, size } of items) {
    try { await store.delete(key); }
    catch (e) {
      console.warn("照片删除失败，记为孤儿待重试", key, (e as Error).message);
      try {
        await env.DB.prepare(`INSERT INTO orphan_photos(key, store, size, reason, attempts, created_at) VALUES (?,?,?,?,0,?)
          ON CONFLICT(key) DO UPDATE SET reason=excluded.reason`).bind(key, store.kind, size, `${reason}：${(e as Error).message}`.slice(0, 300), now).run();
      } catch (e2) { console.error("记录孤儿照片失败", key, (e2 as Error).message); }
    }
  }
}

/** 顺手重试清理孤儿照片（每次最多 20 个），在写入请求结束后后台执行 */
async function retryOrphans(env: Env) {
  const r = await env.DB.prepare("SELECT key FROM orphan_photos ORDER BY created_at LIMIT 20").all<{ key: string }>();
  if (!r.results.length) return;
  const store = getPhotoStore(env);
  for (const { key } of r.results) {
    try {
      await store.delete(key);
      await env.DB.prepare("DELETE FROM orphan_photos WHERE key=?").bind(key).run();
    } catch (e) {
      await env.DB.prepare("UPDATE orphan_photos SET attempts=attempts+1, last_try_at=? WHERE key=?").bind(nowIso(), key).run();
      if (e instanceof StorageQuotaError) break; // 额度没恢复，别再浪费
    }
  }
}
const insertPhotoStmts = (db: D1Database, rows: PhotoRow[]) => rows.map((r) =>
  db.prepare("INSERT INTO dish_photos(id,dish_id,r2_key,content_type,size,position,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(r.id, r.dish_id, r.r2_key, r.content_type, r.size, r.position, r.created_at));

app.get("/api/photos/:key", async (c) => {
  const key = c.req.param("key")!;
  if (!PHOTO_KEY_RE.test(key)) throw new ApiError("NOT_FOUND", "照片不存在");
  // 只给 dish_photos 里登记着的照片：已删除但存储里还没清掉的孤儿照片不再对外可见
  const reg = await c.env.DB.prepare("SELECT 1 AS x FROM dish_photos WHERE r2_key = ?").bind(key).first();
  if (!reg) throw new ApiError("NOT_FOUND", "照片不存在");
  return servePhoto(c, key);
});
async function servePhoto(c: C, key: string) {
  const obj = await getPhotoStore(c.env).get(key);
  if (!obj) throw new ApiError("NOT_FOUND", "照片不存在");
  const h = new Headers();
  h.set("Content-Type", obj.contentType);
  h.set("ETag", obj.etag);
  h.set("Cache-Control", "public, max-age=31536000, immutable"); // 键是 uuid，不复用
  return new Response(obj.body, { headers: h });
}

// ---------- CHEF_MOCK 联调：惰性把 pending 满 20 秒的菜写成示例草稿 ----------
async function runChefMock(env: Env) {
  if (env.CHEF_MOCK !== "1") return;
  const cutoff = new Date(Date.now() - CHEF_MOCK_DELAY_MS).toISOString();
  const r = await env.DB.prepare("SELECT * FROM dishes WHERE chef_status='pending' AND chef_requested_at <= ? LIMIT 10").bind(cutoff).all<DishRow>();
  for (const d of r.results) {
    const draft = mockDraft({ name: d.name, category: d.category, note: d.note, requested_note: d.requested_note });
    const now = nowIso();
    await env.DB.prepare("UPDATE dishes SET chef_status='draft', draft=?, draft_at=?, claimed_at=NULL, updated_at=? WHERE id=? AND chef_status='pending'")
      .bind(JSON.stringify(draft), now, now, d.id).run();
  }
}
const chefMockMw = async (c: C, next: Next) => { await runChefMock(c.env); await next(); };

// ---------- 公开读 ----------
app.get("/api/health", chefMockMw, async (c) => {
  const p = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM dishes WHERE chef_status='pending'").first<{ n: number }>();
  const o = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orphan_photos").first<{ n: number }>().catch(() => null);
  return c.json({ ok: true, chef_enabled: await getChefEnabled(c.env.DB), chef_pending: p?.n ?? 0, chef_mock: c.env.CHEF_MOCK === "1", photo_store: getPhotoStore(c.env).kind, orphan_photos: o?.n ?? 0 });
});
app.get("/api/categories", (c) => c.json({ categories: CATEGORIES }));
app.get("/api/settings", async (c) => c.json({ chef_enabled: await getChefEnabled(c.env.DB) }));
app.get("/api/me", (c) => {
  const v = c.get("viewer");
  return c.json({ logged_in: v.logged_in, email: v.email, can_edit: v.logged_in });
});

app.get("/api/dishes", chefMockMw, async (c) => {
  const cat = c.req.query("category")?.trim();
  const SQL = `SELECT d.id, d.name, d.category, d.source, d.chef_status, d.created_at,
      (SELECT r2_key FROM dish_photos p WHERE p.dish_id = d.id ORDER BY position, created_at LIMIT 1) AS cover,
      (SELECT COUNT(*) FROM dish_photos p WHERE p.dish_id = d.id) AS photo_count
    FROM dishes d`;
  let stmt;
  if (!cat || cat === "全部") stmt = c.env.DB.prepare(`${SQL} ORDER BY d.created_at DESC, d.id DESC`);
  else {
    checkCategory(cat);
    stmt = c.env.DB.prepare(`${SQL} WHERE d.category = ? ORDER BY d.created_at DESC, d.id DESC`).bind(cat);
  }
  const r = await stmt.all<{ id: string; name: string; category: string; source: string; chef_status: string; created_at: string; cover: string | null; photo_count: number }>();
  return c.json({
    dishes: r.results.map((d) => ({
      id: d.id, name: d.name, category: d.category, photo_url: d.cover ? `/api/photos/${d.cover}` : null,
      photo_count: d.photo_count, source: d.source, chef_status: d.chef_status, created_at: d.created_at,
    })),
  });
});
app.get("/api/dishes/:id", chefMockMw, async (c) => c.json(await dishJson(c, c.req.param("id")!)));

// ---------- 本地模拟登录 ----------
app.post("/api/dev/login", (c) => {
  if (!devAuthEnabled(c.env)) throw new ApiError("NOT_FOUND", "没有这个接口");
  c.header("Set-Cookie", `${DEV_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return c.json({ ok: true, logged_in: true });
});
app.post("/api/dev/logout", (c) => {
  if (!devAuthEnabled(c.env)) throw new ApiError("NOT_FOUND", "没有这个接口");
  c.header("Set-Cookie", `${DEV_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return c.json({ ok: true, logged_in: false });
});

// ---------- 写入（需登录） ----------
app.use("/api/kitchen/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  if (!c.get("viewer").logged_in) throw new ApiError("UNAUTHORIZED", "请先登录考拉食堂再操作");
  await next();
  // 有写入操作时，后台顺手重试清理孤儿照片（不影响本次响应）
  const job = retryOrphans(c.env).catch((e) => console.error("孤儿照片清理出错", (e as Error).message));
  try { c.executionCtx.waitUntil(job); } catch { await job; }
});

/** 解析手写/编辑提交的内容字段（JSON 字符串或数组都行），返回规范化后的 RecipeDraft */
function parseContent(raw: Record<string, unknown>, base?: RecipeDraft): RecipeDraft {
  const pick = (k: string) => {
    const v = raw[k];
    if (typeof v === "string" && (k === "ingredients" || k === "steps" || k === "tips")) {
      if (!v.trim()) return [];
      try { return JSON.parse(v); } catch { throw new ApiError("VALIDATION", `${k} 不是合法的 JSON`); }
    }
    return v;
  };
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const k of ["ingredients", "steps", "tips", "servings", "total_time"]) if (raw[k] !== undefined) merged[k] = pick(k);
  delete merged.chef_message;
  const r = normalizeDraft(merged, { mode: "edit" });
  if (!r.ok) throw new ApiError("VALIDATION", r.errors.join("；"), r.errors);
  return r.draft;
}
const CONTENT_KEYS = ["ingredients", "steps", "tips", "servings", "total_time"];
const rowDraft = (d: DishRow): RecipeDraft => ({
  ingredients: JSON.parse(d.ingredients), steps: JSON.parse(d.steps), tips: JSON.parse(d.tips),
  servings: d.servings, total_time: d.total_time,
});

app.post("/api/kitchen/dishes", async (c) => {
  const form = await readForm(c);
  const name = checkName(form.get("name"));
  const category = checkCategory(form.get("category"));
  const note = checkNote(form.get("note"));
  const mode = String(form.get("mode") ?? "manual").trim() || "manual";
  if (mode !== "chef" && mode !== "manual") throw new ApiError("VALIDATION", "mode 只能是 chef（找厨驼写）或 manual（自己写）");
  if (mode === "chef" && !(await getChefEnabled(c.env.DB))) throw new ApiError("CHEF_DISABLED", "厨驼已在设置里关闭，请先打开或改为自己写");
  const fields: Record<string, unknown> = {};
  for (const k of CONTENT_KEYS) { const v = form.get(k); if (typeof v === "string") fields[k] = v; }
  const content = mode === "manual"
    ? parseContent(fields)
    : { ingredients: [], steps: [], tips: [], servings: null, total_time: null };
  if (mode === "manual") {
    checkShortText(content.servings, "份量"); checkShortText(content.total_time, "总时长");
  }
  const photos = await readPhotos(form, 1, MAX_PHOTOS);

  const id = crypto.randomUUID();
  const now = nowIso();
  const rows = await putPhotos(c.env, id, photos, 0);
  const cols = draftColumns(content);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO dishes(id,name,category,note,ingredients,steps,tips,servings,total_time,source,chef_status,chef_requested_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, name, category, note, cols.ingredients, cols.steps, cols.tips, cols.servings, cols.total_time,
        mode, mode === "chef" ? "pending" : "confirmed", mode === "chef" ? now : null, now, now),
      ...insertPhotoStmts(c.env.DB, rows),
    ]);
  } catch (e) {
    await removeStored(c.env, rows.map((r) => ({ key: r.r2_key, size: r.size })), "写 D1 失败的清理");
    throw e;
  }
  return c.json(await dishJson(c, id, true), 201);
});

app.patch("/api/kitchen/dishes/:id", async (c) => {
  const id = c.req.param("id")!;
  const d = await mustDish(c.env.DB, id);
  const body = await readJson(c);
  const sets: string[] = [], vals: unknown[] = [];
  if (body.name !== undefined) { sets.push("name=?"); vals.push(checkName(body.name)); }
  if (body.category !== undefined) { sets.push("category=?"); vals.push(checkCategory(body.category)); }
  if (body.note !== undefined) { sets.push("note=?"); vals.push(checkNote(body.note)); }
  if (CONTENT_KEYS.some((k) => body[k] !== undefined)) {
    const content = parseContent(body, rowDraft(d));
    const cols = draftColumns(content);
    sets.push("ingredients=?", "steps=?", "tips=?", "servings=?", "total_time=?");
    vals.push(cols.ingredients, cols.steps, cols.tips, cols.servings, cols.total_time);
    // 大王亲手改了正式内容：来源变手写，作废没处理完的厨驼任务
    sets.push("source='manual'", "chef_status='confirmed'", "draft=NULL", "requested_note=NULL", "claimed_at=NULL", "chef_requested_at=NULL");
  }
  if (sets.length) {
    sets.push("updated_at=?"); vals.push(nowIso());
    await c.env.DB.prepare(`UPDATE dishes SET ${sets.join(",")} WHERE id=?`).bind(...vals, id).run();
  }
  return c.json(await dishJson(c, id, true));
});

app.delete("/api/kitchen/dishes/:id", async (c) => {
  const id = c.req.param("id")!;
  await mustDish(c.env.DB, id);
  const photos = await getPhotos(c.env.DB, id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM dish_photos WHERE dish_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM dishes WHERE id=?").bind(id),
  ]);
  await removeStored(c.env, photos.map((p) => ({ key: p.r2_key, size: p.size })), "删除菜品");
  return c.json({ ok: true });
});

app.post("/api/kitchen/dishes/:id/photos", async (c) => {
  const id = c.req.param("id")!;
  await mustDish(c.env.DB, id);
  const existing = await getPhotos(c.env.DB, id);
  const left = MAX_PHOTOS - existing.length;
  if (left <= 0) throw new ApiError("VALIDATION", `每道菜最多 ${MAX_PHOTOS} 张照片，已经满了`);
  const photos = await readPhotos(await readForm(c), 1, left);
  const start = existing.reduce((m, p) => Math.max(m, p.position + 1), 0);
  const rows = await putPhotos(c.env, id, photos, start);
  try {
    await c.env.DB.batch([...insertPhotoStmts(c.env.DB, rows),
      c.env.DB.prepare("UPDATE dishes SET updated_at=? WHERE id=?").bind(nowIso(), id)]);
  } catch (e) { await removeStored(c.env, rows.map((r) => ({ key: r.r2_key, size: r.size })), "写 D1 失败的清理"); throw e; }
  return c.json(await dishJson(c, id, true));
});

app.put("/api/kitchen/dishes/:id/photos/order", async (c) => {
  const id = c.req.param("id")!;
  await mustDish(c.env.DB, id);
  const body = await readJson(c);
  const ids = body.ids;
  const existing = await getPhotos(c.env.DB, id);
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new ApiError("VALIDATION", "ids 必须是照片 id 数组");
  const set = new Set(ids as string[]);
  if (set.size !== ids.length || ids.length !== existing.length || existing.some((p) => !set.has(p.id)))
    throw new ApiError("VALIDATION", "ids 必须正好包含这道菜的全部照片 id，各一次");
  await c.env.DB.batch([
    ...(ids as string[]).map((pid, i) => c.env.DB.prepare("UPDATE dish_photos SET position=? WHERE id=? AND dish_id=?").bind(i, pid, id)),
    c.env.DB.prepare("UPDATE dishes SET updated_at=? WHERE id=?").bind(nowIso(), id),
  ]);
  return c.json(await dishJson(c, id, true));
});

app.delete("/api/kitchen/dishes/:id/photos/:photoId", async (c) => {
  const id = c.req.param("id")!, pid = c.req.param("photoId")!;
  await mustDish(c.env.DB, id);
  const existing = await getPhotos(c.env.DB, id);
  const target = existing.find((p) => p.id === pid);
  if (!target) throw new ApiError("NOT_FOUND", "这张照片不存在");
  if (existing.length <= 1) throw new ApiError("VALIDATION", "每道菜至少要留 1 张照片");
  const rest = existing.filter((p) => p.id !== pid);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM dish_photos WHERE id=?").bind(pid),
    ...rest.map((p, i) => c.env.DB.prepare("UPDATE dish_photos SET position=? WHERE id=?").bind(i, p.id)),
    c.env.DB.prepare("UPDATE dishes SET updated_at=? WHERE id=?").bind(nowIso(), id),
  ]);
  await removeStored(c.env, [{ key: target.r2_key, size: target.size }], "删除照片");
  return c.json(await dishJson(c, id, true));
});

app.post("/api/kitchen/dishes/:id/ask-chef", async (c) => {
  const id = c.req.param("id")!;
  await mustDish(c.env.DB, id);
  if (!(await getChefEnabled(c.env.DB))) throw new ApiError("CHEF_DISABLED", "厨驼已在设置里关闭，请先打开");
  const body = await readJson(c);
  const req = checkNote(body.note);
  const now = nowIso();
  await c.env.DB.prepare(`UPDATE dishes SET chef_status='pending', draft=NULL, draft_at=NULL, claimed_at=NULL,
      requested_note=?, chef_requested_at=?, updated_at=? WHERE id=?`).bind(req, now, now, id).run();
  return c.json(await dishJson(c, id, true));
});

app.post("/api/kitchen/dishes/:id/confirm", async (c) => {
  const id = c.req.param("id")!;
  const d = await mustDish(c.env.DB, id);
  if (d.chef_status !== "draft") throw new ApiError("BAD_STATE", "这道菜现在没有待确认的厨驼草稿");
  const body = await readJson(c);
  const draft = JSON.parse(d.draft ?? "{}") as RecipeDraft;
  const merged = parseContent(body, draft); // 先按宽松规则解析大王的修改
  if (!merged.ingredients.length && !merged.steps.length)
    throw new ApiError("VALIDATION", "草稿是空的，不能直接确认；可以放弃草稿，或者自己写好再保存");
  // 合并结果走和交稿同一套严格校验（食材有用量、步骤 3–12 步）；大王手写保存不受此限
  const strict = normalizeDraft({ ...merged, chef_message: null }, { mode: "chef" });
  if (!strict.ok) throw new ApiError("VALIDATION", "确认后的菜谱不合格：" + strict.errors.join("；"), strict.errors);
  const content = strict.draft;
  const cols = draftColumns(content);
  await c.env.DB.prepare(`UPDATE dishes SET ingredients=?, steps=?, tips=?, servings=?, total_time=?, source='chef',
      chef_status='confirmed', draft=NULL, requested_note=NULL, claimed_at=NULL, updated_at=? WHERE id=?`)
    .bind(cols.ingredients, cols.steps, cols.tips, cols.servings, cols.total_time, nowIso(), id).run();
  return c.json(await dishJson(c, id, true));
});

app.post("/api/kitchen/dishes/:id/discard-draft", async (c) => {
  const id = c.req.param("id")!;
  const d = await mustDish(c.env.DB, id);
  if (d.chef_status !== "draft") throw new ApiError("BAD_STATE", "这道菜现在没有待确认的厨驼草稿，不能放弃");
  await c.env.DB.prepare(`UPDATE dishes SET chef_status='confirmed', draft=NULL, requested_note=NULL, claimed_at=NULL,
      chef_requested_at=NULL, updated_at=? WHERE id=?`).bind(nowIso(), id).run();
  return c.json(await dishJson(c, id, true));
});

app.get("/api/kitchen/storage", async (c) => c.json(await storageReport(c.env, getPhotoStore(c.env).kind)));

app.patch("/api/kitchen/settings", async (c) => {
  const body = await readJson(c);
  if (typeof body.chef_enabled !== "boolean") throw new ApiError("VALIDATION", "chef_enabled 必须是 true 或 false");
  await c.env.DB.prepare("INSERT INTO settings(key,value) VALUES ('chef_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(String(body.chef_enabled)).run();
  return c.json({ chef_enabled: body.chef_enabled });
});

// ---------- 厨驼（X-Chef-Key） ----------
app.use("/api/chef/*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const want = c.env.CHEF_KEY;
  if (!want) throw new ApiError("UNAUTHORIZED", "服务器没有配置 CHEF_KEY，请先运行 worker/scripts/init-dev-vars");
  const got = c.req.header("X-Chef-Key") ?? "";
  if (!got || !(await safeEqual(got, want))) throw new ApiError("UNAUTHORIZED", "厨驼密钥不对（X-Chef-Key）");
  await next();
});
/** §12-5：厨驼关闭时，厨驼的领取/交稿接口一律 403；已有 pending 保留，已交草稿大王照常 confirm/discard */
const chefOnMw = async (c: C, next: Next) => {
  if (!(await getChefEnabled(c.env.DB))) throw new ApiError("CHEF_DISABLED", "厨驼已在设置里关闭，暂时不接新任务");
  await next();
};
const claimTtlMs = (env: Env) => (Number(env.CHEF_CLAIM_TTL_MIN) || 30) * 60_000;

app.get("/api/chef/tasks", chefOnMw, chefMockMw, async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM dishes WHERE chef_status='pending' ORDER BY chef_requested_at, created_at").all<DishRow>();
  const tasks = [];
  for (const d of r.results) tasks.push(toTask(d, await getPhotos(c.env.DB, d.id)));
  return c.json({ tasks });
});

app.post("/api/chef/tasks/:id/claim", chefOnMw, async (c) => {
  const id = c.req.param("id")!;
  const d = await mustDish(c.env.DB, id);
  if (d.chef_status !== "pending") throw new ApiError("BAD_STATE", "这道菜不在待写状态，不能领取");
  if (d.claimed_at && Date.now() - Date.parse(d.claimed_at) < claimTtlMs(c.env))
    throw new ApiError("CONFLICT", `这道菜在 ${d.claimed_at} 已被领取，${Number(c.env.CHEF_CLAIM_TTL_MIN) || 30} 分钟内不能重复领取`);
  const now = nowIso();
  await c.env.DB.prepare("UPDATE dishes SET claimed_at=? WHERE id=? AND chef_status='pending'").bind(now, id).run();
  return c.json(toTask({ ...d, claimed_at: now }, await getPhotos(c.env.DB, id)));
});

app.get("/api/chef/tasks/:id/photos/:photoId", async (c) => {
  const p = await c.env.DB.prepare("SELECT * FROM dish_photos WHERE id=? AND dish_id=?")
    .bind(c.req.param("photoId")!, c.req.param("id")!).first<PhotoRow>();
  if (!p) throw new ApiError("NOT_FOUND", "照片不存在");
  return servePhoto(c, p.r2_key);
});

app.post("/api/chef/tasks/:id/draft", chefOnMw, async (c) => {
  const id = c.req.param("id")!;
  const d = await mustDish(c.env.DB, id);
  if (d.chef_status !== "pending") throw new ApiError("BAD_STATE", `这道菜现在是 ${d.chef_status} 状态，只有 pending（待写）的菜能交稿`);
  const body = await readJson(c);
  const r = normalizeDraft(body, { mode: "chef" });
  if (!r.ok) throw new ApiError("VALIDATION", "草稿没通过校验：" + r.errors.join("；"), r.errors);
  const now = nowIso();
  const res = await c.env.DB.prepare("UPDATE dishes SET chef_status='draft', draft=?, draft_at=?, claimed_at=NULL, updated_at=? WHERE id=? AND chef_status='pending'")
    .bind(JSON.stringify(r.draft), now, now, id).run();
  if (!res.meta.changes) throw new ApiError("BAD_STATE", "这道菜刚刚被改了状态，交稿没写进去，请重新 list 看看");
  return c.json({ ...(await dishJson(c, id, true)), warnings: r.warnings });
});

export default app;

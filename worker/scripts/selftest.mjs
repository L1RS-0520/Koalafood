#!/usr/bin/env node
// 后端自测（不依赖 test/，后端工程师的 api.test.mjs 另跑）。只建自己的临时菜，跑完全部删除，不碰已有的菜。
//   node scripts/selftest.mjs [--base http://localhost:8787] [--only photos]
// 需要：wrangler dev 在跑、.dev.vars 里有 CHEF_KEY 和 DEV_AUTH=1。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt("--base", "http://localhost:8787").replace(/\/$/, "");
const ONLY = opt("--only", "all");
const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".dev.vars"), "utf8");
const CHEF_KEY = (vars.match(/^CHEF_KEY=(.*)$/m) || [])[1]?.trim();
if (!CHEF_KEY) { console.error("缺 CHEF_KEY，先运行 ./scripts/init-dev-vars"); process.exit(1); }

let pass = 0, fail = 0; const created = []; const fails = [];
const ok = (cond, name, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); } };
let cookie = "";
async function req(method, path, { json, form, chef, auth = true, raw } = {}) {
  const h = {};
  if (auth && cookie) h.Cookie = cookie;
  if (chef) h["X-Chef-Key"] = chef === true ? CHEF_KEY : chef;
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(BASE + path, { method, headers: h, body });
  const sc = r.headers.get("set-cookie"); if (sc && sc.startsWith("koala_dev_auth=")) cookie = sc.split(";")[0];
  if (raw) return { status: r.status, type: r.headers.get("content-type"), buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
// ---- 测试图片 ----
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w = 8, h = 8, seed = 1) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push((x * seed) & 255, (y * 7) & 255, 128); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const jpg = (size) => { const b = Buffer.alloc(size, 0x11); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b; };
const webp = () => { const b = Buffer.alloc(32); b.write("RIFF", 0); b.writeUInt32LE(24, 4); b.write("WEBPVP8 ", 8); return b; };
function mkForm(fields, files) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [i, [buf, type]] of files.entries()) f.append("photos", new Blob([buf], { type }), `p${i}.${type.split("/")[1]}`);
  return f;
}
async function newDish(fields, files = [[png(), "image/png"]]) {
  const r = await req("POST", "/api/kitchen/dishes", { form: mkForm({ category: "其他", ...fields }, files) });
  if (r.status === 201) created.push(r.body.id);
  return r;
}
const goodDraft = () => ({
  ingredients: [{ name: "鸡蛋", amount: "2个" }, { name: "盐", amount: "2克" }],
  steps: [
    { text: "鸡蛋打散 30 秒", heat: "", time: "30秒", caption: "打散！" },
    { text: "热锅倒 15 毫升油，中火烧 30 秒", heat: "中火", time: "30秒", caption: "这句对白明显超过了十二个字哦" },
    { text: "倒蛋液大火炒 1 分钟出锅", heat: "旺火", time: "1分钟", caption: "开饭！" },
  ], tips: ["火别太大"], servings: 2, total_time: "5分钟",
});

async function main() {
  const h = await req("GET", "/api/health", { auth: false });
  console.log(`目标 ${BASE}  photo_store=${h.body.photo_store}  chef_pending=${h.body.chef_pending}`);
  ok(h.status === 200 && h.body.ok === true, "health 正常");
  const pendingBefore = h.body.chef_pending;

  console.log("[登录与隐私]");
  ok((await req("GET", "/api/me", { auth: false })).body.logged_in === false, "未登录 /api/me logged_in=false");
  ok((await req("POST", "/api/kitchen/dishes", { auth: false, form: mkForm({ name: "x", category: "其他" }, []) })).status === 401, "未登录写入 401");
  const lg = await req("POST", "/api/dev/login");
  ok(lg.status === 200 && !!cookie, "dev/login 拿到 cookie");
  const me = await req("GET", "/api/me");
  ok(me.body.logged_in && me.body.can_edit && !!me.body.email, "登录后 /api/me can_edit=true");
  ok((await req("POST", "/api/dishes")).status === 404, "旧写路径 POST /api/dishes 404");

  console.log("[照片与存储]");
  const big = jpg(1024 * 1024 + 1), edge = jpg(1024 * 1024);
  const d1 = await newDish({ name: "自测-照片", mode: "manual" }, [[png(8, 8, 1), "image/png"], [jpg(2000), "image/jpeg"], [webp(), "image/webp"]]);
  ok(d1.status === 201 && d1.body.photos.length === 3, "上传 3 张（png/jpg/webp）", JSON.stringify(d1.body).slice(0, 200));
  const D = d1.body;
  const p0 = await req("GET", D.photos[0].url, { auth: false, raw: true });
  ok(p0.status === 200 && p0.type === "image/png" && p0.buf.equals(png(8, 8, 1)), "公开读照片，字节一致、Content-Type 正确");
  ok(/max-age/.test(p0.headers.get("cache-control") || ""), "照片带缓存头");
  ok(D.photo_url === D.photos[0].url, "photo_url = 封面");
  const e1 = await newDish({ name: "自测-刚好1MB", mode: "manual" }, [[edge, "image/jpeg"]]);
  ok(e1.status === 201, "正好 1048576 字节可以上传");
  const e2 = await newDish({ name: "自测-超1MB", mode: "manual" }, [[png(), "image/png"], [big, "image/jpeg"]]);
  ok(e2.status === 413 && e2.body.error.code === "TOO_LARGE" && e2.body.error.message === "第 2 张照片太大了（1,025KB），上限 1,024KB", "1048577 字节 → 413 TOO_LARGE「第 2 张照片太大了（1,025KB），上限 1,024KB」", JSON.stringify(e2.body));
  const e3 = await newDish({ name: "自测-假图", mode: "manual" }, [[png(), "image/png"], [Buffer.from("hello world, not image"), "image/jpeg"]]);
  ok(e3.status === 415 && /第 2 张/.test(e3.body.error.message), "伪装 MIME 的文本 → 415 BAD_TYPE（magic bytes）");
  const ten = Array.from({ length: 10 }, (_, i) => [png(4, 4, i + 1), "image/png"]);
  const e4 = await newDish({ name: "自测-10张", mode: "manual" }, ten);
  ok(e4.status === 400 && e4.body.error.code === "VALIDATION", "10 张 → 400 VALIDATION");
  const of = new FormData(); of.append("name", "自测-旧字段"); of.append("category", "其他"); of.append("photo", new Blob([png()], { type: "image/png" }), "a.png");
  const e6 = await req("POST", "/api/kitchen/dishes", { form: of });
  ok(e6.status === 400 && e6.body.error?.code === "VALIDATION", "旧字段名 photo → 400");
  const e5 = await newDish({ name: "自测-无图", mode: "manual" }, []);
  ok(e5.status === 400, "没有照片 → 400");
  const add = await req("POST", `/api/kitchen/dishes/${D.id}/photos`, { form: mkForm({}, [[png(6, 6, 3), "image/png"]]) });
  ok(add.status === 200 && add.body.photos.length === 4, "追加 1 张 → 4 张");
  const add2 = await req("POST", `/api/kitchen/dishes/${D.id}/photos`, { form: mkForm({}, Array.from({ length: 6 }, (_, i) => [png(4, 4, i + 20), "image/png"])) });
  ok(add2.status === 400, "追加后超过 9 张 → 400");
  const ids = add.body.photos.map((p) => p.id).reverse();
  const ord = await req("PUT", `/api/kitchen/dishes/${D.id}/photos/order`, { json: { ids } });
  ok(ord.status === 200 && ord.body.photos.map((p) => p.id).join() === ids.join() && ord.body.photo_url === ord.body.photos[0].url, "排序后封面跟着变");
  ok((await req("PUT", `/api/kitchen/dishes/${D.id}/photos/order`, { json: { ids: ids.slice(1) } })).status === 400, "排序 ids 不全 → 400");
  const delUrl = ord.body.photos[0].url;
  const dp = await req("DELETE", `/api/kitchen/dishes/${D.id}/photos/${ord.body.photos[0].id}`);
  ok(dp.status === 200 && dp.body.photos.length === 3, "删 1 张照片");
  ok((await req("GET", delUrl, { raw: true })).status === 404, "删掉的照片 404（存储里已删）");
  const one = e1.body;
  ok((await req("DELETE", `/api/kitchen/dishes/${one.id}/photos/${one.photos[0].id}`)).status === 400, "最后 1 张不能删 → 400");
  const sum = (await req("GET", "/api/dishes?category=其他")).body.dishes.find((x) => x.id === D.id);
  ok(sum && sum.photo_count === 3 && sum.photo_url, "列表 DishSummary 带 photo_count、封面");
  const urls = dp.body.photos.map((p) => p.url);
  ok((await req("DELETE", `/api/kitchen/dishes/${D.id}`)).body.ok === true, "删除菜品");
  created.splice(created.indexOf(D.id), 1);
  let all404 = true; for (const u of urls) if ((await req("GET", u, { raw: true })).status !== 404) all404 = false;
  ok(all404, "删菜后所有照片 404");
  ok((await req("GET", `/api/dishes/${D.id}`)).status === 404, "删菜后详情 404");
  if (ONLY === "photos") return pendingBefore;

  console.log("[校验]");
  const v = async (fields, code, name) => { const r = await newDish({ mode: "manual", ...fields }); ok(r.status !== 201 && r.body.error?.code === code, name, JSON.stringify(r.body)); };
  await v({ name: "长".repeat(31) }, "VALIDATION", "菜名 31 字 → VALIDATION");
  await v({ name: "" }, "VALIDATION", "菜名为空 → VALIDATION");
  await v({ name: "自测", category: "西餐" }, "VALIDATION", "分类不在六个里 → VALIDATION");
  await v({ name: "自测", note: "注".repeat(201) }, "VALIDATION", "备注 201 字 → VALIDATION");
  await v({ name: "自测", mode: "auto" }, "VALIDATION", "mode 非法 → VALIDATION");
  await v({ name: "自测", steps: "[不是json" }, "VALIDATION", "steps 不是 JSON → VALIDATION");
  const n30 = await newDish({ name: "自".repeat(30), mode: "manual" });
  ok(n30.status === 201, "菜名正好 30 字可以");

  console.log("[手写与 PATCH]");
  const m = await newDish({ name: "自测-手写", mode: "manual", note: "外婆的做法", ingredients: JSON.stringify([{ name: "黄瓜", amount: "2根" }]), steps: JSON.stringify(["拍碎", "1. 加醋"]) });
  ok(m.status === 201 && m.body.chef_status === "confirmed" && m.body.source === "manual" && m.body.steps[1].text === "加醋", "manual → confirmed/manual，步骤编号被去掉");
  const m0 = await newDish({ name: "自测-只写备注", mode: "manual", note: "随手记" });
  ok(m0.status === 201 && m0.body.ingredients.length === 0, "手写允许食材步骤全空");

  console.log("[厨驼流程]");
  const c = await newDish({ name: "自测-厨驼", mode: "chef", note: "少放油" }, [[png(5, 5, 9), "image/png"], [jpg(3000), "image/jpeg"]]);
  ok(c.status === 201 && c.body.chef_status === "pending" && c.body.source === "chef", "mode=chef → pending");
  const C = c.body;
  ok((await req("GET", "/api/chef/tasks", { chef: "wrong" })).status === 401, "错密钥 401");
  ok((await req("GET", "/api/chef/tasks")).status === 401, "无密钥 401");
  const tasks = await req("GET", "/api/chef/tasks", { chef: true });
  const t = tasks.body.tasks.find((x) => x.id === C.id);
  ok(t && t.photos.length === 2 && t.note === "少放油", "tasks 里有这道菜，带 2 张照片和备注");
  const cp = await req("GET", t.photos[1].url, { chef: true, raw: true });
  ok(cp.status === 200 && cp.type === "image/jpeg" && cp.buf.length === 3000, "厨驼带密钥读图");
  ok((await req("GET", t.photos[1].url, { raw: true })).status === 401, "厨驼读图不带密钥 401");
  const cl = await req("POST", `/api/chef/tasks/${C.id}/claim`, { chef: true });
  ok(cl.status === 200 && cl.body.claimed_at, "claim 成功");
  const cl2 = await req("POST", `/api/chef/tasks/${C.id}/claim`, { chef: true });
  ok(cl2.status === 409 && cl2.body.error.code === "CONFLICT", "30 分钟内重复领取 409 CONFLICT");
  const bad1 = await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [{ name: "蛋" }], steps: [{ text: "a" }, { text: "b" }] } });
  ok(bad1.status === 400 && bad1.body.error.code === "VALIDATION", "2 步 → 400");
  const thirteen = Array.from({ length: 13 }, (_, i) => ({ text: `第${i}步` }));
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [{ name: "蛋" }], steps: thirteen } })).status === 400, "13 步 → 400");
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [], steps: [] } })).status === 400, "空稿不带 chef_message → 400");
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [{ name: "蛋" }], steps: [], chef_message: "看不清" } })).status === 400, "有 chef_message 但只空了一半 → 400");
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [{ amount: "1个" }], steps: thirteen.slice(0, 3) } })).status === 400, "食材缺 name → 400");
  for (const [label, ing] of [["缺失", { name: "蛋" }], ["空串", { name: "蛋", amount: "" }], ["全空格", { name: "蛋", amount: "   " }]]) {
    const r = await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [ing], steps: thirteen.slice(0, 3) } });
    ok(r.status === 400 && r.body.error?.code === "VALIDATION", `交稿食材 amount ${label} → 400`);
  }
  const pubPending = await req("GET", `/api/dishes/${C.id}`, { auth: false });
  ok(pubPending.body.chef_status === "pending", "公开详情能看到 pending");
  const sub = await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: goodDraft() });
  ok(sub.status === 200 && sub.body.chef_status === "draft" && sub.body.draft.steps[1].caption.length <= 12 && sub.body.draft.steps[2].heat === "大火", "合格草稿 → draft，caption 截断、旺火→大火");
  ok(sub.body.ingredients.length === 0, "交稿不动正式内容");
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: goodDraft() })).body.error?.code === "BAD_STATE", "draft 状态再交稿 409 BAD_STATE");
  ok((await req("POST", `/api/chef/tasks/${C.id}/claim`, { chef: true })).body.error?.code === "BAD_STATE", "draft 状态 claim → BAD_STATE");
  const pub = await req("GET", `/api/dishes/${C.id}`, { auth: false });
  ok(pub.body.draft === null && pub.body.requested_note === null && pub.body.chef_status === "draft", "未登录：draft/requested_note 为 null");
  const priv = await req("GET", `/api/dishes/${C.id}`);
  ok(priv.body.draft && priv.body.draft.steps.length === 3, "登录：能看到草稿");
  // confirm 带修改
  const cf = await req("POST", `/api/kitchen/dishes/${C.id}/confirm`, { json: { servings: "3人份" } });
  ok(cf.status === 200 && cf.body.chef_status === "confirmed" && cf.body.source === "chef" && cf.body.servings === "3人份" && cf.body.steps.length === 3 && cf.body.draft === null, "confirm（带修改）→ confirmed/chef，草稿清空");
  ok((await req("POST", `/api/kitchen/dishes/${C.id}/confirm`)).body.error?.code === "BAD_STATE", "非 draft confirm → BAD_STATE");
  const cx = await newDish({ name: "自测-confirm校验", mode: "chef" });
  await req("POST", `/api/chef/tasks/${cx.body.id}/draft`, { chef: true, json: goodDraft() });
  const c13 = await req("POST", `/api/kitchen/dishes/${cx.body.id}/confirm`, { json: { steps: Array.from({ length: 13 }, (_, i) => ({ text: `翻炒${i + 1}次` })) } });
  ok(c13.status === 400 && c13.body.error?.code === "VALIDATION", "confirm 合并成 13 步 → 400 VALIDATION");
  const c2 = await req("POST", `/api/kitchen/dishes/${cx.body.id}/confirm`, { json: { steps: [{ text: "一" }, { text: "二" }] } });
  ok(c2.status === 400, "confirm 合并成 2 步 → 400");
  ok((await req("GET", `/api/dishes/${cx.body.id}`)).body.chef_status === "draft", "confirm 校验失败后仍是 draft");
  const m13 = await req("PATCH", `/api/kitchen/dishes/${cx.body.id}`, { json: { steps: Array.from({ length: 13 }, (_, i) => `翻炒${i + 1}次`) } });
  ok(m13.status === 200 && m13.body.steps.length === 13, "手写 PATCH 13 步不受 3–12 限制");
  ok((await req("POST", `/api/kitchen/dishes/${C.id}/discard-draft`)).body.error?.code === "BAD_STATE", "非 draft discard → 409 BAD_STATE");

  console.log("[ask-chef / discard / PATCH 规则]");
  const ak = await req("POST", `/api/kitchen/dishes/${C.id}/ask-chef`, { json: { note: "这次加了土豆" } });
  ok(ak.status === 200 && ak.body.chef_status === "pending" && ak.body.requested_note === "这次加了土豆" && ak.body.steps.length === 3, "ask-chef → pending，旧正式内容保留");
  const t2 = (await req("GET", "/api/chef/tasks", { chef: true })).body.tasks.find((x) => x.id === C.id);
  ok(t2 && t2.requested_note === "这次加了土豆" && !t2.claimed_at, "厨驼看到大王的要求，领取记录已清");
  const pn = await req("PATCH", `/api/kitchen/dishes/${C.id}`, { json: { name: "自测-厨驼改名", category: "家常菜", note: "改备注" } });
  ok(pn.body.chef_status === "pending" && pn.body.source === "chef" && pn.body.requested_note === "这次加了土豆", "PATCH 只改 name/category/note：状态、来源、任务都不变");
  await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: { ingredients: [], steps: [], chef_message: "土豆要切多大？" } });
  const dr = await req("GET", `/api/dishes/${C.id}`);
  ok(dr.body.chef_status === "draft" && dr.body.draft.chef_message === "土豆要切多大？", "chef_message 空稿 → draft");
  ok((await req("POST", `/api/kitchen/dishes/${C.id}/confirm`)).status === 400, "空草稿不能直接 confirm → 400");
  const ak2 = await req("POST", `/api/kitchen/dishes/${C.id}/ask-chef`, { json: {} });
  ok(ak2.body.chef_status === "pending" && ak2.body.draft === null && ak2.body.requested_note === null, "draft 状态 ask-chef：立即丢草稿 → pending");
  await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: goodDraft() });
  const ds = await req("POST", `/api/kitchen/dishes/${C.id}/discard-draft`);
  ok(ds.status === 200 && ds.body.chef_status === "confirmed" && ds.body.draft === null && ds.body.requested_note === null && ds.body.servings === "3人份", "discard-draft → confirmed，正式内容不变，requested_note 清空");
  await req("POST", `/api/kitchen/dishes/${C.id}/ask-chef`, { json: { note: "再来" } });
  const pc = await req("PATCH", `/api/kitchen/dishes/${C.id}`, { json: { tips: ["自己加的小贴士"] } });
  ok(pc.body.chef_status === "confirmed" && pc.body.source === "manual" && pc.body.requested_note === null && pc.body.steps.length === 3, "PATCH 改内容字段 → confirmed/manual，任务作废");
  ok(!(await req("GET", "/api/chef/tasks", { chef: true })).body.tasks.some((x) => x.id === C.id), "作废后厨驼列表里没有了");
  ok((await req("POST", `/api/chef/tasks/${C.id}/draft`, { chef: true, json: goodDraft() })).body.error?.code === "BAD_STATE", "作废后交稿 → BAD_STATE");
  const pp = await req("POST", `/api/kitchen/dishes/${C.id}/photos`, { form: mkForm({}, [[png(3, 3, 5), "image/png"]]) });
  ok(pp.body.source === "manual" && pp.body.chef_status === "confirmed", "照片操作不改 source/状态");

  console.log("[回归：测试员在 9e5551d 复现的 bug]");
  const bp = await newDish({ name: "自测-回归pending", mode: "chef" });
  const bd = await req("POST", `/api/kitchen/dishes/${bp.body.id}/discard-draft`);
  ok(bd.status === 409 && bd.body.error?.code === "BAD_STATE", "BUG-1：pending 调 discard-draft → 409 BAD_STATE", JSON.stringify(bd.body));
  ok((await req("GET", `/api/dishes/${bp.body.id}`)).body.chef_status === "pending", "BUG-1：状态仍为 pending");

  console.log("[设置 chef_enabled]");
  const p2 = await newDish({ name: "自测-关厨驼前", mode: "chef" });
  const d3 = await newDish({ name: "自测-关厨驼草稿", mode: "chef" });
  await req("POST", `/api/chef/tasks/${d3.body.id}/draft`, { chef: true, json: goodDraft() });
  const off = await req("PATCH", "/api/kitchen/settings", { json: { chef_enabled: false } });
  try {
    ok(off.body.chef_enabled === false && (await req("GET", "/api/settings", { auth: false })).body.chef_enabled === false, "关闭厨驼");
    const g1 = await req("GET", "/api/chef/tasks", { chef: true });
    ok(g1.status === 403 && g1.body.error?.code === "CHEF_DISABLED", "BUG-2：关闭后 GET tasks 403 CHEF_DISABLED");
    const g2 = await req("POST", `/api/chef/tasks/${p2.body.id}/claim`, { chef: true });
    ok(g2.status === 403 && g2.body.error?.code === "CHEF_DISABLED", "BUG-2：关闭后 claim 403 CHEF_DISABLED");
    const g3 = await req("POST", `/api/chef/tasks/${p2.body.id}/draft`, { chef: true, json: goodDraft() });
    ok(g3.status === 403 && g3.body.error?.code === "CHEF_DISABLED", "BUG-2：关闭后 draft 403 CHEF_DISABLED");
    ok((await newDish({ name: "自测-关闭后找厨驼", mode: "chef" })).body.error?.code === "CHEF_DISABLED", "关闭后 mode=chef 403");
    ok((await req("POST", `/api/kitchen/dishes/${p2.body.id}/ask-chef`)).body.error?.code === "CHEF_DISABLED", "关闭后 ask-chef 403");
    ok((await req("GET", `/api/dishes/${p2.body.id}`)).body.chef_status === "pending", "关闭后已有 pending 保留");
    ok((await req("POST", `/api/kitchen/dishes/${d3.body.id}/confirm`)).body.chef_status === "confirmed", "关闭后已交的草稿照常 confirm");
    ok((await req("PATCH", "/api/kitchen/settings", { json: { chef_enabled: "no" } })).status === 400, "chef_enabled 非布尔 → 400");
  } finally {
    const on = await req("PATCH", "/api/kitchen/settings", { json: { chef_enabled: true } });
    ok(on.body.chef_enabled === true, "恢复开启厨驼");
  }

  console.log("[列表与分类]");
  const all = (await req("GET", "/api/dishes")).body.dishes;
  ok(all.every((x, i) => i === 0 || all[i - 1].created_at >= x.created_at), "列表按 created_at 倒序");
  ok((await req("GET", "/api/dishes?category=全部")).body.dishes.length === all.length, "category=全部 返回全部");
  const jc = (await req("GET", "/api/dishes?category=家常菜")).body.dishes;
  ok(jc.length > 0 && jc.every((x) => x.category === "家常菜"), "分类筛选只返回该分类");
  ok((await req("GET", "/api/dishes?category=西餐")).status === 400, "非法分类筛选 → 400");
  ok((await req("GET", "/api/categories", { auth: false })).body.categories.length === 6, "categories 六个");
  ok((await req("GET", "/api/dishes/not-exist")).body.error?.code === "NOT_FOUND", "不存在的菜 404");
  ok((await req("PATCH", `/api/kitchen/dishes/${C.id}`, { json: [1] })).status === 400, "PATCH 非对象 JSON → 400");
  const lo = await req("POST", "/api/dev/logout");
  ok(lo.status === 200, "dev/logout");
  return pendingBefore;
}

let pendingBefore = null;
try { pendingBefore = await main(); }
catch (e) { fail++; fails.push("异常：" + e.message); console.error(e); }
finally {
  if (!cookie) await req("POST", "/api/dev/login");
  else await req("POST", "/api/dev/login");
  for (const id of created) await req("DELETE", `/api/kitchen/dishes/${id}`);
  await req("POST", "/api/dev/logout");
  const h = await req("GET", "/api/health", { auth: false });
  if (pendingBefore !== null) ok(h.body.chef_pending === pendingBefore, `清理后 chef_pending 恢复为 ${pendingBefore}`);
  console.log(`\n结果：通过 ${pass}，失败 ${fail}${fails.length ? "\n失败项：" + fails.join("；") : ""}`);
  process.exit(fail ? 1 : 0);
}

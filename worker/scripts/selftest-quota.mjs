#!/usr/bin/env node
// 存储额度自测：自己起临时 wrangler dev（独立端口 + 独立 persist 目录），不碰 8787。
//   node scripts/selftest-quota.mjs [--port 8797]
// A. KV_DAILY_WRITE_LIMIT=5：第 6 次 KV 写入 429 STORAGE_QUOTA、预判不足整单拒绝、不留半条菜、浏览照常、
//    删除照常成功（KV 删不了记孤儿、容量不立即扣回）→ 额度恢复后一次写入清掉孤儿、used_bytes 下降
// B. STORAGE_LIMIT_BYTES=10000：超限 507 STORAGE_FULL、不留半条、删除不受 507 限制、删除后 used_bytes 下降
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = opt("--port", "8797");
const DIR = `/tmp/koala-state-quota`;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0; const fails = [];
const ok = (c, n, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; fails.push(n); console.log(`  ✗ ${n} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, a) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: "ignore", env: { ...process.env, CI: "1" } }); p.on("exit", (c) => (c ? rej(new Error(`${cmd} ${a.join(" ")} 退出 ${c}`)) : res())); });

async function start(vars) {
  const v = Object.entries(vars).flatMap(([k, x]) => ["--var", `${k}:${x}`]);
  const p = spawn("npx", ["wrangler", "dev", "--local", "--port", PORT, "--ip", "127.0.0.1", "--persist-to", DIR, "--inspector-port", "0", ...v],
    { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) { await sleep(500); try { if ((await fetch(BASE + "/api/health")).ok) { cookie = ""; await req("POST", "/api/dev/login"); return p; } } catch {} }
  throw new Error("wrangler dev 没起来：\n" + log.slice(-800));
}
const stop = async (p) => { try { process.kill(-p.pid, "SIGTERM"); } catch {} await sleep(1500); };

let cookie = "";
async function req(method, path, { json, form, raw } = {}) {
  const h = cookie ? { Cookie: cookie } : {};
  let body; if (json) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); } if (form) body = form;
  const r = await fetch(BASE + path, { method, headers: h, body });
  const sc = r.headers.get("set-cookie"); if (sc?.startsWith("koala_dev_auth=1")) cookie = sc.split(";")[0];
  if (raw) return { status: r.status };
  return { status: r.status, body: await r.json().catch(() => null) };
}
const jpg = (size, seed = 0) => { const b = Buffer.alloc(size, seed & 255); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const form = (fields, sizes, seed = 1) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); sizes.forEach((s, i) => f.append("photos", new Blob([jpg(s, seed + i)], { type: "image/jpeg" }), `${i}.jpg`)); return f; };
const upload = (name, sizes, seed) => req("POST", "/api/kitchen/dishes", { form: form({ name, category: "其他", mode: "manual" }, sizes, seed) });
const names = async () => (await req("GET", "/api/dishes")).body.dishes.map((d) => d.name);
const storage = async () => (await req("GET", "/api/kitchen/storage")).body;

rmSync(DIR, { recursive: true, force: true });
await run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", DIR]);
let p;
try {
  console.log("[A] KV_DAILY_WRITE_LIMIT=5（每次 KV put/delete 计 1 次）");
  p = await start({ PHOTO_STORE: "kv", KV_DAILY_WRITE_LIMIT: 5 });
  const d1 = (await upload("额度A1", [1000, 1000], 1)).body;
  const d2 = (await upload("额度A2", [1000, 1000], 3)).body;
  let s = await storage();
  ok(s.ops_today === 4 && s.ops_limit === 5 && s.ops_pct === 80 && s.warn === true, "写了 4 次：ops_today=4、ops_pct=80、warn=true", JSON.stringify(s));
  const pre = await upload("额度A3-两张", [1000, 1000], 5);
  ok(pre.status === 429 && pre.body.error.code === "STORAGE_QUOTA" && pre.body.error.message === "今天食堂的照片柜塞满啦，明天再来传吧～", "剩 1 次却要传 2 张：写入前预判 → 429 STORAGE_QUOTA", JSON.stringify(pre.body));
  ok((await storage()).ops_today === 4, "预判拒绝时一次 KV 都没写");
  ok((await upload("额度A4", [1000], 7)).status === 201, "第 5 次写入成功");
  const sixth = await upload("额度A5", [1000], 8);
  ok(sixth.status === 429 && sixth.body.error.code === "STORAGE_QUOTA", "第 6 次写入 → 429 STORAGE_QUOTA", JSON.stringify(sixth.body));
  const n = await names();
  ok(!n.includes("额度A3-两张") && !n.includes("额度A5") && n.length === 3, "没有留下半条菜（只有 A1、A2、A4）");
  const ap = await req("POST", `/api/kitchen/dishes/${d1.id}/photos`, { form: form({}, [500], 9) });
  ok(ap.status === 429 && (await req("GET", `/api/dishes/${d1.id}`)).body.photos.length === 2, "追加照片 → 429，照片数不变");
  ok((await req("GET", d1.photos[0].url, { raw: true })).status === 200, "浏览不受影响");
  ok((await req("PATCH", `/api/kitchen/dishes/${d1.id}`, { json: { note: "额度满了也能改字" } })).status === 200, "不碰照片的写操作不受影响");
  const usedBefore = (await storage()).used_bytes;
  const dd = await req("DELETE", `/api/kitchen/dishes/${d1.id}`);
  ok(dd.status === 200 && (await req("GET", `/api/dishes/${d1.id}`)).status === 404, "额度满时删菜：照常成功，D1 已删");
  const h = (await req("GET", "/api/health")).body;
  ok(h.orphan_photos === 2, `KV 删不了的 2 张记进 orphan_photos（${h.orphan_photos}）`);
  ok((await storage()).used_bytes === usedBefore, "孤儿还占着 KV，used_bytes 暂不扣回");
  ok((await req("GET", d1.photos[0].url, { raw: true })).status === 404, "孤儿照片不再对外提供");
  await stop(p);

  console.log("[A2] 第二天（额度恢复）：任意写入后顺手清理孤儿");
  p = await start({ PHOTO_STORE: "kv", KV_DAILY_WRITE_LIMIT: 1000 });
  await req("PATCH", "/api/kitchen/settings", { json: { chef_enabled: true } });
  await sleep(800);
  ok((await req("GET", "/api/health")).body.orphan_photos === 0, "孤儿清零");
  ok((await storage()).used_bytes === usedBefore - 2000, "清理后 used_bytes 扣回 2000");
  await stop(p);

  console.log("[B] STORAGE_LIMIT_BYTES=10000（容量上限）");
  rmSync(DIR, { recursive: true, force: true });
  await run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", DIR]);
  p = await start({ PHOTO_STORE: "kv", STORAGE_LIMIT_BYTES: 10000 });
  const b1 = (await upload("容量B1", [4000, 4000], 11)).body;
  s = await storage();
  ok(s.used_bytes === 8000 && s.limit_bytes === 10000 && s.used_pct === 80 && s.warn === true && s.photo_count === 2, "已用 8000/10000：used_pct=80、warn=true", JSON.stringify(s));
  const full = await upload("容量B2", [1000, 1500], 13);
  ok(full.status === 507 && full.body.error.code === "STORAGE_FULL" && full.body.error.message === "照片柜满啦，删掉一些旧照片才能继续上传～", "8000+2500>10000 → 507 STORAGE_FULL", JSON.stringify(full.body));
  ok(!(await names()).includes("容量B2") && (await storage()).ops_today === 2, "不留半条、一次 KV 都没写");
  ok((await req("POST", `/api/kitchen/dishes/${b1.id}/photos`, { form: form({}, [2500], 15) })).status === 507, "追加照片超限 → 507");
  ok((await upload("容量B3", [2000], 16)).status === 201, "正好到 10000 可以");
  const dp = await req("DELETE", `/api/kitchen/dishes/${b1.id}/photos/${b1.photos[0].id}`);
  ok(dp.status === 200, "仓库满时删照片不受 507 限制");
  ok((await storage()).used_bytes === 6000, "删除后 used_bytes 下降到 6000");
  ok((await upload("容量B4", [1000, 1500], 17)).status === 201, "腾出空间后又能传");
  const s2 = await req("GET", "/api/settings");
  ok(Object.keys(s2.body).join() === "chef_enabled", "GET /api/settings 不带用量字段");
  cookie = "";
  ok((await req("GET", "/api/kitchen/storage")).status === 401, "storage 接口需要登录");
  await stop(p); p = null;

  console.log("[C] STORAGE_USED_SIM（本地模拟已用量）+ 同时超限先判 507");
  p = await start({ PHOTO_STORE: "kv", STORAGE_USED_SIM: 996147000, KV_DAILY_WRITE_LIMIT: 0 });
  s = await storage();
  ok(s.used_bytes === 996147000 && s.limit_bytes === 996147200 && s.warn === true, "已用量被模拟成 996147000，上限默认 996147200（950×1024×1024）", JSON.stringify(s));
  const both = await upload("模拟C1", [1000], 21);
  ok(both.status === 507 && both.body.error.code === "STORAGE_FULL", "容量和次数同时超：先判 507", JSON.stringify(both.body));
  ok((await upload("模拟C2", [100], 22)).status === 429, "容量够（+100 ≤ 上限）但次数为 0 → 429");
  ok(!(await names()).some((x) => x.startsWith("模拟C")), "都没留下半条菜");
  const hh = (await req("GET", "/api/health")).body;
  ok(hh.photo_store === s.store, "storage.store 与 health.photo_store 一致");
} catch (e) { fail++; fails.push(e.message); console.error(e); }
finally { if (p) await stop(p); rmSync(DIR, { recursive: true, force: true }); }
console.log(`\n结果：通过 ${pass}，失败 ${fail}${fails.length ? "\n失败项：" + fails.join("；") : ""}`);
process.exit(fail ? 1 : 0);

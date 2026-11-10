// 考拉食堂 · 接口自动化测试
// 依据：app/docs/接口约定.md 末尾 v2.1 最终定稿 + v2.2 多图 + v2.3
//      （/api/kitchen 写入、dev 登录、未登录隐私）+ v2.3.1（组长定案
//      23:20），需求文档 §9/§12；
//      2026-11-09 约定变更：单张照片上限 1MB（常量见 lib/validators.mjs
//      的 MAX_PHOTO_BYTES，全测试唯一来源）。
//
// 运行（在 app/worker 下）：node test/api.test.mjs
// 环境变量：
//   API_BASE        默认 http://localhost:8787
//   API_TIMEOUT_MS  单请求超时，默认 15000
//   ONLY=size,chef  只跑指定分组（basic/auth 总会跑）。分组：
//                   size create list edit photos anon chef settings
//                   storage quota
//                   level
//   FULL=1          全量模式（大文件/9 张/并发/整批拒绝等重用例）；
//                   默认精简模式：这些显示 SKIP(FULL only)，本轮写入
//                   目标 ≤40 次。FULL 打 localhost:8787 需
//                   ALLOW_FULL_ON_8787=1，否则拒绝（退出码 3）
//   ALT_BASE        小额度实例（507/429 用例），不设则 SKIP
//   LEVEL_BASE_DANGER  预设 ≥95% 的实例（danger 仍可上传），不设则 SKIP
//   LEVEL_BASE_ROUND   STORAGE_USED_SIM=floor(limit×0.7996) 的实例
//                      （percent=80.0 但 level=ok），不设则 SKIP
//   EXPECT_PHOTO_STORE  health.photo_store 期望值，默认 kv
//   OFFLINE=0       跳过离线校验器单测
//   STRICT=1        WARN 也算 FAIL
// 退出码：全过 0；有 FAIL 1；服务不可达 2；
//         开跑前检查不通过（剩余写入额度不足 / FULL 打 8787）3。
//
// 安全护栏（仓库公开）：
// - 厨驼密钥运行时从 worker/.dev.vars 读，只放内存，输出统一脱敏；
//   cookie 值从不打印。
// - 开跑前给已有菜（含留给厨驼的示例菜）拍快照，结束时逐项比对；
//   所有写操作/厨驼操作都先过 ownership guard，只碰本次创建的菜。
// - 不跑 seed；本次创建的菜在 finally 里全部删除；
//   chef_enabled 在 finally 里恢复为 true。
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createClient, CookieJar, makeForm, NetworkError }
  from './lib/http.mjs';
import {
  image, pngOfSize, tooLargePng, textFile, fakePng, sameBytes,
} from './lib/images.mjs';
import { createRunner, registerSecret, redact, Skip }
  from './lib/runner.mjs';
import * as V from './lib/validators.mjs';
import * as B from './lib/budget.mjs';
import { runOfflineTests } from './validators.test.mjs';

const BASE = process.env.API_BASE || 'http://localhost:8787';
const TIMEOUT = Number(process.env.API_TIMEOUT_MS) || 15000;
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim())
  .filter(Boolean);
const EXPECT_STORE = process.env.EXPECT_PHOTO_STORE || 'kv';
const FULL = process.env.FULL === '1'; // 默认精简模式
const LIMIT = V.MAX_PHOTO_BYTES; // 单张上限（字节），唯一来源
const LIMIT_TXT = `${LIMIT} 字节（${LIMIT / 1024 / 1024}MB）`;

const runner = createRunner();
const { test, soft, noErrors } = runner;
const { req: rawReq } = createClient({ base: BASE, timeoutMs: TIMEOUT });
// 记录所有 5xx（方法、路径、多伦多时间、响应体），结束时汇总打印
const http5xx = [];
async function req(m, p, o) {
  const r = await rawReq(m, p, o);
  if (r.status >= 500) {
    http5xx.push({ where: r.where, status: r.status,
      at: new Date().toLocaleString('zh-CN',
        { timeZone: 'America/Toronto', hour12: false }),
      body: r.text().slice(0, 300) });
  }
  return r;
}
const log = (...a) => console.log(redact(a.join(' ')));

const fx = JSON.parse(readFileSync(
  new URL('./fixtures/chef-submissions.json', import.meta.url), 'utf8'));
const badSub = (label) => {
  const b = fx.bad.find((x) => x.label === label);
  if (!b) throw new Error(`夹具缺少「${label}」`);
  return b.body;
};

// ---------- 密钥（不打印） ----------
function readChefKey() {
  const f = new URL('../.dev.vars', import.meta.url);
  if (!existsSync(f)) return null;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?CHEF_KEY\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[1];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    return v || null;
  }
  return null;
}
const KEY = readChefKey();
registerSecret(KEY);
const WRONG_KEY = `wrong-${crypto.randomUUID()}`;

// ---------- 请求助手 ----------
const AUTH_COOKIE = 'koala_dev_auth'; // 只是名字，值从不落盘/打印
const auth = new CookieJar(); // 已登录（大王）
const guard = V.createOwnershipGuard();
const deleted = new Set();
const RUN = Math.random().toString(36).slice(2, 6);
let seq = 0;
const tname = (s) => [...`测试${RUN}-${++seq}·${s}`].slice(0, 30)
  .join('');

const K = (m, p, o = {}) => req(m, p, { ...o, jar: auth });
const A = (m, p, o = {}) => req(m, p, { ...o, jar: undefined });
// key: undefined=正确密钥，null=不带，字符串=指定
function C(m, p, o = {}, key) {
  const k = key === undefined ? KEY : key;
  const headers = { ...(o.headers || {}) };
  if (k != null) headers['x-chef-key'] = k;
  return req(m, p, { ...o, headers, jar: undefined });
}
function kitchen(m, id, sub = '', o = {}, anon = false) {
  guard.assertOwned(id, `${m} kitchen${sub}`);
  const p = `/api/kitchen/dishes/${id}${sub}`;
  return anon ? A(m, p, o) : K(m, p, o);
}
const claimed = new Set(); // 本次被领取过的菜（30 分钟锁，不再复用）
async function chefPost(id, sub, o = {}, key) {
  guard.assertOwned(id, `厨驼 ${sub}`);
  const r = await C('POST', `/api/chef/tasks/${id}/${sub}`, o, key);
  if (sub === 'claim' && r.status === 200) claimed.add(id);
  return r;
}
function chefGet(id, sub, key) {
  guard.assertOwned(id, `厨驼读 ${sub}`);
  return C('GET', `/api/chef/tasks/${id}/${sub}`, {}, key);
}

const short = (r) => {
  const t = r.data !== null && r.data !== undefined
    ? JSON.stringify(r.data) : r.text();
  return `${r.where} → ${r.status} ${t.slice(0, 300)}`;
};
function expectOk(r, status = 200) {
  assert.equal(r.status, status, `期望 ${status}，实际：${short(r)}`);
  return r.data;
}
function expectErr(r, status, code) {
  assert.equal(r.status, status,
    `期望 ${status} ${code ?? ''}，实际：${short(r)}`);
  noErrors(V.validateErrorBody(r.data, code), '错误体');
  return r.data.error;
}
const isDish = (d) => noErrors(V.validateDish(d), 'Dish');
const fakeId = () => { const id = crypto.randomUUID(); guard.addFake(id);
  return id; };

async function postDish(form, anon = false) {
  const p = '/api/kitchen/dishes';
  const r = anon ? await A('POST', p, { form }) : await K('POST', p,
    { form });
  // 负向用例意外成功时也要登记，保证 finally 能删掉
  if (r.status >= 200 && r.status < 300 && r.data?.id) {
    guard.addCreated(r.data.id);
  }
  return r;
}
async function createDish(o = {}) {
  const { mode = 'manual', category = '家常菜', note, fields = {} } = o;
  const name = o.name ?? tname(mode);
  const photos = o.photos ?? [image('png', `${RUN}-${seq}-a`)];
  const r = await postDish(makeForm({ name, category, note, mode,
    ...fields }, photos));
  const d = expectOk(r, 201);
  isDish(d);
  return d;
}
const getDish = async (id, anon = false) => {
  const r = anon ? await A('GET', `/api/dishes/${id}`)
    : await K('GET', `/api/dishes/${id}`);
  return expectOk(r);
};
async function listDishes(query = '') {
  return expectOk(await A('GET', `/api/dishes${query}`)).dishes;
}
async function notStoredByName(name) {
  const all = await listDishes();
  assert.ok(!all.some((d) => d.name === name),
    `被拒的上传不应入库，却在列表里找到「${name}」`);
}
async function chefTasks() {
  return expectOk(await C('GET', '/api/chef/tasks')).tasks;
}
async function photoOk(url, expectBytes) {
  const r = await A('GET', url);
  assert.equal(r.status, 200, `照片应可读：${short(r)}`);
  if (expectBytes) {
    assert.ok(sameBytes(r.bytes, expectBytes.bytes),
      `${url} 内容与上传的 ${expectBytes.filename} 不一致`);
  }
  return r;
}
async function photoGone(url) {
  const r = await A('GET', url);
  assert.equal(r.status, 404, `照片应已删除（404）：${short(r)}`);
}
function need(...xs) {
  if (xs.some((x) => !x)) throw new Skip('前置用例失败，跳过');
}
const want = (g) => !ONLY.length || ONLY.includes(g);
// 重用例（大文件/9 张/并发/整批拒绝）：精简模式显示 SKIP(FULL only)
const FULL_ONLY = 'SKIP(FULL only)：重用例，精简模式不跑，FULL=1 才跑';
function heavy(name, meta, fn) {
  if (FULL) return test(name, meta, fn);
  return test(`${name} [FULL]`, meta, () => { throw new Skip(FULL_ONLY); });
}

// 精简模式的 pending 菜池：用例成功结束后把自己的菜 release 回池，
// 下一条用例取用前先恢复到干净的 pending（ask-chef），并核对：
// 无草稿、未被领取（以 tasks 为准）。用例失败不 release，
// 被服务端误改的菜绝不复用（隔离不变）。FULL=1 时每次都新建。
// any=true：用例不关心 source，也不看 requested_note。
const pool = [];
const release = (d) => {
  if (!FULL && d?.id && !deleted.has(d.id) && !pool.includes(d.id)) {
    pool.push(d.id);
  }
};
const poolStat = { reused: 0, created: 0 };
async function pendingDish({ any = false } = {}) {
  for (let i = 0; !FULL && i < pool.length; i++) {
    const id = pool[i];
    const drop = () => { pool.splice(i, 1); i -= 1; };
    if (deleted.has(id) || claimed.has(id)) { drop(); continue; }
    let g = await getDish(id);
    if (!any && g.source !== 'chef') continue;
    if (g.chef_status !== 'pending') {
      const r = await kitchen('POST', id, '/ask-chef', { json: {} });
      if (r.status !== 200) { drop(); continue; }
      g = await getDish(id);
    }
    if (!any && (g.source !== 'chef' || g.requested_note !== null)) continue;
    if (g.chef_status !== 'pending' || g.draft !== null) { drop(); continue; }
    const t = (await chefTasks()).find((x) => x.id === id);
    if (!t || (t.claimed_at ?? null) !== null) { drop(); continue; }
    pool.splice(i, 1);
    poolStat.reused += 1;
    return g;
  }
  poolStat.created += 1;
  return createDish({ mode: 'chef' });
}
function checkWarnings(data) {
  if (!('warnings' in data)) return;
  assert.ok(Array.isArray(data.warnings) &&
    data.warnings.every((w) => typeof w === 'string'),
  `warnings 应为字符串数组：${JSON.stringify(data.warnings)}`);
}

// ---------- 快照：已有菜（只读） ----------
async function snapshot() {
  const list = await listDishes();
  const m = new Map();
  for (const s of list) {
    if (guard.isOwned(s.id)) continue;
    const d = await getDish(s.id, true);
    m.set(s.id, { name: s.name, chef_status: s.chef_status,
      source: s.source, photo_count: s.photo_count,
      updated_at: d.updated_at, claimed_at: null });
  }
  if (KEY) {
    const r = await C('GET', '/api/chef/tasks');
    if (r.status === 200) {
      for (const t of r.data.tasks) {
        if (m.has(t.id)) m.get(t.id).claimed_at = t.claimed_at ?? null;
      }
    }
  }
  return m;
}

// =====================================================================
const S = {}; // 跨用例共享状态
let oldLimitSuspect = false;

async function basic() {
  const g = { api: 'GET /api/health' };
  await test('health 结构 {ok, chef_enabled, chef_pending, chef_mock, ' +
    'photo_store, orphan_photos}', g, async () => {
    const h = expectOk(await A('GET', '/api/health'));
    noErrors(V.validateHealth(h), 'health');
  });
  await test(`health.photo_store 为 ${EXPECT_STORE}（EXPECT_PHOTO_STORE）`, g,
    async () => {
      const h = expectOk(await A('GET', '/api/health'));
      assert.equal(h.photo_store, EXPECT_STORE);
    });
  await test('categories 为固定 6 类', { api: 'GET /api/categories' },
    async () => {
      const c = expectOk(await A('GET', '/api/categories'));
      assert.deepEqual(c.categories, [...V.CATEGORIES]);
    });
  await test('settings 公开可读', { api: 'GET /api/settings' }, async () => {
    noErrors(V.validateSettings(expectOk(await A('GET', '/api/settings'))),
      'settings');
  });
  await test('登录前 /api/me：logged_in=false, email=null',
    { api: 'GET /api/me', ac: '1' }, async () => {
      noErrors(V.validateMe(expectOk(await A('GET', '/api/me')), false),
        'me');
    });
  await test('详情不存在 → 404 NOT_FOUND', { api: 'GET /api/dishes/:id' },
    async () => {
      expectErr(await A('GET', `/api/dishes/${fakeId()}`), 404,
        'NOT_FOUND');
    });
  await test('照片 key 不存在 → 404', { api: 'GET /api/photos/:key' },
    async () => {
      expectErr(await A('GET',
        `/api/photos/${crypto.randomUUID()}.png`), 404, 'NOT_FOUND');
      assert.equal((await A('GET', '/api/photos/..%2F.dev.vars')).status,
        404);
    });
}

async function authSection() {
  const a = { api: 'POST /api/dev/login', ac: '1' };
  S.loggedIn = await test('dev/login 拿到 koala_dev_auth cookie', a,
    async () => {
      const r = await req('POST', '/api/dev/login', { jar: auth });
      expectOk(r);
      assert.ok(auth.has('koala_dev_auth'),
        '响应没有设置 koala_dev_auth cookie（DEV_AUTH=1 了吗？）');
    });
  await test('登录后 /api/me：logged_in=true, can_edit=true',
    { api: 'GET /api/me', ac: '1' }, async () => {
      need(S.loggedIn);
      const m = expectOk(await K('GET', '/api/me'));
      noErrors(V.validateMe(m, true), 'me');
      assert.equal(typeof m.email, 'string', '登录后应带 email');
    });
  await test('dev/logout 清 cookie 后 me 回到未登录',
    { api: 'POST /api/dev/logout' }, async () => {
      const jar = new CookieJar();
      expectOk(await req('POST', '/api/dev/login', { jar }));
      assert.ok(jar.has('koala_dev_auth'));
      expectOk(await req('POST', '/api/dev/logout', { jar }));
      assert.ok(!jar.has('koala_dev_auth'), 'logout 后 cookie 应被清除');
      const m = expectOk(await req('GET', '/api/me', { jar }));
      noErrors(V.validateMe(m, false), 'me');
    });
  await test('未登录上传 → 401 UNAUTHORIZED，不入库',
    { api: 'POST /api/kitchen/dishes', ac: '1' }, async () => {
      const name = tname('访客上传');
      const r = await postDish(makeForm({ name, category: '家常菜',
        mode: 'manual' }, [image('png', 'anon')]), true);
      expectErr(r, 401, 'UNAUTHORIZED');
      await notStoredByName(name);
    });
  await test('未登录改设置 → 401，设置不变',
    { api: 'PATCH /api/kitchen/settings', ac: '1' }, async () => {
      const before = expectOk(await A('GET', '/api/settings'));
      expectErr(await A('PATCH', '/api/kitchen/settings',
        { json: { chef_enabled: !before.chef_enabled } }), 401,
      'UNAUTHORIZED');
      assert.deepEqual(expectOk(await A('GET', '/api/settings')), before);
    });
  await test('伪造 cookie 值 → 401', { api: 'POST /api/kitchen/dishes' },
    async () => {
      const r = await req('POST', '/api/kitchen/dishes', {
        // 伪造值（不是真实 cookie），按名字拼出
        headers: { cookie: `${AUTH_COOKIE}=forged-0` },
        form: makeForm({ name: tname('伪造'), category: '家常菜' },
          [image('png', 'forged')]) });
      if (r.status === 201) guard.addCreated(r.data.id);
      expectErr(r, 401, 'UNAUTHORIZED');
    });
}

// ---------- 单张大小上限（1MB） ----------
async function sizeSection() {
  const ac = { api: 'POST /api/kitchen/dishes', ac: '2' };
  await heavy(`单张恰好 ${LIMIT_TXT} → 201，读回字节一致`, ac, async () => {
    const p = pngOfSize(LIMIT, 'exact.png');
    const r = await postDish(makeForm({ name: tname('恰好上限'),
      category: '其他', mode: 'manual' }, [p]));
    if (r.status === 413) {
      assert.fail(`恰好等于上限被拒（413），服务端上限比 ${LIMIT} 还小？` +
        short(r));
    }
    const d = expectOk(r, 201);
    isDish(d);
    const got = await photoOk(d.photos[0].url, p);
    assert.equal(got.bytes.length, LIMIT);
    S.sizeDish = d;
  });
  await heavy(`单张 ${LIMIT + 1} 字节（上限+1）→ 413 TOO_LARGE`, ac,
    async () => {
      const name = tname('超限');
      const r = await postDish(makeForm({ name, category: '其他',
        mode: 'manual' }, [tooLargePng(LIMIT)]));
      if (r.status === 201) {
        oldLimitSuspect = true;
        assert.fail(`服务端接受了 ${LIMIT + 1} 字节的照片（201）。` +
          '疑似 8787 尚未更新到 1MB 上限（仍是旧的 10MB）。');
      }
      const e = expectErr(r, 413, 'TOO_LARGE');
      soft(/1\s*MB|1MB/i.test(e.message),
        `413 提示里没写 1MB 上限：${e.message}`);
      await notStoredByName(name);
    });
  await heavy('多图上传其中一张超限 → 413 整单拒绝、不入库',
    { ...ac, api: 'POST /api/kitchen/dishes（多图）' }, async () => {
      const name = tname('多图一张超限');
      const r = await postDish(makeForm({ name, category: '其他',
        mode: 'manual' }, [image('png', 'm1'), tooLargePng(LIMIT),
        image('jpg', 'm3')]));
      if (r.status === 201) {
        oldLimitSuspect = true;
        assert.fail('多图里含超限照片却入库了，疑似服务端仍为旧上限');
      }
      const e = expectErr(r, 413, 'TOO_LARGE');
      soft(e.message.includes('第 2 张') || e.message.includes('第2张'),
        `需求 §12-4：message 应指明第几张，实际：${e.message}`);
      await notStoredByName(name);
    });
  await heavy('追加照片：上限+1 → 413，数量不变；恰好上限 → 200',
    { api: 'POST /api/kitchen/dishes/:id/photos', ac: '2' }, async () => {
      need(S.sizeDish);
      const id = S.sizeDish.id;
      const r = await kitchen('POST', id, '/photos',
        { form: makeForm({}, [tooLargePng(LIMIT)]) });
      if (r.status === 200) oldLimitSuspect = true;
      expectErr(r, 413, 'TOO_LARGE');
      assert.equal((await getDish(id)).photos.length, 1);
      const p = pngOfSize(LIMIT, 'exact2.png');
      const d = expectOk(await kitchen('POST', id, '/photos',
        { form: makeForm({}, [p]) }));
      assert.equal(d.photos.length, 2);
      await photoOk(d.photos[1].url, p);
    });
}

// ---------- 上传 / 必填 / 格式 ----------
async function createSection() {
  const up = { api: 'POST /api/kitchen/dishes' };
  await test('mode=manual 全空（只有菜名分类照片）→ 201 confirmed',
    { ...up, ac: '8' }, async () => {
      const d = await createDish({ mode: 'manual' });
      assert.equal(d.chef_status, 'confirmed');
      assert.equal(d.source, 'manual');
      assert.deepEqual([d.ingredients, d.steps, d.tips], [[], [], []]);
      assert.equal(d.draft, null);
      S.manual = d;
    });
  await test('mode=manual 带内容（JSON 字符串字段）→ 读回一致',
    { ...up, ac: '8' }, async () => {
      // 这道菜兼做（都是只读检查）：边界（菜名 30 字、备注 200 字）、
      // amount 空串、手写 13 步、列表里的「甜品饮品」
      const ing = [{ name: '鸡蛋', amount: '3个' }, { name: '盐', amount: '' }];
      const steps = [{ text: '鸡蛋打散', heat: '', time: '30秒',
        caption: '打散它！' }, ...Array.from({ length: 12 }, (_, i) => ({
        text: `手写第${i + 2}步`, heat: '', time: '', caption: '' }))];
      const note = `少放糖${'字'.repeat(197)}`;
      const d = await createDish({ mode: 'manual', category: '甜品饮品',
        name: `${RUN}${'菜'.repeat(26)}`, note,
        fields: { ingredients: ing, steps, tips: ['趁热吃'],
          servings: '2人份', total_time: '10分钟' } });
      S.content = d;
      const r = await getDish(d.id);
      assert.deepEqual(r.ingredients, ing);
      assert.deepEqual(r.steps, steps);
      assert.deepEqual(r.tips, ['趁热吃']);
      assert.equal(r.servings, '2人份');
      assert.equal(r.total_time, '10分钟');
      assert.equal(r.note, note);
    });
  await test('mode=chef → 201 pending，source=chef，内容为空',
    { ...up, ac: '3' }, async () => {
      const d = await createDish({ mode: 'chef', category: '汤羹' });
      assert.equal(d.chef_status, 'pending');
      assert.equal(d.source, 'chef');
      assert.deepEqual([d.ingredients, d.steps], [[], []]);
      assert.equal(d.draft, null);
      assert.ok(V.isIsoUtc(d.chef_requested_at), 'chef_requested_at');
      S.chef = d;
    });
  await test('旧字段名 photo（非 photos）→ 400 VALIDATION，不入库（v2.3.1）',
    { ...up, ac: '2' }, async () => {
      const name = tname('旧字段photo');
      const r = await postDish(makeForm({ name, category: '家常菜',
        mode: 'manual' }, [image('png', 'legacy')], 'photo'));
      expectErr(r, 400, 'VALIDATION');
      await notStoredByName(name);
    });
  await test('手写菜食材 amount 可为空串 → 201，读回空串；PATCH 同样允许',
    { ...up, ac: '8' }, async () => {
      const host = S.content && !deleted.has(S.content.id);
      const ing = host ? S.content.ingredients
        : [{ name: '盐', amount: '' }, { name: '糖', amount: '5克' }];
      assert.ok(ing.some((x) => x.amount === ''), '夹具应含空 amount');
      const d = host ? S.content : await createDish({ mode: 'manual',
        fields: { ingredients: ing } });
      assert.deepEqual((await getDish(d.id)).ingredients, ing);
      const ing2 = [{ name: '醋', amount: '' }];
      expectOk(await kitchen('PATCH', d.id, '', { json: {
        ingredients: ing2 } }));
      assert.deepEqual((await getDish(d.id)).ingredients, ing2);
    });
  await test('mode 非法 → 400 VALIDATION', up, async () => {
    expectErr(await postDish(makeForm({ name: tname('坏mode'),
      category: '家常菜', mode: 'ai' }, [image('png', 'x')])), 400,
    'VALIDATION');
  });
  await test('manual 的 ingredients 不是合法 JSON → 400', up, async () => {
    expectErr(await postDish(makeForm({ name: tname('坏JSON'),
      category: '家常菜', mode: 'manual', ingredients: '[{oops' },
    [image('png', 'x')])), 400, 'VALIDATION');
  });

  const req2 = { ...up, ac: '2' };
  const png = () => [image('png', `req-${seq}`)];
  const cases = [
    ['缺菜名', { category: '家常菜' }, png()],
    ['菜名全空白', { name: '   ', category: '家常菜' }, png()],
    ['菜名 31 字', { name: '菜'.repeat(31), category: '家常菜' }, png()],
    ['缺分类', { name: tname('缺分类') }, png()],
    ['分类不在固定 6 类', { name: tname('坏分类'), category: '火锅' },
      png()],
    ['没有照片', { name: tname('无照片'), category: '家常菜' }, []],
    ['备注 201 字', { name: tname('长备注'), category: '家常菜',
      note: '字'.repeat(201) }, png()],
  ];
  for (const [label, fields, photos] of cases) {
    await test(`必填/长度：${label} → 400 VALIDATION`, req2, async () => {
      const r = await postDish(makeForm({ mode: 'manual', ...fields },
        photos));
      expectErr(r, 400, 'VALIDATION');
    });
  }
  await test('边界：菜名 30 字、备注 200 字 → 201', req2, async () => {
    const d = S.content && !deleted.has(S.content.id) ? S.content
      : await createDish({ name: `${RUN}${'菜'.repeat(26)}`,
        note: '字'.repeat(200) });
    assert.equal([...d.name].length, 30);
    assert.equal([...d.note].length, 200);
  });
  await test('不是 multipart（JSON 提交）→ 400 VALIDATION', req2,
    async () => {
      const r = await K('POST', '/api/kitchen/dishes', { json: {
        name: tname('json'), category: '家常菜', mode: 'manual' } });
      if (r.status === 201) guard.addCreated(r.data.id);
      expectErr(r, 400, 'VALIDATION');
    });

  const fmt = { ...up, ac: '2' };
  await test('格式：jpg / webp 真图 → 201，读图 Content-Type 正确', fmt,
    async () => {
      const j = image('jpg', 'real-jpg');
      const w = image('webp', 'real-webp');
      const d = await createDish({ photos: [j, w] });
      S.fmt = d; S.fmtFiles = [j, w]; // 多图分组复用
      const r1 = await photoOk(d.photos[0].url, j);
      const r2 = await photoOk(d.photos[1].url, w);
      assert.match(r1.ct, /image\/jpeg/);
      assert.match(r2.ct, /image\/webp/);
    });
  const bad = [
    ['text/plain 文本文件', textFile(), 415, 'BAD_TYPE'],
    ['伪装：文本内容 + .png 扩展名 + image/png', fakePng(), 415,
      'BAD_TYPE'],
    ['GIF（不在 jpg/png/webp 内）', image('gif', 'gif'), 415, 'BAD_TYPE'],
  ];
  for (const [label, file, st, code] of bad) {
    await test(`格式：${label} → ${st} ${code}`, fmt, async () => {
      const name = tname('坏格式');
      expectErr(await postDish(makeForm({ name, category: '家常菜',
        mode: 'manual' }, [file])), st, code);
      await notStoredByName(name);
    });
  }
  await test('空文件（0 字节）→ 4xx 中文提示（期望 400 VALIDATION）', fmt,
    async () => {
      const empty = { bytes: new Uint8Array(0), type: 'image/png',
        filename: 'empty.png' };
      const r = await postDish(makeForm({ name: tname('空文件'),
        category: '家常菜', mode: 'manual' }, [empty]));
      assert.ok([400, 415].includes(r.status), short(r));
      noErrors(V.validateErrorBody(r.data), '错误体');
      soft(r.status === 400, `空文件返回 ${r.status}，约定未写死`);
    });
  await test('MIME 不符：PNG 字节标成 image/jpeg + .jpg → 201，读回 image/png',
    fmt, async () => {
      // v2.3.1：类型以文件头（magic bytes）为准
      const p = image('png', 'mime-lie');
      const lie = { ...p, type: 'image/jpeg', filename: 'lie.jpg' };
      // 兼做「手写 2 步可创建」的宿主
      const steps = [1, 2].map((i) => ({ text: `手写第${i}步`, heat: '',
        time: '', caption: '' }));
      const r = await postDish(makeForm({ name: tname('MIME不符'),
        category: '家常菜', mode: 'manual', steps }, [lie]));
      const d = expectOk(r, 201);
      S.mime = d;
      const g = await photoOk(d.photos[0].url, p);
      assert.match(g.ct, /^image\/png/,
        `应按文件头存为 image/png，实际 ${g.ct}`);
    });
  await heavy('多图其中一张格式不对 → 415 整单拒绝、不入库', fmt,
    async () => {
      const name = tname('多图坏格式');
      const r = await postDish(makeForm({ name, category: '家常菜',
        mode: 'manual' }, [image('png', 'ok1'), textFile()]));
      const e = expectErr(r, 415, 'BAD_TYPE');
      soft(e.message.includes('第 2 张'), `message 未指明第几张：${e.message}`);
      await notStoredByName(name);
    });
}

// ---------- 列表 / 分类筛选 ----------
async function listSection() {
  const l = { api: 'GET /api/dishes?category=', ac: '13' };
  let soup; let sweet;
  await test('准备：建 汤羹、甜品饮品 各一道', l, async () => {
    // 复用上传分组的汤羹（chef）和甜品饮品（手写）两道菜
    const ok = (x) => x && !deleted.has(x.id);
    soup = ok(S.chef) ? S.chef : await createDish({ category: '汤羹' });
    sweet = ok(S.content) ? S.content
      : await createDish({ category: '甜品饮品' });
    assert.equal(soup.category, '汤羹');
    assert.equal(sweet.category, '甜品饮品');
  });
  await test('分类筛选：只返回该分类，含本次汤羹、不含甜品', l,
    async () => {
      need(soup, sweet);
      const list = await listDishes(`?category=${encodeURIComponent('汤羹')}`);
      assert.ok(list.every((d) => d.category === '汤羹'),
        '筛选结果里混入了其他分类');
      assert.ok(list.some((d) => d.id === soup.id), '缺本次的汤羹');
      assert.ok(!list.some((d) => d.id === sweet.id), '混入了甜品');
      for (const s of list) noErrors(V.validateSummary(s), 'DishSummary');
    });
  await test('「全部」与不传：都含两道，按 created_at 倒序', l, async () => {
    need(soup, sweet);
    for (const q of ['', `?category=${encodeURIComponent('全部')}`]) {
      const list = await listDishes(q);
      assert.ok(list.some((d) => d.id === soup.id) &&
        list.some((d) => d.id === sweet.id), `${q || '(不传)'} 缺菜`);
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i - 1].created_at >= list[i].created_at,
          `第 ${i} 项未按 created_at 倒序`);
      }
    }
    const mine = (await listDishes()).find((d) => d.id === sweet.id);
    assert.equal(mine.photo_count, 1);
    assert.equal(mine.photo_url, sweet.photo_url);
  });
  await test('分类非法 → 400 VALIDATION', l, async () => {
    expectErr(await A('GET', `/api/dishes?category=${
      encodeURIComponent('火锅')}`), 400, 'VALIDATION');
  });
}

// ---------- 编辑后读回 ----------
async function editSection() {
  const e = { api: 'PATCH /api/kitchen/dishes/:id', ac: '9' };
  let d;
  await test('改菜名/分类/备注 → 读回一致；source/状态不变（§12-11）', e,
    async () => {
      d = S.chef && !deleted.has(S.chef.id) &&
        (await getDish(S.chef.id)).chef_status === 'pending'
        ? S.chef : await createDish({ mode: 'chef' });
      const name = tname('改名后');
      const r = expectOk(await kitchen('PATCH', d.id, '', { json: {
        name, category: '主食', note: '新备注' } }));
      isDish(r);
      for (const g of [await getDish(d.id), await getDish(d.id, true)]) {
        assert.equal(g.name, name);
        assert.equal(g.category, '主食');
        assert.equal(g.note, '新备注');
        assert.equal(g.source, 'chef');
        assert.equal(g.chef_status, 'pending', '只改文字不应作废厨驼任务');
      }
      assert.ok((await chefTasks()).some((t) => t.id === d.id),
        '只改菜名后任务不应从厨驼列表消失');
    });
  await test('改正式内容 → 读回一致，confirmed + source=manual', e,
    async () => {
      need(d);
      const body = { ingredients: [{ name: '土豆', amount: '2个' }],
        steps: [{ text: '土豆切丝', heat: '', time: '', caption: '切！' }],
        tips: ['泡水去淀粉'], servings: '3人份', total_time: '20分钟' };
      expectOk(await kitchen('PATCH', d.id, '', { json: body }));
      const g = await getDish(d.id);
      assert.deepEqual(g.ingredients, body.ingredients);
      assert.deepEqual(g.steps, body.steps);
      assert.deepEqual(g.tips, body.tips);
      assert.equal(g.servings, '3人份');
      assert.equal(g.total_time, '20分钟');
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'manual');
    });
  const bads = [
    ['菜名 31 字', { name: '菜'.repeat(31) }],
    ['分类非法', { category: '火锅' }],
    ['ingredients 不是数组', { ingredients: '土豆' }],
    ['食材缺 name', { ingredients: [{ amount: '1个' }] }],
    ['步骤缺 text', { steps: [{ heat: '大火' }] }],
  ];
  for (const [label, body] of bads) {
    await test(`PATCH 非法：${label} → 400，数据不变`, e, async () => {
      need(d);
      const before = await getDish(d.id);
      expectErr(await kitchen('PATCH', d.id, '', { json: body }), 400,
        'VALIDATION');
      assert.deepEqual(await getDish(d.id), before);
    });
  }
  await test('PATCH 非 JSON → 400；不存在的菜 → 404', e, async () => {
    need(d);
    expectErr(await kitchen('PATCH', d.id, '', { body: '{oops',
      headers: { 'content-type': 'application/json' } }), 400,
    'VALIDATION');
    expectErr(await kitchen('PATCH', fakeId(), '', { json: { note: 'x' } }),
      404, 'NOT_FOUND');
  });
  release(d); // 之后可作 any 型 pending 菜复用
}

// ---------- 多图 ----------
async function photosSection() {
  const P = '/api/kitchen/dishes/:id/photos';
  let nine; let nineFiles;
  await heavy('上传 9 张 → 201，顺序与内容逐张一致，photo_url=第一张',
    { api: 'POST /api/kitchen/dishes', ac: '2' }, async () => {
      nineFiles = Array.from({ length: 9 }, (_, i) =>
        image(['png', 'jpg', 'webp'][i % 3], `${RUN}-nine-${i}`));
      nine = await createDish({ photos: nineFiles });
      assert.equal(nine.photos.length, 9);
      assert.equal(nine.photo_url, nine.photos[0].url);
      for (let i = 0; i < 9; i++) {
        await photoOk(nine.photos[i].url, nineFiles[i]);
      }
    });
  await heavy('上传 10 张 → 400 VALIDATION，不入库',
    { api: 'POST /api/kitchen/dishes', ac: '2' }, async () => {
      const name = tname('10张');
      const files = Array.from({ length: 10 }, (_, i) =>
        image('png', `ten-${i}`));
      expectErr(await postDish(makeForm({ name, category: '家常菜',
        mode: 'manual' }, files)), 400, 'VALIDATION');
      await notStoredByName(name);
    });
  await heavy('已有 9 张再追加 1 张 → 400，仍为 9 张', { api: `POST ${P}`,
    ac: '2' }, async () => {
    need(nine);
    expectErr(await kitchen('POST', nine.id, '/photos', {
      form: makeForm({}, [image('png', 'tenth')]) }), 400, 'VALIDATION');
    assert.equal((await getDish(nine.id)).photos.length, 9);
  });
  let d; let files;
  await test('追加 1 张 → 排在最后，内容一致', { api: `POST ${P}` },
    async () => {
      if (S.fmt && !deleted.has(S.fmt.id)) { // 复用 jpg/webp 那道菜
        d = S.fmt; files = [...S.fmtFiles];
      } else {
        files = [image('png', `${RUN}-p0`), image('jpg', `${RUN}-p1`)];
        d = await createDish({ photos: files });
      }
      const add = image('png', `${RUN}-p2`);
      const r = expectOk(await kitchen('POST', d.id, '/photos', {
        form: makeForm({}, [add]) }));
      isDish(r);
      assert.equal(r.photos.length, 3);
      assert.deepEqual(r.photos.slice(0, 2), d.photos);
      await photoOk(r.photos[2].url, add);
      files.push(add);
      d = r;
    });
  await heavy('8 张时追加 2 张 → 400（总数超 9），追加 1 张 → 200',
    { api: `POST ${P}`, ac: '2' }, async () => {
      const e = await createDish({ photos: Array.from({ length: 8 },
        (_, i) => image('png', `eight-${i}`)) });
      expectErr(await kitchen('POST', e.id, '/photos', { form: makeForm({},
        [image('png', 'e9'), image('png', 'e10')]) }), 400, 'VALIDATION');
      assert.equal((await getDish(e.id)).photos.length, 8);
      const r = expectOk(await kitchen('POST', e.id, '/photos', {
        form: makeForm({}, [image('png', 'e9')]) }));
      assert.equal(r.photos.length, 9);
    });
  await test('追加：格式不对 → 415；没带照片 → 400', { api: `POST ${P}` },
    async () => {
      need(d);
      expectErr(await kitchen('POST', d.id, '/photos', {
        form: makeForm({}, [textFile()]) }), 415, 'BAD_TYPE');
      expectErr(await kitchen('POST', d.id, '/photos', {
        form: makeForm({ x: '1' }, []) }), 400, 'VALIDATION');
      assert.equal((await getDish(d.id)).photos.length, 3);
    });
  await heavy('追加批量里 1 张超限 / 1 张格式不对 → 整批拒绝、一张不加',
    { api: `POST ${P}`, ac: '§12-4' }, async () => {
      need(d);
      const before = await getDish(d.id);
      expectErr(await kitchen('POST', d.id, '/photos', { form: makeForm({},
        [image('png', 'okA'), tooLargePng(LIMIT)]) }), 413, 'TOO_LARGE');
      expectErr(await kitchen('POST', d.id, '/photos', { form: makeForm({},
        [image('png', 'okB'), textFile()]) }), 415, 'BAD_TYPE');
      assert.deepEqual((await getDish(d.id)).photos, before.photos,
        '被拒的批量里有照片入库了');
    });
  const O = { api: `PUT ${P}/order` };
  await test('排序 {ids} 倒序 → 读回持久化，封面=新第一张，列表封面同步', O,
    async () => {
      need(d);
      const ids = d.photos.map((p) => p.id).reverse();
      const r = expectOk(await kitchen('PUT', d.id, '/photos/order', {
        json: { ids } }));
      assert.deepEqual(r.photos.map((p) => p.id), ids);
      const g = await getDish(d.id, true);
      assert.deepEqual(g.photos.map((p) => p.id), ids);
      assert.equal(g.photo_url, g.photos[0].url);
      const s = (await listDishes()).find((x) => x.id === d.id);
      assert.equal(s.photo_url, g.photos[0].url);
      await photoOk(g.photos[0].url, files[2]);
      d = g;
    });
  const badOrders = [
    ['缺一张', (ids) => ids.slice(1)],
    ['重复 id', (ids) => [ids[0], ids[0], ids[1]]],
    ['混入别的菜/不存在的 id', (ids) => [ids[0], ids[1],
      crypto.randomUUID()]],
    ['ids 不是数组', () => 'abc'],
  ];
  for (const [label, f] of badOrders) {
    await test(`排序非法：${label} → 400，顺序不变`, O, async () => {
      need(d);
      const ids = d.photos.map((p) => p.id);
      expectErr(await kitchen('PUT', d.id, '/photos/order', {
        json: { ids: f(ids) } }), 400, 'VALIDATION');
      assert.deepEqual((await getDish(d.id)).photos.map((p) => p.id), ids);
    });
  }
  const D = { api: `DELETE ${P}/:photoId` };
  await test('删一张 → 少一张，照片 URL 404，其余顺序不变', D, async () => {
    need(d);
    const [gone, ...rest] = d.photos;
    const r = expectOk(await kitchen('DELETE', d.id, `/photos/${gone.id}`));
    assert.deepEqual(r.photos, rest);
    await photoGone(gone.url);
    for (const p of rest) await photoOk(p.url);
    d = r;
  });
  await test('删不存在的 photoId → 404', D, async () => {
    need(d);
    expectErr(await kitchen('DELETE', d.id,
      `/photos/${crypto.randomUUID()}`), 404, 'NOT_FOUND');
  });
  await test('删到最后一张 → 400 VALIDATION，照片仍在', D, async () => {
    need(d);
    const r = expectOk(await kitchen('DELETE', d.id,
      `/photos/${d.photos[0].id}`));
    assert.equal(r.photos.length, 1);
    expectErr(await kitchen('DELETE', d.id, `/photos/${r.photos[0].id}`),
      400, 'VALIDATION');
    const g = await getDish(d.id);
    assert.equal(g.photos.length, 1);
    await photoOk(g.photos[0].url);
  });
  await test('删除菜品 → {ok:true}，详情 404，所有照片 404，列表里没有',
    { api: 'DELETE /api/kitchen/dishes/:id' }, async () => {
      const v = nine ?? d; // 精简模式删多图分组那道菜
      need(v);
      const photos = (await getDish(v.id)).photos;
      const r = expectOk(await kitchen('DELETE', v.id));
      assert.equal(r.ok, true);
      deleted.add(v.id);
      expectErr(await A('GET', `/api/dishes/${v.id}`), 404, 'NOT_FOUND');
      for (const p of photos) await photoGone(p.url);
      assert.ok(!(await listDishes()).some((x) => x.id === v.id));
      expectErr(await kitchen('DELETE', v.id), 404, 'NOT_FOUND');
    });
}

// ---------- 访客：隐私 + 所有写接口 401 ----------
async function anonSection() {
  let d;
  await test('访客读详情：draft、requested_note 为 null，只给 chef_status',
    { api: 'GET /api/dishes/:id（访客）', ac: '1' }, async () => {
      d = await pendingDish({ any: true });
      expectOk(await kitchen('POST', d.id, '/ask-chef', { json: {
        note: '这次加了土豆' } }));
      expectOk(await chefPost(d.id, 'draft', { json: fx.ok.three }));
      const anon = await getDish(d.id, true);
      assert.equal(anon.chef_status, 'draft');
      assert.equal(anon.draft, null, '访客不应看到 draft');
      assert.equal(anon.requested_note, null, '访客不应看到 requested_note');
      const me = await getDish(d.id);
      assert.ok(V.isObj(me.draft), '登录后应看到 draft');
      assert.equal(me.requested_note, '这次加了土豆');
      const s = (await listDishes()).find((x) => x.id === d.id);
      assert.ok(!('draft' in s) && !('requested_note' in s),
        '列表不应带 draft/requested_note');
    });
  await test('访客调所有 kitchen 写接口 → 401，数据不变',
    { api: '/api/kitchen/*（访客）', ac: '1' }, async () => {
      need(d);
      const before = await getDish(d.id);
      const pid = before.photos[0].id;
      const calls = [
        ['PATCH', '', { json: { name: '黑客改名' } }],
        ['DELETE', ''],
        ['POST', '/ask-chef', { json: {} }],
        ['POST', '/confirm', { json: {} }],
        ['POST', '/discard-draft', { json: {} }],
        ['POST', '/photos', { form: makeForm({}, [image('png', 'h')]) }],
        ['DELETE', `/photos/${pid}`],
        ['PUT', '/photos/order', { json: { ids: [pid] } }],
      ];
      for (const [m, sub, o] of calls) {
        expectErr(await kitchen(m, d.id, sub, o || {}, true), 401,
          'UNAUTHORIZED');
      }
      assert.deepEqual(await getDish(d.id), before, '访客请求后数据变了');
    });
}

// ---------- 厨驼接口 ----------
async function chefSection() {
  if (!KEY) {
    await test('厨驼：读取 worker/.dev.vars 的 CHEF_KEY', async () => {
      assert.fail('没有读到 CHEF_KEY，厨驼用例无法执行');
    });
    return;
  }
  const T = { api: 'GET /api/chef/tasks', ac: '1' };
  await test('厨驼：不带 X-Chef-Key → 401 UNAUTHORIZED', T, async () => {
    expectErr(await C('GET', '/api/chef/tasks', {}, null), 401,
      'UNAUTHORIZED');
  });
  await test('厨驼：密钥错误 → 401 UNAUTHORIZED', T, async () => {
    expectErr(await C('GET', '/api/chef/tasks', {}, WRONG_KEY), 401,
      'UNAUTHORIZED');
  });
  let p; let pFile;
  await test('tasks 列表：结构正确，含本次 pending、不含 confirmed',
    { api: 'GET /api/chef/tasks' }, async () => {
      pFile = image('png', `${RUN}-chefphoto`);
      p = await createDish({ mode: 'chef', photos: [pFile,
        image('jpg', `${RUN}-chefphoto2`)] });
      const tasks = await chefTasks();
      // v2.3.1：task.photos[] 是唯一权威的照片列表（不要求 photo_url）
      for (const t of tasks) noErrors(V.validateTask(t), `task ${t.id}`);
      const mine = tasks.find((t) => t.id === p.id);
      assert.ok(mine, '本次 pending 菜不在 tasks 里');
      assert.equal(mine.photos.length, 2);
      assert.ok(tasks.every((t) => t.id !== S.manual?.id),
        'confirmed 的菜不应出现在 tasks 里');
      for (let i = 1; i < tasks.length; i++) {
        soft((tasks[i - 1].requested_at ?? '') <=
          (tasks[i].requested_at ?? ''), 'tasks 未按请求时间正序');
      }
      S.task = mine;
    });
  const CL = { api: 'POST /api/chef/tasks/:id/claim', ac: '7' };
  await test('claim：不带/错误密钥 → 401，未被领取', CL, async () => {
    need(p);
    expectErr(await chefPost(p.id, 'claim', {}, null), 401, 'UNAUTHORIZED');
    expectErr(await chefPost(p.id, 'claim', {}, WRONG_KEY), 401,
      'UNAUTHORIZED');
    const t = (await chefTasks()).find((x) => x.id === p.id);
    assert.equal(t.claimed_at ?? null, null);
  });
  await test('claim → 200 记 claimed_at；30 分钟内重复领取 → 409 CONFLICT',
    CL, async () => {
      need(p);
      const t = expectOk(await chefPost(p.id, 'claim'));
      noErrors(V.validateTask(t), 'task');
      assert.ok(V.isIsoUtc(t.claimed_at), 'claimed_at');
      expectErr(await chefPost(p.id, 'claim'), 409, 'CONFLICT');
    });
  await test('claim 不存在的菜 → 404；claim 非 pending 的菜 → 409', CL,
    async () => {
      expectErr(await chefPost(fakeId(), 'claim'), 404, 'NOT_FOUND');
      need(S.manual);
      const r = await chefPost(S.manual.id, 'claim');
      expectErr(r, 409);
      soft(r.data.error.code === 'BAD_STATE',
        `非 pending 领取返回 ${r.data.error.code}`);
    });
  await heavy('并发领取同一任务（8 路）→ 恰好 1 个成功，其余 409',
    { ...CL, api: 'POST …/claim ×8 并发' }, async () => {
      const q = await createDish({ mode: 'chef' });
      guard.assertOwned(q.id, '并发领取');
      const rs = await Promise.all(Array.from({ length: 8 }, () =>
        chefPost(q.id, 'claim')));
      const ok = rs.filter((r) => r.status === 200).length;
      const conflict = rs.filter((r) => r.status === 409).length;
      assert.equal(ok + conflict, 8,
        `出现了非 200/409：${rs.map((r) => r.status).join(',')}`);
      assert.equal(ok, 1, `8 路并发领取有 ${ok} 个成功（应恰好 1 个）——` +
        'claim 不是原子操作（先读后写，存在竞态）');
    });
  const PH = { api: 'GET /api/chef/tasks/:id/photos/:photoId' };
  await test('厨驼按 photoId 读图：内容一致；无/错密钥 401；错 id 404', PH,
    async () => {
      need(S.task);
      const ph = S.task.photos[0];
      const r = await chefGet(p.id, `photos/${ph.id}`);
      assert.equal(r.status, 200, short(r));
      assert.ok(sameBytes(r.bytes, pFile.bytes), '读到的不是这张图');
      assert.match(r.ct, /image\/png/);
      assert.equal(r.text().includes('KOALA-TEST'), true);
      expectErr(await chefGet(p.id, `photos/${ph.id}`, null), 401,
        'UNAUTHORIZED');
      expectErr(await chefGet(p.id, `photos/${ph.id}`, WRONG_KEY), 401,
        'UNAUTHORIZED');
      expectErr(await chefGet(p.id, `photos/${crypto.randomUUID()}`), 404,
        'NOT_FOUND');
      need(S.manual);
      expectErr(await chefGet(S.manual.id, `photos/${ph.id}`), 404,
        'NOT_FOUND');
    });

  await test('task.photos[] 的每个 url 带密钥可读，内容与上传一致', PH,
    async () => {
      need(S.task);
      const files = [pFile, null];
      for (const [i, ph] of S.task.photos.entries()) {
        const r = await C('GET', ph.url);
        assert.equal(r.status, 200, short(r));
        if (files[i]) assert.ok(sameBytes(r.bytes, files[i].bytes));
      }
    });
  await test('单数 /api/chef/tasks/:id/photo 已作废 → 404（v2.3.1）', PH,
    async () => {
      need(p);
      assert.equal((await chefGet(p.id, 'photo')).status, 404);
    });

  const DR = { api: 'POST /api/chef/tasks/:id/draft', ac: '7' };
  await test('交稿：不带/错误密钥 → 401，状态不变', DR, async () => {
    need(p);
    expectErr(await chefPost(p.id, 'draft', { json: fx.ok.three }, null),
      401, 'UNAUTHORIZED');
    expectErr(await chefPost(p.id, 'draft', { json: fx.ok.three },
      WRONG_KEY), 401, 'UNAUTHORIZED');
    assert.equal((await getDish(p.id)).chef_status, 'pending');
  });
  const badDrafts = fx.bad.map((b) => [b.label, { json: b.body }]);
  badDrafts.push(['不是合法 JSON', { body: '{"ingredients":[',
    headers: { 'content-type': 'application/json' } }]);
  badDrafts.push(['只有食材、steps 为空、无 chef_message',
    { json: { ingredients: [{ name: '盐', amount: '1g' }], steps: [] } }]);
  badDrafts.push(['食材空、3 步、无 chef_message', { json: {
    ingredients: [], steps: fx.ok.three.steps } }]);
  // 每个坏稿用一道独立的 pending 菜：某条若被服务端误收，
  // 不会把后面的用例连带变成 409（隔离，不放宽断言）
  for (const [label, o] of badDrafts) {
    await test(`交稿格式错：${label} → 400 VALIDATION，数据不变`, DR,
      async () => {
        const q = await pendingDish({ any: true });
        const before = await getDish(q.id);
        const e = expectErr(await chefPost(q.id, 'draft', o), 400,
          'VALIDATION');
        assert.ok(e.message.length > 4, 'message 应说明哪里不对');
        assert.deepEqual(await getDish(q.id), before);
        release(q); // 只有断言全过（菜确实没变）才回池
      });
  }
  // 明确列出步数边界（夹具里的 2 步 / 13 步已在上面跑过）
  await test('步数边界：2 步、13 步 → 400', DR, async () => {
    for (const l of ['只有 2 步', '13 步']) {
      const q = await pendingDish({ any: true });
      const b = badSub(l);
      assert.equal(b.steps.length, l === '13 步' ? 13 : 2);
      expectErr(await chefPost(q.id, 'draft', { json: b }), 400,
        'VALIDATION');
      assert.equal((await getDish(q.id)).chef_status, 'pending');
      release(q);
    }
  });
  let drafted;
  await test('交稿 3 步 → 200 draft，内容在 draft 字段，正式内容不变',
    { ...DR, ac: '4/5' }, async () => {
      need(p);
      const r = expectOk(await chefPost(p.id, 'draft', {
        json: fx.ok.three }));
      checkWarnings(r);
      const { warnings, ...dish } = r;
      isDish(dish);
      assert.equal(dish.chef_status, 'draft');
      assert.equal(dish.source, 'chef');
      assert.deepEqual([dish.ingredients, dish.steps], [[], []],
        '交稿不应直接覆盖正式内容');
      noErrors(V.validateRecipe(dish.draft), '草稿结构');
      assert.equal(dish.draft.steps.length, 3);
      assert.deepEqual(dish.draft.ingredients, fx.ok.three.ingredients);
      assert.deepEqual(dish.draft.steps.map((s) => s.text),
        fx.ok.three.steps.map((s) => s.text));
      assert.ok(!(await chefTasks()).some((t) => t.id === p.id),
        '交稿后不应还在 tasks 里');
      drafted = dish;
    });
  await test('对 draft 状态再交稿 → 409 BAD_STATE，草稿不变', DR,
    async () => {
      need(drafted);
      expectErr(await chefPost(p.id, 'draft', { json: fx.ok.twelve }), 409,
        'BAD_STATE');
      assert.deepEqual((await getDish(p.id)).draft, drafted.draft);
    });
  const CF = { api: 'POST /api/kitchen/dishes/:id/confirm', ac: '6' };
  await test('confirm 不带修改 → confirmed，source=chef，正式内容=草稿',
    CF, async () => {
      need(drafted);
      const r = expectOk(await kitchen('POST', p.id, '/confirm',
        { json: {} }));
      isDish(r);
      const g = await getDish(p.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'chef');
      assert.equal(g.draft, null);
      assert.deepEqual(g.ingredients, drafted.draft.ingredients);
      assert.deepEqual(g.steps, drafted.draft.steps);
    });
  await test('对 confirmed 交稿 / confirm → 409 BAD_STATE',
    { ...DR, ac: '7/9' }, async () => {
      need(drafted);
      expectErr(await chefPost(p.id, 'draft', { json: fx.ok.three }), 409,
        'BAD_STATE');
      expectErr(await kitchen('POST', p.id, '/confirm', { json: {} }), 409,
        'BAD_STATE');
    });
  let formal;
  await test('ask-chef 带要求 → pending，requested_note 记下，旧内容保留',
    { api: 'POST /api/kitchen/dishes/:id/ask-chef', ac: '10' }, async () => {
      need(drafted);
      formal = await getDish(p.id);
      const r = expectOk(await kitchen('POST', p.id, '/ask-chef', {
        json: { note: '少油' } }));
      assert.equal(r.chef_status, 'pending');
      assert.equal(r.requested_note, '少油');
      assert.deepEqual(r.ingredients, formal.ingredients);
      assert.deepEqual(r.steps, formal.steps);
      const t = (await chefTasks()).find((x) => x.id === p.id);
      assert.ok(t, '重写后应回到 tasks');
    });
  await test('对 pending 菜 confirm → 409 BAD_STATE', CF, async () => {
    need(formal);
    expectErr(await kitchen('POST', p.id, '/confirm', { json: {} }), 409,
      'BAD_STATE');
  });
  await test('交稿 12 步 → 200 draft；重写期间正式内容仍是旧的',
    { ...DR, ac: '10' }, async () => {
      need(formal);
      const r = expectOk(await chefPost(p.id, 'draft', {
        json: fx.ok.twelve }));
      checkWarnings(r);
      assert.equal(r.chef_status, 'draft');
      assert.equal(r.draft.steps.length, 12);
      noErrors(V.validateRecipe(r.draft), '草稿结构');
      assert.deepEqual(r.steps, formal.steps);
    });
  const badEdits = [
    ['食材缺 name', { ingredients: [{ amount: '1个' }] }],
    ['steps 不是数组', { steps: '炒一炒' }],
    ['步骤缺 text', { steps: [{ heat: '大火' }] }],
    ['tips 不是字符串数组', { tips: [{ a: 1 }] }],
  ];
  for (const [label, body] of badEdits) {
    await test(`confirm 带非法修改：${label} → 400，仍是 draft`, CF,
      async () => {
        need(formal);
        const before = await getDish(p.id);
        expectErr(await kitchen('POST', p.id, '/confirm', { json: body }),
          400, 'VALIDATION');
        assert.deepEqual(await getDish(p.id), before);
      });
  }
  await test('confirm 带修改 → 修改内容落库，source=chef，requested_note 清空',
    CF, async () => {
      need(formal);
      const body = {
        ingredients: [{ name: '鸡蛋', amount: '4个' },
          { name: '小葱', amount: '1根' }],
        steps: [
          { text: '鸡蛋打散加盐', heat: '', time: '30秒', caption: '打！' },
          { text: '热锅凉油，中火炒蛋', heat: '中火', time: '1分钟',
            caption: '滋啦' },
          { text: '撒葱花出锅', heat: '关火', time: '', caption: '出锅！' },
        ],
        tips: ['蛋液加一勺水更嫩'], servings: '2人份', total_time: '8分钟',
      };
      expectOk(await kitchen('POST', p.id, '/confirm', { json: body }));
      const g = await getDish(p.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'chef');
      assert.equal(g.draft, null);
      assert.equal(g.requested_note, null);
      assert.deepEqual(g.ingredients, body.ingredients);
      assert.deepEqual(g.steps, body.steps);
      assert.deepEqual(g.tips, body.tips);
      assert.equal(g.servings, '2人份');
      assert.equal(g.total_time, '8分钟');
    });
  // 组长定案：confirm 与交稿同一套校验（步骤 3–12），手写不受限
  for (const n of [13, 2]) {
    await test(`confirm 带修改：${n} 步 → 400 VALIDATION，菜不变`,
      { ...CF, api: 'POST …/confirm（步数校验）' }, async () => {
        const q = await pendingDish({ any: true });
        expectOk(await chefPost(q.id, 'draft', { json: fx.ok.three }));
        const before = await getDish(q.id);
        const steps = Array.from({ length: n }, (_, i) => ({
          text: `第${i + 1}步翻炒`, heat: '', time: '', caption: '' }));
        expectErr(await kitchen('POST', q.id, '/confirm', {
          json: { steps } }), 400, 'VALIDATION');
        const g = await getDish(q.id);
        assert.deepEqual(g, before, 'confirm 被拒后数据变了');
        assert.equal(g.chef_status, 'draft');
        release(q);
      });
  }
  await test('手写菜不受 3–12 步限制：创建 13 步、PATCH 2 步/1 步都接受',
    { api: 'POST/PATCH /api/kitchen/dishes（手写）', ac: '8' },
    async () => {
      const mk = (n) => Array.from({ length: n }, (_, i) => ({
        text: `手写第${i + 1}步`, heat: '', time: '', caption: '' }));
      const live = (x) => x && !deleted.has(x.id);
      // 精简：复用上传分组建的 13 步手写菜、2 步手写菜
      const d = live(S.content) ? S.content : await createDish({
        mode: 'manual', fields: { steps: mk(13) } });
      assert.equal((await getDish(d.id)).steps.length, 13);
      for (const n of [2, 1, 14]) {
        expectOk(await kitchen('PATCH', d.id, '', { json: {
          steps: mk(n) } }));
        const g = await getDish(d.id);
        assert.equal(g.steps.length, n, `PATCH ${n} 步未生效`);
        assert.equal(g.chef_status, 'confirmed');
        assert.equal(g.source, 'manual');
      }
      const e = live(S.mime) ? S.mime : await createDish({ mode: 'manual',
        fields: { steps: mk(2) } });
      assert.equal((await getDish(e.id)).steps.length, 2);
    });

  await test('不领取直接交稿 → 200 draft（v2.3.1：claim 非必需）', DR,
    async () => {
      const q = await pendingDish({ any: true });
      const t = (await chefTasks()).find((x) => x.id === q.id);
      assert.equal(t?.claimed_at ?? null, null, '应是未领取状态');
      const r = expectOk(await chefPost(q.id, 'draft', {
        json: fx.ok.three }));
      checkWarnings(r);
      assert.equal(r.chef_status, 'draft');
      assert.equal((await getDish(q.id)).chef_status, 'draft');
      release(q);
    });
  await test('confirm 只带 tips → tips 用新的，其余字段沿用草稿（v2.3.1）',
    CF, async () => {
      const q = await pendingDish();
      const dr = expectOk(await chefPost(q.id, 'draft', {
        json: fx.ok.three })).draft;
      expectOk(await kitchen('POST', q.id, '/confirm', { json: {
        tips: ['只改了贴士'] } }));
      const g = await getDish(q.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'chef');
      assert.deepEqual(g.tips, ['只改了贴士']);
      for (const k of ['ingredients', 'steps', 'servings', 'total_time']) {
        assert.deepEqual(g[k], dr[k], `${k} 未沿用草稿`);
      }
      release(q);
    });
  await test('confirm 只带 steps → 食材/份量/时长沿用草稿', CF, async () => {
    const q = await pendingDish();
    const dr = expectOk(await chefPost(q.id, 'draft', {
      json: fx.ok.three })).draft;
    const steps = [1, 2, 3].map((i) => ({ text: `改过第${i}步`,
      heat: '', time: '', caption: '' }));
    expectOk(await kitchen('POST', q.id, '/confirm', { json: { steps } }));
    const g = await getDish(q.id);
    assert.deepEqual(g.steps, steps);
    for (const k of ['ingredients', 'tips', 'servings', 'total_time']) {
      assert.deepEqual(g[k], dr[k], `${k} 未沿用草稿`);
    }
    release(q);
  });
  await test('draft 状态点 ask-chef → pending，draft 清空，正式内容不变',
    { api: 'POST /api/kitchen/dishes/:id/ask-chef', ac: '§12-7' },
    async () => {
      const q = await pendingDish();
      expectOk(await chefPost(q.id, 'draft', { json: fx.ok.three }));
      const before = await getDish(q.id);
      const r = expectOk(await kitchen('POST', q.id, '/ask-chef', {
        json: { note: '换个做法' } }));
      assert.equal(r.chef_status, 'pending');
      const g = await getDish(q.id);
      assert.equal(g.chef_status, 'pending');
      assert.equal(g.draft, null, '旧草稿应被丢弃');
      assert.deepEqual([g.ingredients, g.steps],
        [before.ingredients, before.steps]);
      assert.ok((await chefTasks()).some((t) => t.id === q.id),
        '应回到待写列表');
      release(q);
    });

  const DD = { api: 'POST /api/kitchen/dishes/:id/discard-draft', ac: '10' };
  await test('caption 超 12 字 → 交稿成功并截断，warnings 提示', DR,
    async () => {
      need(formal);
      expectOk(await kitchen('POST', p.id, '/ask-chef', { json: {} }));
      const r = expectOk(await chefPost(p.id, 'draft', {
        json: fx.ok.longCaption }));
      checkWarnings(r);
      assert.ok(r.draft.steps.every((s) => [...s.caption].length <= 12),
        'caption 应截断到 ≤12 字');
      soft(Array.isArray(r.warnings) && r.warnings.length > 0,
        '截断 caption 时没有 warnings');
    });
  await test('discard-draft → confirmed，草稿清空，正式内容不变', DD,
    async () => {
      need(formal);
      const before = await getDish(p.id);
      assert.equal(before.chef_status, 'draft');
      const r = expectOk(await kitchen('POST', p.id, '/discard-draft',
        { json: {} }));
      isDish(r);
      const g = await getDish(p.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.draft, null);
      assert.deepEqual(g.ingredients, before.ingredients);
      assert.deepEqual(g.steps, before.steps);
      assert.equal(g.source, before.source);
    });
  await test('discard-draft 对 confirmed / pending → 409 BAD_STATE，数据不变',
    { ...DD, ac: '§12-8' }, async () => {
      need(formal);
      const before = await getDish(p.id);
      expectErr(await kitchen('POST', p.id, '/discard-draft', { json: {} }),
        409, 'BAD_STATE');
      assert.deepEqual(await getDish(p.id), before);
      const q = await pendingDish({ any: true });
      const qb = await getDish(q.id);
      expectErr(await kitchen('POST', q.id, '/discard-draft', { json: {} }),
        409, 'BAD_STATE');
      assert.deepEqual(await getDish(q.id), qb);
      release(q);
    });
  await test('空稿 + chef_message → 200 draft，chef_message 保留',
    { ...DR, ac: '§12-9' }, async () => {
      const q = await pendingDish({ any: true });
      const r = expectOk(await chefPost(q.id, 'draft', {
        json: fx.ok.chefMessage }));
      checkWarnings(r);
      assert.equal(r.chef_status, 'draft');
      assert.equal(r.draft.chef_message, fx.ok.chefMessage.chef_message);
      assert.deepEqual([r.draft.ingredients, r.draft.steps], [[], []]);
      const c = await kitchen('POST', q.id, '/confirm', { json: {} });
      assert.ok([200, 400].includes(c.status), short(c));
      soft(c.status === 400, `原样 confirm 空稿返回 ${c.status}（约定未写）`);
      if (c.status === 400) {
        expectOk(await kitchen('POST', q.id, '/discard-draft',
          { json: {} }));
        assert.equal((await getDish(q.id)).chef_status, 'confirmed');
      }
      release(q);
    });

  const PV = { api: 'PATCH /api/kitchen/dishes/:id（作废任务）', ac: '9' };
  await test('pending 且已领取 → PATCH 内容 → 任务作废，再交稿/领取 409',
    PV, async () => {
      const q = await pendingDish({ any: true }); // 领取后不再复用
      expectOk(await chefPost(q.id, 'claim'));
      expectOk(await kitchen('PATCH', q.id, '', { json: {
        ingredients: [{ name: '面条', amount: '1把' }] } }));
      const g = await getDish(q.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'manual');
      assert.equal(g.draft, null);
      assert.ok(!(await chefTasks()).some((t) => t.id === q.id),
        'PATCH 后任务应从 tasks 消失');
      expectErr(await chefPost(q.id, 'draft', { json: fx.ok.three }), 409,
        'BAD_STATE');
      expectErr(await chefPost(q.id, 'claim'), 409);
    });
  await test('draft 状态 → PATCH 内容 → 草稿作废，confirm 409', PV,
    async () => {
      const q = await pendingDish({ any: true });
      expectOk(await chefPost(q.id, 'draft', { json: fx.ok.three }));
      expectOk(await kitchen('PATCH', q.id, '', { json: { steps: [
        { text: '自己写的一步', heat: '', time: '', caption: '' }] } }));
      const g = await getDish(q.id);
      assert.equal(g.chef_status, 'confirmed');
      assert.equal(g.source, 'manual');
      assert.equal(g.draft, null);
      assert.equal(g.steps.length, 1);
      expectErr(await kitchen('POST', q.id, '/confirm', { json: {} }), 409,
        'BAD_STATE');
      release(q);
    });
  await test('draft 状态只改菜名/分类/备注 → 仍是 draft，草稿保留',
    { ...PV, ac: '§12-11' }, async () => {
      const q = await pendingDish();
      const dr = expectOk(await chefPost(q.id, 'draft', {
        json: fx.ok.three })).draft;
      expectOk(await kitchen('PATCH', q.id, '', { json: {
        name: tname('草稿改名'), category: '其他', note: '改备注' } }));
      const g = await getDish(q.id);
      assert.equal(g.chef_status, 'draft');
      assert.equal(g.source, 'chef');
      assert.deepEqual(g.draft, dr, '草稿被改动/作废');
      assert.equal(g.category, '其他');
      release(q);
    });
  await test('pending 菜增删/排序照片 → 仍 pending，仍在 tasks', {
    ...PV, ac: '§12-11' }, async () => {
    const q = await pendingDish();
    const d1 = expectOk(await kitchen('POST', q.id, '/photos', {
      form: makeForm({}, [image('png', `${RUN}-pp`)]) }));
    const ids = d1.photos.map((x) => x.id).reverse();
    expectOk(await kitchen('PUT', q.id, '/photos/order', { json: { ids } }));
    expectOk(await kitchen('DELETE', q.id, `/photos/${ids[0]}`));
    const g = await getDish(q.id);
    assert.equal(g.chef_status, 'pending');
    assert.equal(g.source, 'chef');
    assert.ok((await chefTasks()).some((t) => t.id === q.id),
      '照片操作不应作废厨驼任务');
    release(q);
  });
  for (const [k, v] of [['tips', ['新贴士']], ['servings', '4人份'],
    ['total_time', '1小时'], ['steps', []]]) {
    await test(`pending 菜只改 ${k} → confirmed + source=manual，任务作废`,
      { ...PV, ac: '§12-11' }, async () => {
        const q = await pendingDish({ any: true });
        expectOk(await kitchen('PATCH', q.id, '', { json: { [k]: v } }));
        const g = await getDish(q.id);
        assert.equal(g.chef_status, 'confirmed');
        assert.equal(g.source, 'manual');
        assert.equal(g.draft, null);
        assert.deepEqual(g[k], v);
        assert.ok(!(await chefTasks()).some((t) => t.id === q.id),
          '任务应作废');
        expectErr(await chefPost(q.id, 'draft', { json: fx.ok.three }), 409,
          'BAD_STATE');
        release(q);
      });
  }
  await test('删除 pending 菜 → 任务从 tasks 消失，厨驼读图 404',
    { api: 'DELETE /api/kitchen/dishes/:id' }, async () => {
      const q = await pendingDish({ any: true });
      const t = (await chefTasks()).find((x) => x.id === q.id);
      assert.ok(t);
      expectOk(await kitchen('DELETE', q.id));
      deleted.add(q.id);
      assert.ok(!(await chefTasks()).some((x) => x.id === q.id));
      expectErr(await chefGet(q.id, `photos/${t.photos[0].id}`), 404,
        'NOT_FOUND');
    });
  await test('ask-chef 不存在的菜 → 404', { api: 'POST …/ask-chef' },
    async () => {
      expectErr(await kitchen('POST', fakeId(), '/ask-chef', { json: {} }),
        404, 'NOT_FOUND');
    });
}

// ---------- 设置 chef_enabled ----------
async function setChef(v) {
  return K('PATCH', '/api/kitchen/settings', { json: { chef_enabled: v } });
}
async function settingsSection() {
  const st = { api: 'PATCH /api/kitchen/settings', ac: '11' };
  await test('settings 非布尔 → 400 VALIDATION', st, async () => {
    expectErr(await K('PATCH', '/api/kitchen/settings', {
      json: { chef_enabled: 'false' } }), 400, 'VALIDATION');
    assert.equal(expectOk(await A('GET', '/api/settings')).chef_enabled,
      true);
  });
  let base;
  await test('准备：manual、pending 各一道，另两道 draft', st, async () => {
    base = S.manual && !deleted.has(S.manual.id) ? S.manual
      : await createDish({ mode: 'manual' });
    assert.equal((await getDish(base.id)).chef_status, 'confirmed');
    S.pendingForSettings = await pendingDish({ any: true });
    for (const k of ['draftToConfirm', 'draftToDiscard']) {
      const q = await pendingDish({ any: true });
      expectOk(await chefPost(q.id, 'draft', { json: fx.ok.three }));
      S[k] = await getDish(q.id);
      assert.equal(S[k].chef_status, 'draft');
    }
  });
  try {
    await test('关闭厨驼 → settings/health 为 false', st, async () => {
      assert.deepEqual(expectOk(await setChef(false)),
        { chef_enabled: false });
      assert.equal(expectOk(await A('GET', '/api/settings')).chef_enabled,
        false);
      assert.equal(expectOk(await A('GET', '/api/health')).chef_enabled,
        false);
    });
    await test('关闭后 mode=chef → 403 CHEF_DISABLED，不入库', st,
      async () => {
        const name = tname('关闭后chef');
        expectErr(await postDish(makeForm({ name, category: '家常菜',
          mode: 'chef' }, [image('png', 'off')])), 403, 'CHEF_DISABLED');
        await notStoredByName(name);
      });
    await test('关闭后 ask-chef → 403 CHEF_DISABLED，状态不变', st,
      async () => {
        need(base);
        expectErr(await kitchen('POST', base.id, '/ask-chef', {
          json: { note: 'x' } }), 403, 'CHEF_DISABLED');
        assert.equal((await getDish(base.id)).chef_status, 'confirmed');
      });
    await test('关闭后 manual 照常 201；已有 pending 保持 pending', st,
      async () => {
        const d = await createDish({ mode: 'manual' });
        assert.equal(d.chef_status, 'confirmed');
        need(S.pendingForSettings);
        assert.equal((await getDish(S.pendingForSettings.id)).chef_status,
          'pending');
      });
    const off = { api: '/api/chef/*（厨驼关闭）', ac: '§12-10' };
    await test('关闭后 GET /api/chef/tasks → 403 CHEF_DISABLED', off,
      async () => {
        expectErr(await C('GET', '/api/chef/tasks'), 403, 'CHEF_DISABLED');
      });
    await test('关闭后 claim → 403 CHEF_DISABLED，未被领取', off,
      async () => {
        need(S.pendingForSettings);
        expectErr(await chefPost(S.pendingForSettings.id, 'claim'), 403,
          'CHEF_DISABLED');
        assert.equal((await getDish(S.pendingForSettings.id)).chef_status,
          'pending');
      });
    await test('关闭后交稿 → 403 CHEF_DISABLED，仍 pending、无草稿', off,
      async () => {
        need(S.pendingForSettings);
        expectErr(await chefPost(S.pendingForSettings.id, 'draft', {
          json: fx.ok.three }), 403, 'CHEF_DISABLED');
        const g = await getDish(S.pendingForSettings.id);
        assert.equal(g.chef_status, 'pending');
        assert.equal(g.draft, null);
      });
    await test('关闭后已有草稿照常 confirm → confirmed', off, async () => {
      need(S.draftToConfirm);
      const id = S.draftToConfirm.id;
      expectOk(await kitchen('POST', id, '/confirm', { json: {} }));
      const g = await getDish(id);
      assert.equal(g.chef_status, 'confirmed');
      assert.deepEqual(g.steps, S.draftToConfirm.draft.steps);
    });
    await test('关闭后已有草稿照常 discard-draft → confirmed', off,
      async () => {
        need(S.draftToDiscard);
        const id = S.draftToDiscard.id;
        expectOk(await kitchen('POST', id, '/discard-draft', { json: {} }));
        const g = await getDish(id);
        assert.equal(g.chef_status, 'confirmed');
        assert.equal(g.draft, null);
      });
  } finally {
    await test('恢复 chef_enabled=true（finally）', st, async () => {
      expectOk(await setChef(true));
      assert.equal(expectOk(await A('GET', '/api/settings')).chef_enabled,
        true);
    });
  }
  await test('重新打开后 mode=chef 恢复 201 pending', st, async () => {
    const d = await createDish({ mode: 'chef' });
    assert.equal(d.chef_status, 'pending');
  });
  await test('重新打开后关闭期间的 pending 仍在 tasks、可领取', st,
    async () => {
      need(S.pendingForSettings);
      const id = S.pendingForSettings.id;
      assert.ok((await chefTasks()).some((t) => t.id === id),
        '关闭期间的 pending 任务丢了');
      expectOk(await chefPost(id, 'claim'));
    });
}

// ---------- 清理与不变量 ----------
async function cleanupAndVerify(snap) {
  const s = await A('GET', '/api/settings').catch(() => null);
  if (!s || s.status !== 200 || s.data.chef_enabled !== true) {
    await setChef(true).catch(() => {});
  }
  const failedDel = [];
  for (const id of guard.created) {
    if (deleted.has(id)) continue;
    guard.assertOwned(id, '清理删除');
    try {
      const r = await K('DELETE', `/api/kitchen/dishes/${id}`);
      if (r.status === 200 || r.status === 404) deleted.add(id);
      else failedDel.push(`${id}: ${r.status}`);
    } catch (e) { failedDel.push(`${id}: ${e.message}`); }
  }
  await test(`清理：本次创建的 ${guard.created.size} 道菜全部删除`,
    { api: 'DELETE /api/kitchen/dishes/:id' }, async () => {
      assert.deepEqual(failedDel, []);
      const list = await listDishes();
      const left = list.filter((d) => guard.isOwned(d.id));
      assert.deepEqual(left.map((d) => d.id), [], '仍有测试菜残留');
    });
  await test('chef_enabled 最终为 true', { api: 'GET /api/settings' },
    async () => {
      assert.equal(expectOk(await A('GET', '/api/settings')).chef_enabled,
        true);
    });
  await test(`已有菜（${snap?.size ?? '?'} 道，含厨驼预留）均未被改动`,
    { api: '快照比对' }, async () => {
      need(snap);
      const now = await snapshot();
      const diffs = [];
      for (const [id, b] of snap) {
        const a = now.get(id);
        if (!a) { diffs.push(`${b.name}(${id}) 不见了`); continue; }
        for (const k of Object.keys(b)) {
          if (a[k] !== b[k]) {
            diffs.push(`${b.name}.${k}: ${b[k]} → ${a[k]}`);
          }
        }
      }
      assert.deepEqual(diffs, [], '已有菜发生变化（若非本测试所为，' +
        '可能是厨驼/大王同时在操作）');
      log(`      已有菜快照：${[...snap.values()].map((v) =>
        `${v.name}=${v.chef_status}`).join('，')}`);
    });
}

// =====================================================================
async function waitForServer() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await A('GET', '/api/health', { timeout: 5000 });
      if (r.status === 200 && r.data?.ok) return true;
    } catch { /* 重试 */ }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return false;
}

// ---------- 存储用量 GET /api/kitchen/storage（组长预告） ----------
// 形状（fe7f8ba，以此为准）：{store, photo_count, capacity:{used_bytes,
// limit_bytes, percent, level, photos_left}, daily_ops:{used, limit}}。
// 服务端还没有这个接口时（带 cookie 仍 404）整块 SKIP；
// 有了之后每条都是硬断言。
const STORAGE_P = '/api/kitchen/storage';
const usedOf = (st) => st.capacity.used_bytes;
const freeOf = (st) => st.capacity.limit_bytes - st.capacity.used_bytes;
// 组长定案（覆盖约定 v2.3.1 #6 旧文案），～ 为全角波浪号
const MSG_QUOTA = '今天食堂的照片柜塞满啦，明天再来传吧～';
const MSG_FULL = '照片柜满啦，删掉一些旧照片才能继续上传～';
const MiB = 1024 * 1024; // 容量一律 1024 进制
async function storageSection() {
  const g = { api: `GET ${STORAGE_P}` };
  const probe = await K('GET', STORAGE_P);
  const why = `服务端尚无 ${STORAGE_P}（带 cookie 返回 404），整块 SKIP`;
  const sk = () => { if (probe.status === 404) throw new Skip(why); };
  const read = async () => {
    const s = expectOk(await K('GET', STORAGE_P));
    noErrors(V.validateStorage(s), 'storage');
    return s;
  };
  await test('结构：capacity{used,limit,percent,level,photos_left}、' +
    'daily_ops{used,limit}；percent/level 由字节推导', g, async () => {
    sk();
    const s = expectOk(probe);
    noErrors(V.validateStorage(s), 'storage');
    for (const m of V.storageSoftIssues(s)) soft(false, m);
    const h = expectOk(await A('GET', '/api/health'));
    assert.equal(s.store, h.photo_store,
      'storage.store 应与 health.photo_store 完全一致');
  });
  await test('未登录 → 401 UNAUTHORIZED', g, async () => {
    sk();
    expectErr(await A('GET', STORAGE_P), 401, 'UNAUTHORIZED');
  });
  // 用量增量断言要求测试期间没有别人往同一实例写照片（顺序执行）；
  // 约定若改成“近似值”，这里需改成区间判断（目前按精确值）。
  await test('上传 1 张 N 字节 → used_bytes +N、photo_count +1；' +
    '删菜后复原', g, async () => {
    sk();
    const N = 123457;
    const s0 = await read();
    const d = await createDish({
      photos: [pngOfSize(N, `${RUN}-storage-n.png`)] });
    const s1 = await read();
    assert.equal(usedOf(s1) - usedOf(s0), N, 'used_bytes 增量');
    assert.equal(s1.photo_count - s0.photo_count, 1, 'photo_count 增量');
    assert.ok(s1.daily_ops.used >= s0.daily_ops.used,
      'daily_ops.used 不应变小');
    expectOk(await kitchen('DELETE', d.id));
    deleted.add(d.id);
    const s2 = await read();
    assert.equal(usedOf(s2), usedOf(s0), '删除后 used_bytes 复原');
    assert.equal(s2.photo_count, s0.photo_count,
      '删除后 photo_count 复原');
  });
  await test('追加 1 张 M 字节 → +M；删掉这张 → 复原', g, async () => {
    sk();
    const M = 54321;
    // 复用本次已建的手写菜（追加后删掉这张，菜复原），省一次上传
    const d = S.manual && !deleted.has(S.manual.id) ? S.manual
      : await createDish();
    const s0 = await read();
    const r = expectOk(await kitchen('POST', d.id, '/photos', {
      form: makeForm({}, [pngOfSize(M, `${RUN}-storage-m.png`)]) }));
    const added = (r.photos ?? []).at(-1);
    assert.ok(added?.id, '追加后应返回 photos[]');
    const s1 = await read();
    assert.equal(usedOf(s1) - usedOf(s0), M, 'used_bytes 增量');
    assert.equal(s1.photo_count - s0.photo_count, 1, 'photo_count 增量');
    expectOk(await kitchen('DELETE', d.id, `/photos/${added.id}`));
    const s2 = await read();
    assert.equal(usedOf(s2), usedOf(s0), '删图后 used_bytes 复原');
    assert.equal(s2.photo_count, s0.photo_count,
      '删图后 photo_count 复原');
  });
}

// ---------- 其他实例（ALT_BASE / LEVEL_BASE_*）通用助手 ----------
// 每个实例独立 cookie、独立 ownership guard；只删本实例本次创建的菜。
function makeInstance(base, label) {
  const { req: areq } = createClient({ base, timeoutMs: TIMEOUT });
  const jar = new CookieJar();
  const ag = V.createOwnershipGuard();
  const gone = new Set();
  const AK = (m, p, o = {}) => areq(m, p, { ...o, jar });
  const AA = (m, p, o = {}) => areq(m, p, { ...o, jar: undefined });
  const ids = async () => expectOk(await AA('GET', '/api/dishes')).dishes
    .map((d) => d.id).sort();
  const health = async () => {
    const h = expectOk(await AA('GET', '/api/health'));
    noErrors(V.validateHealth(h), `${label} health`);
    return h;
  };
  const storageRaw = async () => {
    const r = await AK('GET', STORAGE_P);
    if (r.status !== 200) return null;
    noErrors(V.validateStorage(r.data), `${label} storage`);
    return r.data;
  };
  const storage = storageRaw;
  const del = async (id) => {
    ag.assertOwned(id, `${label} 删除`);
    const r = await AK('DELETE', `/api/kitchen/dishes/${id}`);
    if (r.status === 200 || r.status === 404) gone.add(id);
    return r;
  };
  async function upload(photos, tag) {
    const name = tname(`${label}${tag}`);
    const r = await AK('POST', '/api/kitchen/dishes', {
      form: makeForm({ name, category: '其他', mode: 'manual' }, photos) });
    if (r.status >= 200 && r.status < 300 && r.data?.id) {
      ag.addCreated(r.data.id);
    }
    return { r, name };
  }
  const state = async () => ({ ids: await ids(),
    orphan: (await health()).orphan_photos, st: await storage() });
  // 被拒的写入不留半条菜：列表 id 不变、没有新孤儿照片、用量不变
  async function noPartial(before, name) {
    const after = await state();
    assert.deepEqual(after.ids, before.ids, '列表 id 应完全不变');
    const all = expectOk(await AA('GET', '/api/dishes')).dishes;
    assert.ok(!all.some((d) => d.name === name), `不应入库：${name}`);
    assert.equal(after.orphan, before.orphan,
      'health.orphan_photos 不应增加（中途失败要删掉已写照片）');
    if (before.st && after.st) {
      assert.equal(after.st.capacity.used_bytes, before.st.capacity.used_bytes,
        'storage.used_bytes 不应变化');
      assert.equal(after.st.photo_count, before.st.photo_count,
        'storage.photo_count 不应变化');
    }
  }
  async function login() {
    await health();
    expectOk(await AK('POST', '/api/dev/login'));
    const me = expectOk(await AK('GET', '/api/me'));
    assert.equal(me.logged_in, true, `${label} 登录后 logged_in 应为 true`);
  }
  const snapKey = (s, d) => `${s.chef_status}|${s.source}|` +
    `${s.photo_count}|${d.updated_at}`;
  async function snapshotOthers() {
    const m = new Map();
    for (const s of expectOk(await AA('GET', '/api/dishes')).dishes) {
      if (ag.isOwned(s.id)) continue;
      m.set(s.id, snapKey(s, expectOk(await AA('GET', `/api/dishes/${s.id}`))));
    }
    return m;
  }
  async function cleanup() {
    for (const id of ag.created) {
      if (!gone.has(id)) await del(id).catch(() => {});
    }
  }
  // 结束：删本次创建的菜，确认无残留；已有菜逐项比对
  async function finish(g, snap) {
    await test(`${label} 清理：本次创建的菜全部删除`, g, async () => {
      await cleanup();
      const left = (await ids()).filter((id) => ag.isOwned(id));
      assert.deepEqual(left, [], `${label} 有残留`);
    });
    await test(`${label} 已有菜均未被改动`, g, async () => {
      if (!snap) throw new Skip('无快照');
      const now = await snapshotOthers();
      for (const [id, v] of snap) {
        assert.equal(now.get(id), v, `${label} 已有菜 ${id} 被改动`);
      }
    });
  }
  altCleanups.push(cleanup);
  return { AK, AA, ag, gone, ids, health, storage, storageRaw, del, upload,
    state, noPartial, login, snapshotOthers, cleanup, finish };
}

// 拼出总字节数为 total 的一组照片（每张 ≤ 单张上限，最多 9 张）
function photosOfTotal(total, tag) {
  const n = Math.max(1, Math.ceil(total / LIMIT));
  if (n > V.MAX_PHOTOS) return null;
  const out = []; let left = total;
  for (let i = 0; i < n; i++) {
    const sz = Math.ceil(left / (n - i));
    left -= sz;
    out.push(pngOfSize(sz, `${RUN}-${tag}-${i}.png`));
  }
  return out;
}

// ---------- 容量等级：LEVEL_BASE_DANGER（≥95%）----------
// 指向一个用 STORAGE_USED_SIM / STORAGE_LIMIT_BYTES 预设到 ≥95% 的实例。
// danger 只是红色提示，不拦上传；拦不拦只看 已用 + 本次 > 上限 → 507。
async function levelDangerSection() {
  const base = process.env.LEVEL_BASE_DANGER;
  const g = { api: 'LEVEL_BASE_DANGER 容量等级' };
  if (!base) {
    await test('danger（≥95%）：仍可上传；仅 已用+本次>上限 才 507', g,
      () => { throw new Skip('未设置 LEVEL_BASE_DANGER，整块 SKIP'); });
    return;
  }
  const I = makeInstance(base, 'DANGER');
  let snap = null; let ok = false;
  try {
    await test('DANGER：可连通、登录、快照已有菜', g, async () => {
      await I.login();
      snap = await I.snapshotOthers();
      ok = true;
    });
    await test('DANGER：level=danger（按字节比例 ≥95%）', g, async () => {
      if (!ok) throw new Skip('实例不可用');
      const st = await I.storage();
      assert.ok(st, '读不到 /api/kitchen/storage');
      assert.ok(st.capacity.used_bytes * 100 >= 95 * st.capacity.limit_bytes,
        `实例未预设到 ≥95%：${st.capacity.used_bytes}/${st.capacity.limit_bytes}`);
      assert.equal(st.capacity.level, 'danger');
    });
    await test('DANGER：放得下的上传 → 201（danger 不拦），随后删除', g,
      async () => {
        if (!ok) throw new Skip('实例不可用');
        const st = await I.storage();
        const free = freeOf(st);
        if (free < 1024) throw new Skip(`剩余仅 ${free} 字节，放不下 1KB`);
        const size = Math.min(LIMIT, free, 64 * 1024);
        const { r } = await I.upload([pngOfSize(size,
          `${RUN}-danger-fit.png`)], '放得下');
        const d = expectOk(r, 201);
        expectOk(await I.del(d.id));
        expectErr(await I.AA('GET', `/api/dishes/${d.id}`), 404,
          'NOT_FOUND');
      });
    await test('DANGER：正好填满（已用+本次=上限）→ 201；多 1 字节 → 507',
      g, async () => {
        if (!ok) throw new Skip('实例不可用');
        let st = await I.storage();
        const free = freeOf(st);
        const over = photosOfTotal(free + 1, 'danger-over');
        if (!over) {
          throw new Skip(`剩余 ${free} 字节 > 9 张×1MB，单次上传造不出超限`);
        }
        const before = await I.state();
        const { r, name } = await I.upload(over, '超1字节');
        assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
        await I.noPartial(before, name);
        st = await I.storage();
        const exact = photosOfTotal(freeOf(st),
          'danger-exact');
        if (!exact || exact.some((p) => p.bytes.length < 100)) {
          throw new Skip('剩余空间太小，拼不出正好填满的合法照片');
        }
        const ok2 = expectOk((await I.upload(exact, '正好满')).r, 201);
        expectOk(await I.del(ok2.id));
      });
  } finally {
    if (ok) await I.finish(g, snap);
  }
}

// ---------- 容量等级：LEVEL_BASE_ROUND（79.96% 显示 80.0 仍是 ok）----------
// 指向 STORAGE_USED_SIM = floor(limit×0.7996) 启动的实例；只读，不写。
async function levelRoundSection() {
  const base = process.env.LEVEL_BASE_ROUND;
  const g = { api: 'LEVEL_BASE_ROUND 容量等级' };
  await test('79.96%：percent=80.0，但 level=ok（按字节比例，不按四舍五入）',
    g, async () => {
      if (!base) throw new Skip('未设置 LEVEL_BASE_ROUND，SKIP');
      const I = makeInstance(base, 'ROUND');
      await I.login();
      const st = await I.storage();
      assert.ok(st, '读不到 /api/kitchen/storage');
      const want = Math.floor(st.capacity.limit_bytes * 0.7996);
      if (st.capacity.used_bytes !== want) {
        throw new Skip(`实例 used_bytes=${st.capacity.used_bytes}，不是 ` +
          `floor(limit×0.7996)=${want}（STORAGE_USED_SIM 未按约定设置）`);
      }
      assert.equal(st.capacity.percent, 80.0);
      assert.equal(st.capacity.level, 'ok');
    });
}

// ---------- 小额度实例 ALT_BASE：507 STORAGE_FULL / 429 STORAGE_QUOTA ----
// ALT_BASE 指向一个以很小的 STORAGE_LIMIT_BYTES、KV_DAILY_WRITE_LIMIT
// 启动的实例（不由测试启动）。未设置时整块 SKIP。
// 该实例同样：快照已有菜、只删本次创建的菜、不跑 seed、不改设置。
const altCleanups = [];
async function altSection() {
  const ALT = process.env.ALT_BASE;
  const g = { api: 'ALT_BASE 额度' };
  if (!ALT) {
    await test('额度用例：507 STORAGE_FULL / 429 STORAGE_QUOTA', g, () => {
      throw new Skip('未设置 ALT_BASE（小额度实例），整块 SKIP');
    });
    return;
  }
  const I = makeInstance(ALT, 'ALT');
  const { AK, AA, ag, gone, ids, health, storage, del, upload, state,
    noPartial } = I;
  let snap = null; let ok = false;
  const S2 = { full: false, quota: false };
  try {
    await test('ALT：可连通，dev/login 拿到 cookie，快照已有菜', g,
      async () => {
        await I.login();
        snap = await I.snapshotOthers();
        log(`      ALT 已有菜 ${snap.size} 道`);
        ok = true;
      });
    // 遇到 429 时记下并跳过 507 用例（额度先用完）
    const quotaFirst = async (r, before, name) => {
      assert.equal(expectErr(r, 429, 'STORAGE_QUOTA').message, MSG_QUOTA);
      await noPartial(before, name);
      S2.quota = true;
      throw new Skip('写入额度先于容量用完（429），507 无法验证；' +
        '请调大 ALT 的 KV_DAILY_WRITE_LIMIT');
    };
    await test('ALT：放得下的照片照常 201；已用+本次>上限 才 507 → 无半条菜',
      g, async () => {
        if (!ok) throw new Skip('ALT 不可用');
        // 实例可能已用 STORAGE_USED_SIM 预填：每轮先读 storage，不假设为空
        let st = await storage();
        if (st) log(`      ALT 起始：used=${st.capacity.used_bytes} ` +
          `limit=${st.capacity.limit_bytes} level=${st.capacity.level} ` +
          `ops=${st.daily_ops.used}/${st.daily_ops.limit}`);
        let stuck = 0;
        for (let i = 0; i < 60; i++) {
          const before = await state();
          st = before.st;
          const free = st ? freeOf(st) : null;
          if (st && free + 1 <= V.MAX_PHOTOS * LIMIT) {
            const over = free + 1 < 1024
              ? [pngOfSize(1024, `${RUN}-over-${i}.png`)]
              : photosOfTotal(free + 1, `over-${i}`);
            const { r, name } = await upload(over, `超${i}`);
            if (r.status === 429) await quotaFirst(r, before, name);
            assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
            await noPartial(before, name);
            S2.full = true;
            log(`      已用 ${st.capacity.used_bytes} + 本次 ${free + 1} > 上限 ` +
              `${st.capacity.limit_bytes} → 507`);
            return;
          }
          // 放得下（已用+本次 ≤ 上限）→ 必须 201，danger 也不拦
          const { r, name } = await upload(
            [pngOfSize(LIMIT, `${RUN}-fill-${i}.png`)], `填${i}`);
          if (r.status === 429) await quotaFirst(r, before, name);
          if (!st) {
            if (r.status === 201) continue;
            assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
            await noPartial(before, name);
            S2.full = true;
            return;
          }
          expectOk(r, 201);
          const after = await storage();
          stuck = usedOf(after) > usedOf(st) ? 0 : stuck + 1;
          if (stuck >= 3) {
            throw new Skip('上传后 used_bytes 不变（STORAGE_USED_SIM 固定' +
              '了已用量）且剩余 >9MB，单次上传造不出超限');
          }
        }
        assert.fail('60 次写入后仍未接近上限，ALT 的 STORAGE_LIMIT_BYTES 太大？');
      });
    await test('ALT：一次传多张，第 1 张放得下、合计超上限 → 507，整单不入库',
      g, async () => {
        if (!ok) throw new Skip('ALT 不可用');
        const st = await storage();
        if (!st) throw new Skip('ALT 无 storage 接口，算不出剩余空间');
        const free = freeOf(st);
        let batch = photosOfTotal(free + 1, 'batch');
        if (!batch) throw new Skip(`剩余 ${free} 字节 > 9 张×1MB`);
        if (batch.length === 1) {
          const t = free + 1; const h = Math.ceil(t / 2);
          if (t - h < 100) throw new Skip('剩余空间太小，拆不成两张合法照片');
          batch = [pngOfSize(h, `${RUN}-b1.png`),
            pngOfSize(t - h, `${RUN}-b2.png`)];
        }
        assert.ok(batch[0].bytes.length <= free, '第 1 张应放得下');
        const before = await state();
        const { r, name } = await upload(batch, '批量超');
        if (r.status === 429) {
          assert.equal(expectErr(r, 429, 'STORAGE_QUOTA').message, MSG_QUOTA);
          await noPartial(before, name);
          S2.quota = true;
          throw new Skip('写入额度已用完（429），批量 507 无法验证');
        }
        assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
        await noPartial(before, name);
      });
    await test('ALT：持续写入直到 429 STORAGE_QUOTA（message 固定）→ ' +
      '无半条菜；追加照片同样 429；浏览不受影响', g, async () => {
      if (!ok) throw new Skip('ALT 不可用');
      // 先腾出容量，避免 507 抢在 429 前面
      for (const id of [...ag.created]) if (!gone.has(id)) await del(id);
      const st = await storage();
      const max = st
        ? Math.max(0, st.daily_ops.limit - st.daily_ops.used) + 20 : 300;
      let keep = null; let hit = null;
      for (let i = 0; i < max; i++) {
        const before = await state();
        const { r, name } = await upload(
          [image('png', `${RUN}-q-${i}`)], `额${i}`);
        if (r.status === 201) { keep ??= r.data.id; continue; }
        if (r.status === 507) {
          assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
          await noPartial(before, name);
          throw new Skip('删掉本次的菜后容量仍满（预填过多），429 无法' +
            '单独验证');
        }
        const e = expectErr(r, 429, 'STORAGE_QUOTA');
        assert.equal(e.message, MSG_QUOTA);
        await noPartial(before, name);
        hit = i + 1;
        break;
      }
      assert.ok(hit, `${max} 次写入后仍未 429`);
      log(`      第 ${hit} 次写入返回 429`);
      if (keep) {
        const d0 = expectOk(await AA('GET', `/api/dishes/${keep}`));
        const before = await state();
        ag.assertOwned(keep, 'ALT 追加');
        const r = await AK('POST', `/api/kitchen/dishes/${keep}/photos`,
          { form: makeForm({}, [image('png', `${RUN}-q-add`)]) });
        assert.equal(expectErr(r, 429, 'STORAGE_QUOTA').message, MSG_QUOTA);
        const d1 = expectOk(await AA('GET', `/api/dishes/${keep}`));
        assert.deepEqual(d1.photos.map((p) => p.id),
          d0.photos.map((p) => p.id), '追加被拒后照片不变');
        const after = await state();
        assert.equal(after.orphan, before.orphan, '不应新增孤儿照片');
      }
      expectOk(await AA('GET', '/api/dishes'));
      S2.quota = true;
    });
    // 容量和当日写入额度同时超出：必须 507（容量优先），不能 429
    await test('ALT：容量与写入额度同时超出 → 507 STORAGE_FULL（不是 429）' +
      '，无半条菜', g, async () => {
      if (!S2.quota) throw new Skip('写入额度未确认用完（上一步未到 429）');
      const st = await storage();
      if (!st) throw new Skip('ALT 无 storage 接口，算不出剩余空间');
      const need = freeOf(st) + 1; // 超出容量 1 字节
      const n = Math.max(1, Math.ceil(need / LIMIT));
      if (n > V.MAX_PHOTOS) {
        throw new Skip(`剩余 ${need - 1} 字节，9 张 1MB 也填不满`);
      }
      const photos = [];
      for (let i = 0, left = need; i < n; i++) {
        const sz = Math.max(1024, Math.min(LIMIT, left));
        left -= sz;
        photos.push(pngOfSize(sz, `${RUN}-both-${i}.png`));
      }
      const total = photos.reduce((a, p) => a + p.bytes.length, 0);
      assert.ok(total > freeOf(st), '构造应超出容量');
      const before = await state();
      const { r, name } = await upload(photos, '双超');
      assert.equal(expectErr(r, 507, 'STORAGE_FULL').message, MSG_FULL);
      await noPartial(before, name);
    });
  } finally {
    if (ok) {
      const h = await health().catch(() => null);
      log(`      ALT 本次创建 ${ag.created.size} 道；` +
        `orphan_photos=${h?.orphan_photos}（额度用完时删除照片` +
        '会记为孤儿，属约定行为）');
      await I.finish(g, snap);
    }
  }
}

// ---------- 写入预算：开跑前检查 + 结束后实测 ----------
async function readStorageView() {
  const r = await K('GET', STORAGE_P);
  if (r.status !== 200) return { view: null, status: r.status };
  const errs = V.validateStorage(r.data);
  return { view: errs.length ? null : r.data,
    status: r.status, errs };
}
// 返回 null 表示不该跑（已打印原因）
async function preflightCheck() {
  const h = expectOk(await A('GET', '/api/health'));
  const lr = await req('POST', '/api/dev/login', { jar: auth });
  const st = lr.status === 200 ? await readStorageView()
    : { view: null, status: `dev/login ${lr.status}` };
  const p = B.preflight({ full: FULL, storage: st.view });
  if (!p.ok) {
    log(`✘ 开跑前检查未通过：${p.msg}`);
    return null;
  }
  if (p.caution) {
    log(`⚠ 开跑前检查：${p.caution}（storage 状态 ${st.status}` +
      `${st.errs?.length ? `：${st.errs.join('；')}` : ''}）`);
  } else {
    log(`      开跑前：今日写入 ${st.view.daily_ops.used}/${st.view.daily_ops.limit}，` +
      `剩余 ${p.remaining}（${FULL ? 'FULL' : '精简'}需 ≥${p.need}）`);
  }
  return { view: st.view, orphan: h.orphan_photos };
}
async function budgetReport(pre) {
  const g = { api: `GET ${STORAGE_P}（写入预算）` };
  const after = (await readStorageView()).view;
  const used = B.opsUsed(pre.view, after);
  log(used == null ? '      本轮用掉写入：无法测量（storage 不可用或跨 UTC 日）'
    : `      本轮用掉写入 ${used} 次`);
  log(`      本轮新建 ${guard.created.size} 道菜；pending 菜复用 ` +
    `${poolStat.reused} 次、新建 ${poolStat.created} 次`);
  await test(`精简模式本轮写入 ≤ ${B.LEAN_OPS_BUDGET} 次`, g, async () => {
    if (FULL) throw new Skip('FULL 模式不设预算');
    if (used == null) throw new Skip('无法测量 daily_ops.used');
    assert.ok(used <= B.LEAN_OPS_BUDGET,
      `本轮用掉 ${used} 次，超过精简预算 ${B.LEAN_OPS_BUDGET}`);
  });
  await test('health.orphan_photos 未增长', { api: 'GET /api/health' },
    async () => {
      const h = expectOk(await A('GET', '/api/health'));
      assert.equal(h.orphan_photos, pre.orphan,
        `orphan_photos ${pre.orphan} → ${h.orphan_photos}`);
    });
}

async function main() {
  log(`== 考拉食堂接口测试  base=${BASE}  单张上限=${LIMIT_TXT}` +
    `  模式=${FULL ? 'FULL' : '精简（默认）'}` +
    (ONLY.length ? `  ONLY=${ONLY.join(',')}` : '') + ' ==');
  const refuse = B.fullGuard({ full: FULL, base: BASE,
    allow: process.env.ALLOW_FULL_ON_8787 === '1' });
  if (refuse) {
    log(`✘ ${refuse}`);
    process.exitCode = B.PREFLIGHT_EXIT;
    return;
  }
  if (process.env.OFFLINE !== '0') {
    log('\n== 离线：校验器 / 护栏单测 ==');
    await runOfflineTests(runner);
  }
  log('\n== 在线：接口 ==');
  if (!(await waitForServer())) {
    log(`✘ 无法连接 ${BASE}/api/health（重试 30 秒），中止`);
    runner.summary();
    process.exitCode = 2;
    return;
  }
  // 开跑前检查（任何写入之前）：剩余写入额度够不够
  const pre = await preflightCheck();
  if (!pre) {
    process.exitCode = B.PREFLIGHT_EXIT;
    return;
  }
  let snap = null;
  await test('快照：记录已有菜的状态（只读）', { api: '快照' }, async () => {
    snap = await snapshot();
    log(`      已有菜 ${snap.size} 道`);
  });
  // Ctrl+C / kill：先恢复开关、删本次数据再退出
  const onSig = async () => {
    log('\n收到中断，正在清理…');
    await setChef(true).catch(() => {});
    for (const id of guard.created) {
      if (!deleted.has(id)) {
        await K('DELETE', `/api/kitchen/dishes/${id}`).catch(() => {});
      }
    }
    for (const f of altCleanups) await f().catch(() => {});
    process.exit(130);
  };
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);
  try {
    await basic();
    await authSection();
    if (!S.loggedIn) {
      log('✘ dev/login 失败，写入类用例无法执行');
    } else {
      const groups = [['size', sizeSection], ['create', createSection],
        ['list', listSection], ['edit', editSection],
        ['photos', photosSection], ['anon', anonSection],
        ['chef', chefSection], ['settings', settingsSection],
        ['storage', storageSection]];
      for (const [g, fn] of groups) {
        if (!want(g)) continue;
        log(`\n-- ${g} --`);
        try { await fn(); } catch (e) {
          await test(`分组 ${g} 意外中断`, async () => { throw e; });
        }
      }
    }
  } finally {
    log('\n-- 清理 / 不变量 --');
    await cleanupAndVerify(snap);
    await budgetReport(pre);
  }
  for (const [gname, label, fn] of [
    ['quota', 'quota（ALT_BASE）', altSection],
    ['level', 'level（LEVEL_BASE_DANGER）', levelDangerSection],
    ['level', 'level（LEVEL_BASE_ROUND）', levelRoundSection]]) {
    if (!want(gname)) continue;
    log(`\n-- ${label} --`);
    try { await fn(); } catch (e) {
      await test(`分组 ${label} 意外中断`, async () => { throw e; });
    }
  }
  const { failed } = runner.summary();
  log(`HTTP 5xx：${http5xx.length} 次（8787）`);
  for (const x of http5xx) {
    log(`  ${x.at} 多伦多  ${x.where} → ${x.status} ${x.body}`);
  }
  if (oldLimitSuspect) {
    log(`⚠ 大小用例显示服务端仍接受超过 ${LIMIT} 字节的照片：` +
      '8787 尚未更新到 1MB 上限（看起来仍是旧的 10MB）。');
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  log(`✘ 测试脚本异常：${e instanceof NetworkError ? e.message : e.stack}`);
  process.exitCode = 1;
});

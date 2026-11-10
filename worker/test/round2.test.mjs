// 考拉食堂 · 第二轮接口测试：厨驼 claim / draft 错误路径、并发、total_time。
//
// 只跑在「临时实例」上（自己的 --persist-to 临时目录），绝不碰 8787：
//   ROUND2_BASE=http://127.0.0.1:8820 node test/round2.test.mjs
// 必填：ROUND2_BASE（不设或指向 8787 → 拒绝，退出码 3）。
// 可选：
//   ROUND2_CLAIM_TTL_MIN  临时实例的 CHEF_CLAIM_TTL_MIN（例如 0.05 = 3 秒）；
//                         不设则「TTL 过期后可再领取」SKIP（默认 30 分钟等不起）
//   ROUND2_RACE_TRIALS    每个并发用例重复次数，默认 5（claim-race 至少 20）
//   CHEF_KEY_FILE         .dev.vars 的路径（只读；默认 worker/.dev.vars）
//   API_TIMEOUT_MS        单请求超时，默认 15000
//   STRICT=1              WARN（含 KNOWN_BUG）也算 FAIL
// 临时实例要求：DEV_AUTH=1、CHEF_KEY 与上面的 .dev.vars 一致、chef_enabled 可改。
// 本脚本会把 chef_enabled 临时改成 false，finally 里恢复 true；
// 本次创建的菜在 finally 里全部删除。
// 退出码：全过 0；有 FAIL 1；实例不可达 2；护栏拒绝 3。
import assert from 'node:assert/strict';
import { createClient, CookieJar, makeForm, NetworkError } from './lib/http.mjs';
import { image } from './lib/images.mjs';
import { createRunner, registerSecret, redact, Skip, STRICT }
  from './lib/runner.mjs';
import * as V from './lib/validators.mjs';
import * as R2 from './lib/round2.mjs';
import { readChefKey } from './lib/chefkey.mjs';

const BASE = process.env.ROUND2_BASE;
const why = R2.round2BaseError(BASE);
if (why) { console.error(`拒绝运行：${why}`); process.exit(3); }
const KEY = readChefKey();
if (!KEY) {
  console.error('拒绝运行：读不到 CHEF_KEY（检查 worker/.dev.vars 或 CHEF_KEY_FILE）');
  process.exit(3);
}
registerSecret(KEY);
const TTL_MIN = process.env.ROUND2_CLAIM_TTL_MIN
  ? Number(process.env.ROUND2_CLAIM_TTL_MIN) : null;
const TRIALS = Math.max(1, Number(process.env.ROUND2_RACE_TRIALS) || 5);
const TIMEOUT = Number(process.env.API_TIMEOUT_MS) || 15000;
const WRONG_KEY = `wrong-${crypto.randomUUID()}`;
const log = (...a) => console.log(redact(a.join(' ')));

const runner = createRunner();
const { test, soft, noErrors } = runner;
const { req } = createClient({ base: BASE, timeoutMs: TIMEOUT });
const auth = new CookieJar();
const guard = V.createOwnershipGuard();
const RUN = Math.random().toString(36).slice(2, 6);
let seq = 0;
const tname = (s) => [...`R2${RUN}-${++seq}·${s}`].slice(0, 30).join('');
const uniq = () => `${RUN}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// 已确认的真实缺陷：用例照跑，失败记为 KNOWN_BUG（WARN + 汇总），不算 FAIL。
// 修好后会自动变回 PASS 并提示把它从这里删掉。
const KNOWN_BUGS = {
  'claim-race': {
    title: '并发 claim 同一道 pending 菜，两个都返回 200（锁被重复领取）',
    repro: 'ROUND2_BASE=<临时实例> 下新建 mode=chef 的菜，' +
      'Promise.all 两个 POST /api/chef/tasks/:id/claim（正确密钥）→ 偶发两个 200，' +
      'claimed_at 相同或先后覆盖',
    cause: 'src/index.ts claim：先 SELECT 判断 claimed_at 是否在 TTL 内，再无条件 ' +
      "UPDATE ... WHERE id=? AND chef_status='pending'，UPDATE 没带 claimed_at 条件、" +
      '也没检查 meta.changes（检查与写入不是原子的）。建议：WHERE 加 ' +
      '(claimed_at IS NULL OR claimed_at < ?过期点)，changes=0 时返回 409 CONFLICT',
  },
};
const knownHits = [];

const K = (m, p, o = {}) => req(m, p, { ...o, jar: auth });
const A = (m, p, o = {}) => req(m, p, { ...o, jar: undefined });
function C(m, p, o = {}, key) {
  const k = key === undefined ? KEY : key;
  const headers = { ...(o.headers || {}) };
  if (k != null) headers['x-chef-key'] = k;
  return req(m, p, { ...o, headers, jar: undefined });
}
const chef = (id, sub, o = {}, key) => {
  guard.assertOwned(id, `厨驼 ${sub}`);
  return C('POST', `/api/chef/tasks/${id}/${sub}`, o, key);
};
const kitchen = (m, id, sub = '', o = {}) => {
  guard.assertOwned(id, `${m} kitchen${sub}`);
  return K(m, `/api/kitchen/dishes/${id}${sub}`, o);
};
const short = (r) => {
  const t = r.data != null ? JSON.stringify(r.data) : r.text();
  return `${r.where} → ${r.status} ${t.slice(0, 300)}`;
};
function expectOk(r, status = 200) {
  assert.equal(r.status, status, `期望 ${status}，实际：${short(r)}`);
  return r.data;
}
function expectErr(r, status, code) {
  assert.equal(r.status, status, `期望 ${status} ${code ?? ''}，实际：${short(r)}`);
  noErrors(V.validateErrorBody(r.data, code), '错误体');
  return r.data.error;
}
const fakeId = () => { const id = crypto.randomUUID(); guard.addFake(id); return id; };

async function createDish(mode = 'chef') {
  const form = makeForm({ name: tname(mode), category: '家常菜', mode },
    [image('png', `${RUN}-${seq}`)]);
  const r = await K('POST', '/api/kitchen/dishes', { form });
  if (r.status >= 200 && r.status < 300 && r.data?.id) guard.addCreated(r.data.id);
  const d = expectOk(r, 201);
  noErrors(V.validateDish(d), 'Dish');
  return d;
}
const getK = async (id) => expectOk(await K('GET', `/api/dishes/${id}`));
async function draftDish(tag = uniq()) {
  const d = await createDish('chef');
  expectOk(await chef(d.id, 'draft', { json: R2.taggedDraft(tag) }));
  return { ...d, tag };
}
async function confirmedDish(tag = uniq()) {
  const d = await draftDish(tag);
  const c = expectOk(await kitchen('POST', d.id, '/confirm', { json: {} }));
  assert.equal(c.chef_status, 'confirmed');
  return { ...c, tag };
}
async function manualDish() {
  const form = makeForm({ name: tname('manual'), category: '家常菜', mode: 'manual',
    ingredients: [{ name: '盐', amount: '1克' }],
    steps: [{ text: '放盐' }, { text: '翻炒' }, { text: '出锅' }] },
  [image('png', `${RUN}-${seq}-m`)]);
  const r = await K('POST', '/api/kitchen/dishes', { form });
  if (r.status >= 200 && r.status < 300 && r.data?.id) guard.addCreated(r.data.id);
  return expectOk(r, 201);
}
async function taskOf(id) {
  const t = expectOk(await C('GET', '/api/chef/tasks')).tasks;
  return t.find((x) => x.id === id) ?? null;
}
// 断言：菜仍是干净的 pending（无草稿），且 claimed_at 未变
async function stillPending(id, claimedAt = null, what = '') {
  const d = await getK(id);
  assert.equal(d.chef_status, 'pending', `${what}后状态应仍为 pending，实际 ${d.chef_status}`);
  assert.equal(d.draft, null, `${what}后不应有草稿`);
  const t = await taskOf(id);
  assert.ok(t, `${what}后应仍在 tasks 里`);
  assert.equal(t.claimed_at, claimedAt, `${what}后 claimed_at 不应改变`);
}
async function setChef(enabled) {
  return expectOk(await K('PATCH', '/api/kitchen/settings', { json: { chef_enabled: enabled } }));
}
// 并发用例：失败时若已登记为 KNOWN_BUG → WARN，否则 FAIL
// claim-race 复现率约 15%，至少跑 20 次才稳定抓到
const trialsOf = (id) => (id === 'claim-race' ? Math.max(TRIALS, 20) : TRIALS);
async function raceTest(id, name, meta, trialFn) {
  const TRIALS = trialsOf(id);
  return test(name, meta, async () => {
    const bad = [];
    for (let i = 1; i <= TRIALS; i++) {
      const errs = await trialFn(i);
      if (errs.length) bad.push(`第 ${i}/${TRIALS} 次：${errs.join('；')}`);
    }
    const kb = KNOWN_BUGS[id];
    if (bad.length && kb) {
      knownHits.push({ id, name, rate: `${bad.length}/${TRIALS}`, detail: bad[0], ...kb });
      soft(false, `KNOWN_BUG ${id}（${bad.length}/${TRIALS} 次复现）：${bad[0]}`);
      return;
    }
    if (!bad.length && kb) soft(false, `KNOWN_BUG ${id} 本轮 ${TRIALS} 次均未复现——若已修复，请从 KNOWN_BUGS 删除`);
    assert.ok(!bad.length, `${bad.length}/${TRIALS} 次不一致：\n      ` + bad.join('\n      '));
  });
}

const S = {};
async function main() {
  log(`== 第二轮：${BASE}（TTL=${TTL_MIN ?? '未给'} 分钟，并发每项 ${TRIALS} 次）==`);
  const h = await A('GET', '/api/health');
  assert.equal(h.status, 200, `health 不通：${short(h)}`);
  S.login = await test('dev/login（临时实例）', async () => {
    expectOk(await K('POST', '/api/dev/login'));
    assert.ok(auth.has('koala_dev_auth'), '没拿到登录 cookie（DEV_AUTH=1 了吗？）');
  });
  if (!S.login) return;
  await setChef(true);

  // ---------- claim 错误路径 ----------
  const c = { api: 'POST /api/chef/tasks/:id/claim' };
  await test('claim：不存在的 id → 404 NOT_FOUND', c, async () => {
    expectErr(await chef(fakeId(), 'claim'), 404, 'NOT_FOUND');
  });
  await test('claim：draft / confirmed(厨驼) / manual 的菜 → 409 BAD_STATE', c, async () => {
    const ds = [['draft', await draftDish(), 'draft'],
      ['confirmed', await confirmedDish(), 'confirmed'],
      ['manual', await manualDish(), 'confirmed']];
    for (const [k, d, want] of ds) {
      const e = expectErr(await chef(d.id, 'claim'), 409, 'BAD_STATE');
      assert.ok(V.hasChinese(e.message), `${k}：message 应为中文`);
      const after = await getK(d.id);
      assert.equal(after.chef_status, want, `${k}：状态不应改变`);
    }
  });
  await test('claim：不带密钥 / 错误密钥 → 401 UNAUTHORIZED，菜不被领取', c, async () => {
    const d = await createDish('chef');
    expectErr(await chef(d.id, 'claim', {}, null), 401, 'UNAUTHORIZED');
    expectErr(await chef(d.id, 'claim', {}, WRONG_KEY), 401, 'UNAUTHORIZED');
    expectErr(await chef(d.id, 'claim', {}, ''), 401, 'UNAUTHORIZED');
    await stillPending(d.id, null, '401 ');
  });
  await test('chef_enabled=false：claim / draft → 403 CHEF_DISABLED，菜不变', c, async () => {
    const d = await createDish('chef');
    await setChef(false);
    try {
      expectErr(await chef(d.id, 'claim'), 403, 'CHEF_DISABLED');
      expectErr(await chef(d.id, 'draft', { json: R2.taggedDraft(uniq()) }), 403, 'CHEF_DISABLED');
      expectErr(await C('GET', '/api/chef/tasks'), 403, 'CHEF_DISABLED');
    } finally { await setChef(true); }
    await stillPending(d.id, null, '403 ');
  });
  await test('claim：TTL 内重复领取 409 CONFLICT，过期后可再领取', c, async () => {
    if (TTL_MIN == null) throw new Skip('未给 ROUND2_CLAIM_TTL_MIN（临时实例需用 --var CHEF_CLAIM_TTL_MIN:<小值> 启动）');
    const ms = TTL_MIN * 60_000;
    if (ms > 30_000) throw new Skip(`TTL ${ms}ms 太长，本用例只等 ≤30 秒`);
    const d = await createDish('chef');
    const t1 = expectOk(await chef(d.id, 'claim'));
    noErrors(V.validateTask(t1), 'Task');
    assert.ok(V.isIsoUtc(t1.claimed_at));
    const e = expectErr(await chef(d.id, 'claim'), 409, 'CONFLICT');
    assert.ok(V.hasChinese(e.message));
    await new Promise((r) => setTimeout(r, ms + 1500));
    const t2 = expectOk(await chef(d.id, 'claim'));
    assert.ok(Date.parse(t2.claimed_at) > Date.parse(t1.claimed_at),
      `再领取后 claimed_at 应更新：${t1.claimed_at} → ${t2.claimed_at}`);
    assert.equal((await taskOf(d.id))?.claimed_at, t2.claimed_at);
  });

  // ---------- draft 交稿错误路径 ----------
  const dm = { api: 'POST /api/chef/tasks/:id/draft' };
  await test('draft：不存在的 id → 404 NOT_FOUND', dm, async () => {
    expectErr(await chef(fakeId(), 'draft', { json: R2.taggedDraft(uniq()) }), 404, 'NOT_FOUND');
  });
  await test('draft：已 confirmed（厨驼确认 / manual）的菜 → 409 BAD_STATE，内容不变', dm, async () => {
    for (const d of [await confirmedDish(), await manualDish()]) {
      const before = await getK(d.id);
      expectErr(await chef(d.id, 'draft', { json: R2.taggedDraft(uniq()) }), 409, 'BAD_STATE');
      const after = await getK(d.id);
      assert.equal(after.chef_status, 'confirmed');
      assert.equal(after.draft, null);
      assert.deepEqual([after.ingredients, after.steps, after.total_time],
        [before.ingredients, before.steps, before.total_time], '正式内容不应改变');
    }
  });
  await test('draft：已有草稿（draft 状态）的菜再交 → 409 BAD_STATE，原草稿不变', dm, async () => {
    const d = await draftDish();
    expectErr(await chef(d.id, 'draft', { json: R2.taggedDraft(uniq()) }), 409, 'BAD_STATE');
    const after = await getK(d.id);
    noErrors(R2.wholeDraftFrom(after.draft, [d.tag]), '原草稿');
  });
  await test('draft：格式错的草稿一律 400 VALIDATION，菜保持 pending 无草稿', dm, async () => {
    const d = await createDish('chef');
    const tg = uniq();
    const base = () => R2.taggedDraft(tg);
    const big = 'x'.repeat(1_200_000);
    const cases = [
      ['步骤 2 步（<3）', { json: R2.taggedDraft(tg, { steps: 2 }) }, [400]],
      ['步骤 13 步（>12）', { json: R2.taggedDraft(tg, { steps: 13 }) }, [400]],
      ['用量为空字符串', { json: { ...base(), ingredients: [{ name: '盐', amount: '' }] } }, [400]],
      ['用量缺失', { json: { ...base(), ingredients: [{ name: '盐' }] } }, [400]],
      ['ingredients 是字符串', { json: { ...base(), ingredients: '盐 1克' } }, [400]],
      ['steps 是对象', { json: { ...base(), steps: { text: '炒' } } }, [400]],
      ['steps 元素是数字', { json: { ...base(), steps: [1, 2, 3] } }, [400]],
      ['chef_message 是对象', { json: { ...base(), chef_message: { a: 1 } } }, [400]],
      ['chef_message 是数组', { json: { ...base(), chef_message: ['写不了'] } }, [400]],
      ['tips 是数字', { json: { ...base(), tips: 5 } }, [400]],
      ['食材为空数组（且无 chef_message）', { json: { ...base(), ingredients: [] } }, [400]],
      ['只给空数组、chef_message 为空串', { json: { ingredients: [], steps: [], chef_message: '' } }, [400]],
      ['非法 JSON', { body: '{"ingredients": [', headers: { 'content-type': 'application/json' } }, [400]],
      ['JSON 数组而非对象', { json: '[1,2,3]' }, [400]],
      ['空请求体', { body: '', headers: { 'content-type': 'application/json' } }, [400]],
      ['超大请求体（~1.2MB 步骤文字）', { json: { ...base(), steps: [{ text: big }, { text: '二' }, { text: '三' }] } }, [400, 413]],
    ];
    const bad = [];
    for (const [label, o, statuses] of cases) {
      const r = await chef(d.id, 'draft', o);
      const code = r.status === 413 ? 'TOO_LARGE' : 'VALIDATION';
      if (!statuses.includes(r.status) || V.validateErrorBody(r.data, code).length ||
          !V.hasChinese(r.data?.error?.message)) {
        bad.push(`${label}：${short(r)}`);
      }
      // 意外被接受：复位成 pending，免得后面的用例都变成 409（连锁误报）
      if (r.status === 200) expectOk(await kitchen('POST', d.id, '/ask-chef', { json: {} }));
    }
    assert.ok(!bad.length, '以下格式错的草稿没有按约定拒绝：\n      ' + bad.join('\n      '));
    await stillPending(d.id, null, '格式错交稿');
  });
  await test('draft：chef_message 给数字（约定是字符串）→ 服务端宽松转成字符串（WARN）', dm, async () => {
    const d = await createDish('chef');
    const r = await chef(d.id, 'draft', { json: { ingredients: [], steps: [], chef_message: 123 } });
    if (r.status === 400) { noErrors(V.validateErrorBody(r.data, 'VALIDATION'), '错误体'); return; }
    expectOk(r);
    soft(false, 'chef_message=123（数字）被接受并转成字符串 "123"；约定写的是字符串，' +
      '后端 str() 有意把有限数字转字符串——是否算格式错请组长定');
    const after = await getK(d.id);
    assert.equal(after.draft.chef_message, '123', '被接受时应存成字符串，不能存数字');
  });
  await test('draft：没先 claim 也能交稿 → 200，状态 draft，草稿整份', dm, async () => {
    const d = await createDish('chef');
    assert.equal((await taskOf(d.id))?.claimed_at, null);
    const tg = uniq();
    const r = expectOk(await chef(d.id, 'draft', { json: R2.taggedDraft(tg) }));
    assert.equal(r.chef_status, 'draft');
    noErrors(R2.wholeDraftFrom(r.draft, [tg]), '返回的草稿');
    const after = await getK(d.id);
    noErrors(R2.stateConsistency(after), '状态一致性');
    noErrors(R2.wholeDraftFrom(after.draft, [tg]), '读回的草稿');
    assert.equal(await taskOf(d.id), null, '交稿后不应再出现在 tasks 里');
  });
  await test('draft：claim 后交稿 → 200，claimed 清空、不在 tasks', dm, async () => {
    const d = await createDish('chef');
    expectOk(await chef(d.id, 'claim'));
    const tg = uniq();
    expectOk(await chef(d.id, 'draft', { json: R2.taggedDraft(tg) }));
    noErrors(R2.wholeDraftFrom((await getK(d.id)).draft, [tg]), '草稿');
    assert.equal(await taskOf(d.id), null);
  });
  await test('draft：只有 chef_message（食材、步骤都是空数组）→ 200', dm, async () => {
    const d = await createDish('chef');
    const msg = `这张照片看不出是什么菜，请补一句说明${uniq()}`;
    const r = expectOk(await chef(d.id, 'draft', { json: { ingredients: [], steps: [], chef_message: msg } }));
    assert.equal(r.chef_status, 'draft');
    const after = await getK(d.id);
    assert.equal(after.chef_status, 'draft');
    assert.deepEqual(after.draft.ingredients, []);
    assert.deepEqual(after.draft.steps, []);
    assert.equal(after.draft.chef_message, msg);
    noErrors(R2.stateConsistency(after), '状态一致性');
    const anon = expectOk(await A('GET', `/api/dishes/${d.id}`));
    assert.equal(anon.draft, null);
    assert.ok(!JSON.stringify(anon).includes(msg), '未登录详情泄露了 chef_message');
  });

  // ---------- 并发 ----------
  const cc = { api: '并发（Promise.all）' };
  await raceTest('claim-race', '并发：同一道菜两个 claim → 恰好一个成功', cc, async () => {
    const d = await createDish('chef');
    const [a, b] = await Promise.all([chef(d.id, 'claim'), chef(d.id, 'claim')]);
    const errs = R2.judgeClaimRace(a, b);
    const t = await taskOf(d.id);
    const won = [a, b].filter((r) => r.status === 200).map((r) => r.data.claimed_at);
    if (won.length >= 1 && !won.includes(t?.claimed_at)) errs.push(`tasks 里的 claimed_at ${t?.claimed_at} 不是任何一个成功返回的值`);
    if (won.length === 2) errs.push(`两个返回的 claimed_at：${won.join(' / ')}`);
    return errs;
  });
  await raceTest('draft-race', '并发：同一道菜两份草稿 → 恰好一份成功，草稿整份不混拼', cc, async () => {
    const d = await createDish('chef');
    const ta = uniq(), tb = uniq();
    const rs = await Promise.all([chef(d.id, 'draft', { json: R2.taggedDraft(ta) }),
      chef(d.id, 'draft', { json: R2.taggedDraft(tb) })]);
    return R2.judgeDraftRace(rs, [ta, tb], await getK(d.id));
  });
  await raceTest('draft-vs-ask', '并发：交稿 vs ask-chef → 结果是某个合法串行且自洽', cc, async () => {
    const d = await createDish('chef');
    const tg = uniq();
    const [rd, ra] = await Promise.all([chef(d.id, 'draft', { json: R2.taggedDraft(tg) }),
      kitchen('POST', d.id, '/ask-chef', { json: { note: `再写一遍${tg}` } })]);
    return R2.judgeDraftVsAsk(rd, ra, tg, await getK(d.id));
  });
  await raceTest('draft-vs-discard', '并发：交稿 vs discard-draft → 结果是某个合法串行且自洽', cc, async () => {
    const d = await createDish('chef');
    const tg = uniq();
    const [rd, rx] = await Promise.all([chef(d.id, 'draft', { json: R2.taggedDraft(tg) }),
      kitchen('POST', d.id, '/discard-draft', { json: {} })]);
    return R2.judgeDraftVsDiscard(rd, rx, tg, await getK(d.id));
  });

  // ---------- total_time / 未登录不泄露草稿 ----------
  const tm = { api: 'GET /api/dishes（未登录）' };
  const P = {};
  S.leakSetup = await test('total_time 准备：pending / draft / confirmed / 重新找厨驼后有新草稿 各一道', tm, async () => {
    P.pending = await createDish('chef');
    P.draft = await draftDish();
    P.confirmed = await confirmedDish();
    // 已确认 → 再找厨驼 → 新草稿（带新 tag），旧的正式 total_time 还在
    const re = await confirmedDish();
    expectOk(await kitchen('POST', re.id, '/ask-chef', { json: { note: '再来一版' } }));
    const tg2 = uniq();
    expectOk(await chef(re.id, 'draft', { json: R2.taggedDraft(tg2) }));
    P.redraft = { ...re, newTag: tg2, formal: re.total_time };
    assert.equal(P.redraft.formal, `T${re.tag}`.slice(0, 20));
  });
  await test('未登录列表 / 详情不泄露任何草稿内容（含 total_time）', tm, async () => {
    if (!S.leakSetup) throw new Skip('准备失败');
    const draftTags = [P.draft.tag, P.redraft.newTag];
    const list = await A('GET', '/api/dishes');
    expectOk(list);
    const leakL = R2.leakedTags(list.text(), draftTags);
    assert.deepEqual(leakL, [], `未登录列表里出现了草稿标记：${leakL.join(',')}`);
    for (const d of [P.pending, P.draft, P.redraft]) {
      const r = await A('GET', `/api/dishes/${d.id}`);
      const body = expectOk(r);
      noErrors(V.validateDish(body, { anon: true }), '未登录 Dish');
      const leak = R2.leakedTags(r.text(), draftTags);
      assert.deepEqual(leak, [], `未登录详情 ${d.id} 泄露了草稿标记：${leak.join(',')}`);
    }
    // 对照：登录后能看到草稿（说明标记确实写进去了，不是假阴性）
    const k = await K('GET', `/api/dishes/${P.draft.id}`);
    assert.ok(k.text().includes(P.draft.tag), '登录后应能看到草稿（对照组）');
  });
  await test('未登录列表 total_time：只有 confirmed 的菜带值', tm, async () => {
    if (!S.leakSetup) throw new Skip('准备失败');
    const items = expectOk(await A('GET', '/api/dishes')).dishes;
    const mine = (id) => items.find((x) => x.id === id);
    const all = [P.pending, P.draft, P.confirmed, P.redraft].map((d) => mine(d.id));
    assert.ok(all.every(Boolean), '本次创建的菜应都在列表里');
    if (all.every((x) => !('total_time' in x))) {
      throw new Skip('src 的列表还没有 total_time 字段（泄露检查已在上一条单独跑过）');
    }
    const hard = [];
    for (const x of all) {
      const formal = x.id === P.redraft.id ? P.redraft.formal : null;
      const r = R2.listTotalTimeIssues(x, { formal });
      if (r.absent) hard.push(`${x.id} 缺 total_time 字段（其他条目有）`);
      hard.push(...r.hard);
      for (const s of r.soft) soft(false, s);
    }
    assert.equal(mine(P.confirmed.id).total_time, `T${P.confirmed.tag}`.slice(0, 20),
      'confirmed 的菜在列表里应显示其正式 total_time');
    assert.equal(mine(P.pending.id).total_time, null, '新建 pending 的菜 total_time 应为 null');
    assert.equal(mine(P.draft.id).total_time, null, 'draft 的菜（从没确认过）total_time 应为 null');
    assert.ok(!hard.length, hard.join('\n      '));
  });
}

async function cleanup() {
  const left = [];
  try { await setChef(true); } catch (e) { left.push(`chef_enabled 恢复失败：${e.message}`); }
  for (const id of [...guard.created]) {
    const r = await K('DELETE', `/api/kitchen/dishes/${id}`).catch((e) => ({ status: e.message }));
    if (![200, 204, 404].includes(r.status)) left.push(`删除 ${id} → ${r.status}`);
  }
  log(`清理：删除本次创建的 ${[...guard.created].length} 道菜，chef_enabled=true` +
    (left.length ? `；问题：${left.join('；')}` : ''));
}

let code = 0;
try {
  await main();
} catch (e) {
  if (e instanceof NetworkError) { log(`实例不可达：${e.message}`); code = 2; }
  else { log(`意外错误：${e.stack || e}`); code = 1; }
} finally {
  if (S.login) await cleanup();
}
if (knownHits.length) {
  log('\n!!!!!!!! KNOWN_BUG（真实缺陷，未改 src）!!!!!!!!');
  for (const k of knownHits) {
    log(`  ● ${k.id}：${k.title}\n    复现率 ${k.rate}；${k.detail}\n    复现：${k.repro}\n    原因：${k.cause}`);
  }
}
const sum = runner.summary();
process.exitCode = code || (sum.failed ? 1 : 0);

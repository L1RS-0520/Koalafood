// 校验器 / 护栏离线单测：不需要服务器。
// 单独运行：node test/validators.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validateRecipe, validateDish, validateHealth, validateTask,
  validateErrorBody, validateSettings, validateSummary,
  validateChefSubmission, createOwnershipGuard, validateMe,
  validateStorage, storageSoftIssues, expectedLevel, validateDetails,
  expectedPercent,
} from './lib/validators.mjs';
import {
  LEAN_OPS_BUDGET, MIN_REMAINING, isLocal8787, fullGuard, preflight, opsUsed,
} from './lib/budget.mjs';
import { readChefKey } from './lib/chefkey.mjs';
import * as R2 from './lib/round2.mjs';
import { createRunner, redact, registerSecret } from './lib/runner.mjs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { isNetworkBlocked }
  from './lib/http.mjs';

const load = (f) => JSON.parse(readFileSync(
  new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

function build(base, { patch = {}, del } = {}) {
  const o = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete o[k];
    else o[k] = structuredClone(v);
  }
  if (del) delete o[del];
  return o;
}

function expectBad(errs, want) {
  assert.ok(errs.length > 0, '应报错却通过了');
  assert.ok(errs.some((e) => e.includes(want)),
    `错误里应含「${want}」，实际：${errs.join('；')}`);
}

export async function runOfflineTests(runner) {
  const { test, soft } = runner;
  const rc = load('chef-recipes.json');
  const sub = load('chef-submissions.json');
  const ds = load('dishes.json');

  const q = { api: '离线·草稿质量校验器', ac: '5' };
  for (const g of rc.good) {
    await test(`质量校验接受：${g.label}`, q, () => {
      assert.deepEqual(validateRecipe(g.recipe, g.opts), []);
    });
  }
  for (const b of rc.bad) {
    await test(`质量校验拒绝：${b.label}`, q, () => {
      expectBad(validateRecipe(b.recipe, b.opts), b.expect);
    });
  }

  const s = { api: '离线·交稿规则', ac: '7' };
  await test('交稿规则：ok 夹具全部应被接受', s, () => {
    for (const [k, v] of Object.entries(sub.ok)) {
      assert.deepEqual(validateChefSubmission(v), [], k);
    }
  });
  await test('交稿规则：3/12 步夹具同时满足质量校验', s, () => {
    assert.deepEqual(validateRecipe(sub.ok.three), []);
    assert.deepEqual(validateRecipe(sub.ok.twelve), []);
    expectBad(validateRecipe(sub.ok.longCaption), 'caption 超过');
  });
  await test('交稿规则：bad 夹具全部应被拒（400）', s, () => {
    for (const b of sub.bad) {
      assert.ok(validateChefSubmission(b.body).length > 0,
        `「${b.label}」应被拒`);
    }
  });

  const o = { api: '离线·接口对象校验器' };
  for (const g of ds.good) {
    await test(`Dish 接受：${g.label}`, o, () => {
      assert.deepEqual(validateDish(build(ds.base, g), { anon: g.anon }), []);
    });
  }
  for (const b of ds.bad) {
    await test(`Dish 拒绝：${b.label}`, o, () => {
      expectBad(validateDish(build(ds.base, b), { anon: b.anon }),
        b.expect);
    });
  }
  await test('DishSummary 接受/拒绝', o, () => {
    assert.deepEqual(validateSummary(ds.summary.good), []);
    for (const b of ds.summary.bad) {
      expectBad(validateSummary(build(ds.summary.good, b)), b.expect);
    }
  });
  await test('task 接受/拒绝', o, () => {
    assert.deepEqual(validateTask(ds.task.good), []);
    for (const b of ds.task.bad) {
      expectBad(validateTask(build(ds.task.good, b)), b.expect);
    }
  });
  await test('health 接受/拒绝', o, () => {
    for (const h of ds.health.good) {
      assert.deepEqual(validateHealth(h), []);
    }
    for (const b of ds.health.bad) expectBad(validateHealth(b.v), b.expect);
  });
  await test('health.orphan_photos：必填、非负整数', o, () => {
    const h = { ok: true, chef_enabled: true, chef_pending: 0,
      chef_mock: false, photo_store: 'kv' };
    for (const v of [0, 1, 42]) {
      assert.deepEqual(validateHealth({ ...h, orphan_photos: v }), [], v);
    }
    expectBad(validateHealth(h), 'orphan_photos');
    for (const v of [-1, 1.5, '0', null, true]) {
      expectBad(validateHealth({ ...h, orphan_photos: v }),
        'orphan_photos');
    }
  });
  await test('预算：8787 识别 / FULL 守卫', o, () => {
    for (const b of ['http://localhost:8787', 'http://127.0.0.1:8787/',
      'http://[::1]:8787']) assert.equal(isLocal8787(b), true, b);
    for (const b of ['http://localhost:8795', 'http://localhost',
      'https://koala.example.com:8787', 'not a url']) {
      assert.equal(isLocal8787(b), false, b);
    }
    const base = 'http://localhost:8787';
    assert.equal(fullGuard({ full: false, base, allow: false }), null);
    assert.match(fullGuard({ full: true, base, allow: false }),
      /ALLOW_FULL_ON_8787=1/);
    assert.equal(fullGuard({ full: true, base, allow: true }), null);
    assert.equal(fullGuard({ full: true, base: 'http://localhost:9000',
      allow: false }), null);
  });
  await test('预算：preflight 阈值（精简 60 / FULL 200）与回退', o, () => {
    assert.deepEqual(MIN_REMAINING, { lean: 60, full: 200 });
    assert.equal(LEAN_OPS_BUDGET, 40);
    const st = (t, l = 1000) => ({ daily_ops: { used: t, limit: l } });
    let r = preflight({ full: false, storage: st(940) });
    assert.equal(r.ok, true); assert.equal(r.remaining, 60);
    r = preflight({ full: false, storage: st(941) });
    assert.equal(r.ok, false); assert.equal(r.remaining, 59);
    assert.match(r.msg, /只剩 59 次/);
    assert.equal(preflight({ full: true, storage: st(800) }).ok, true);
    r = preflight({ full: true, storage: st(801) });
    assert.equal(r.ok, false); assert.match(r.msg, /FULL/);
    assert.equal(preflight({ full: false, storage: st(1000) }).ok, false);
    r = preflight({ full: false, storage: null });
    assert.equal(r.ok, true); assert.equal(r.remaining, null);
    assert.ok(r.caution);
    r = preflight({ full: true, storage: { daily_ops: { used: '3' } } });
    assert.equal(r.ok, true); assert.ok(r.caution);
  });
  await test('预算：opsUsed 差值；跨日/缺值返回 null', o, () => {
    const o = (n) => ({ daily_ops: { used: n, limit: 1000 } });
    assert.equal(opsUsed(o(10), o(47)), 37);
    assert.equal(opsUsed(o(5), o(5)), 0);
    assert.equal(opsUsed(o(900), o(12)), null);
    assert.equal(opsUsed(null, o(3)), null);
  });
  await test('storage 接受/拒绝（capacity/daily_ops，level 无 full）', o,
    () => {
      const MiB = 1024 * 1024;
      const mk = (used, limit, percent, level, left, extra = {}) => ({
        store: 'kv', photo_count: 3,
        capacity: { used_bytes: used, limit_bytes: limit, percent, level,
          photos_left: left },
        daily_ops: { used: 12, limit: 1000 }, ...extra });
      const g = mk(2335552, 950 * MiB, 0.2, 'ok', 1941);
      assert.deepEqual(validateStorage(g), []);
      assert.deepEqual(storageSoftIssues(g), []);
      // 1024 进制：1 MiB / 2 MiB = 50%（按 1000 进制会算成 52.4%）
      assert.deepEqual(validateStorage(mk(MiB, 2 * MiB, 50, 'ok', 2)), []);
      expectBad(validateStorage(mk(MiB, 2 * MiB, 52.4, 'ok', 2)),
        'percent');
      // 95% → danger；94.9% 不是 danger
      const d95 = mk(95 * MiB, 100 * MiB, 95, 'danger', 10);
      assert.deepEqual(validateStorage(d95), []);
      assert.deepEqual(storageSoftIssues(d95), []);
      expectBad(validateStorage(mk(95 * MiB, 100 * MiB, 95, 'warn', 10)),
        'danger');
      expectBad(validateStorage(mk(949, 1000, 94.9, 'danger', 0)),
        'warn');
      expectBad(validateStorage(mk(800, 1000, 80, 'ok', 0)), 'warn');
      // 'full' 已作废，是非法值
      expectBad(validateStorage(mk(MiB, MiB, 100, 'full', 0)), 'level');
      expectBad(validateStorage(mk(MiB, MiB, 100, 'FULL', 0)), 'level');
      assert.deepEqual(validateStorage(mk(MiB, MiB, 100, 'danger', 0)),
        []);
      assert.deepEqual(storageSoftIssues(mk(0, 1024000, 0, 'ok', 3)),
        ['photos_left=3，按 500KB/张应为 2']);
      expectBad(validateStorage({ ...g, store: '' }), 'store');
      expectBad(validateStorage({ ...g, photo_count: 1.5 }), 'photo_count');
      expectBad(validateStorage({ ...g, capacity: { ...g.capacity,
        used_bytes: -1 } }), 'used_bytes');
      expectBad(validateStorage({ ...g, capacity: { ...g.capacity,
        percent: '0.2%' } }), 'percent');
      expectBad(validateStorage({ ...g, daily_ops: { used: '3',
        limit: 1000 } }), 'daily_ops.used');
      const { capacity: _c, ...noCap } = g;
      expectBad(validateStorage(noCap), 'capacity');
      const { daily_ops: _o, ...noOps } = g;
      expectBad(validateStorage(noOps), 'daily_ops');
    });
  await test('storage level/percent 只由字节推导（不看 percent）', o, () => {
    const L = 950 * 1024 * 1024; // 996,147,200
    const mk = (used, percent, level) => ({ store: 'kv', photo_count: 0,
      capacity: { used_bytes: used, limit_bytes: L, percent, level,
        photos_left: Math.floor((L - used) / 512000) },
      daily_ops: { used: 0, limit: 1000 } });
    // floor(limit×0.7996)：显示 80.0，但实际 <80% → ok
    const r = Math.floor(L * 0.7996);
    assert.equal(expectedPercent(r, L), 80);
    assert.equal(expectedLevel(r, L), 'ok');
    assert.deepEqual(validateStorage(mk(r, 80, 'ok')), []);
    expectBad(validateStorage(mk(r, 80, 'warn')), '应为 ok');
    expectBad(validateStorage(mk(r, 79.9, 'ok')), 'percent');
    // 正好 80% → warn
    const w = L * 0.8;
    assert.ok(Number.isInteger(w));
    assert.equal(expectedLevel(w, L), 'warn');
    assert.deepEqual(validateStorage(mk(w, 80, 'warn')), []);
    expectBad(validateStorage(mk(w, 80, 'ok')), '应为 warn');
    assert.equal(expectedLevel(w - 1, L), 'ok');
    // 正好 95% → danger
    const d = L * 0.95;
    assert.ok(Number.isInteger(d));
    assert.equal(expectedLevel(d, L), 'danger');
    assert.deepEqual(validateStorage(mk(d, 95, 'danger')), []);
    expectBad(validateStorage(mk(d, 95, 'warn')), '应为 danger');
    // 略低于 95%：percent 四舍五入为 95.0，但 level 仍是 warn
    const u = Math.floor(L * 0.9496);
    assert.equal(expectedPercent(u, L), 95);
    assert.equal(expectedLevel(u, L), 'warn');
    assert.deepEqual(validateStorage(mk(u, 95, 'warn')), []);
    expectBad(validateStorage(mk(u, 95, 'danger')), '应为 warn');
    assert.equal(expectedLevel(d - 1, L), 'warn');
    // 'full' 非法
    expectBad(validateStorage(mk(L, 100, 'full')), 'level');
  });
  await test('me 接受/拒绝', o, () => {
    for (const g of ds.me.good) {
      assert.deepEqual(validateMe(g.v, g.logged), []);
    }
    for (const b of ds.me.bad) {
      expectBad(validateMe(b.v, b.logged), b.expect);
    }
  });
  await test('settings 接受/拒绝', o, () => {
    assert.deepEqual(validateSettings({ chef_enabled: false }), []);
    expectBad(validateSettings({ chef_enabled: 'false' }), 'chef_enabled');
    expectBad(validateSettings({ ai_enabled: true }), 'chef_enabled');
  });
  await test('错误体接受/拒绝', o, () => {
    for (const g of ds.errors.good) {
      assert.deepEqual(validateErrorBody(g.v, g.code), []);
    }
    for (const b of ds.errors.bad) {
      expectBad(validateErrorBody(b.v, b.code), b.expect);
    }
  });

  // ---------- 第二轮：并发 / 草稿一致性判定（纯函数） ----------
  const r2 = { api: '离线·第二轮判定' };
  const res = (status, code, data) => ({ status,
    data: code ? { error: { code, message: '中文' } } : (data ?? {}) });
  const norm = (d) => structuredClone(d); // 服务端规范化后结构不变
  const dish = (chef_status, draft = null) => ({ chef_status, draft,
    chef_requested_at: chef_status === 'pending' ? '2026-11-10T00:00:00.000Z' : null });
  await test('ROUND2_BASE 护栏：未设 / 8787 / 非法 → 拒绝；8820 → 放行', r2, () => {
    assert.ok(R2.round2BaseError(undefined));
    assert.ok(R2.round2BaseError(''));
    assert.ok(R2.round2BaseError('http://localhost:8787'));
    assert.ok(R2.round2BaseError('http://127.0.0.1:8787/'));
    assert.ok(R2.round2BaseError('not a url'));
    assert.equal(R2.round2BaseError('http://127.0.0.1:8820'), null);
  });
  await test('wholeDraftFrom：整份来自一个 tag 通过；混拼 / 缺 tag / 步骤数不对报错', r2, () => {
    const a = norm(R2.taggedDraft('AAA111')), b = norm(R2.taggedDraft('BBB222'));
    assert.deepEqual(R2.wholeDraftFrom(a, ['AAA111', 'BBB222']), []);
    const mix = { ...a, steps: b.steps };
    expectBad(R2.wholeDraftFrom(mix, ['AAA111', 'BBB222']), '2 份提交');
    expectBad(R2.wholeDraftFrom({ ...a, total_time: null }, ['AAA111']), 'total_time');
    expectBad(R2.wholeDraftFrom(R2.taggedDraft('AAA111', { steps: 4 }), ['AAA111']), '步骤数');
    expectBad(R2.wholeDraftFrom(null, ['AAA111']), '不是对象');
  });
  await test('judgeClaimRace：一成一 409 CONFLICT 通过；双 200 / 错码报错', r2, () => {
    assert.deepEqual(R2.judgeClaimRace(res(200), res(409, 'CONFLICT')), []);
    assert.deepEqual(R2.judgeClaimRace(res(409, 'CONFLICT'), res(200)), []);
    expectBad(R2.judgeClaimRace(res(200), res(200)), '实际 2 个');
    expectBad(R2.judgeClaimRace(res(409, 'CONFLICT'), res(409, 'CONFLICT')), '实际 0 个');
    expectBad(R2.judgeClaimRace(res(200), res(409, 'BAD_STATE')), '409 CONFLICT');
  });
  await test('judgeDraftRace：赢家整份草稿通过；双成功 / 混拼 / 草稿归属错报错', r2, () => {
    const A = R2.taggedDraft('AAA111'), Bd = R2.taggedDraft('BBB222');
    const tags = ['AAA111', 'BBB222'];
    assert.deepEqual(R2.judgeDraftRace([res(200), res(409, 'BAD_STATE')], tags,
      dish('draft', A)), []);
    expectBad(R2.judgeDraftRace([res(200), res(200)], tags, dish('draft', A)), '恰好 1 份');
    expectBad(R2.judgeDraftRace([res(200), res(409, 'BAD_STATE')], tags,
      dish('draft', Bd)), '返回 200 的是 AAA111');
    expectBad(R2.judgeDraftRace([res(200), res(409, 'BAD_STATE')], tags,
      dish('draft', { ...A, tips: Bd.tips })), '2 份提交');
    expectBad(R2.judgeDraftRace([res(200), res(409, 'BAD_STATE')], tags,
      dish('pending')), '应为 draft');
    expectBad(R2.judgeDraftRace([res(200), res(400, 'VALIDATION')], tags,
      dish('draft', A)), 'BAD_STATE');
  });
  await test('judgeDraftVsAsk：两种合法串行通过；残留草稿 / 草稿却没 200 报错', r2, () => {
    const D = R2.taggedDraft('CCC333');
    assert.deepEqual(R2.judgeDraftVsAsk(res(200), res(200), 'CCC333', dish('pending')), []);
    assert.deepEqual(R2.judgeDraftVsAsk(res(200), res(200), 'CCC333', dish('draft', D)), []);
    assert.deepEqual(R2.judgeDraftVsAsk(res(409, 'BAD_STATE'), res(200), 'CCC333', dish('pending')), []);
    expectBad(R2.judgeDraftVsAsk(res(200), res(200), 'CCC333', dish('pending', D)), '草稿');
    expectBad(R2.judgeDraftVsAsk(res(409, 'BAD_STATE'), res(200), 'CCC333', dish('draft', D)), '没返回 200');
    expectBad(R2.judgeDraftVsAsk(res(200), res(200), 'CCC333', dish('confirmed')), '合法串行');
    expectBad(R2.judgeDraftVsAsk(res(200), res(409, 'BAD_STATE'), 'CCC333', dish('draft', D)), 'ask-chef');
  });
  await test('judgeDraftVsDiscard：两种合法串行通过；状态与返回码不符报错', r2, () => {
    const D = R2.taggedDraft('DDD444');
    assert.deepEqual(R2.judgeDraftVsDiscard(res(200), res(200), 'DDD444', dish('confirmed')), []);
    assert.deepEqual(R2.judgeDraftVsDiscard(res(200), res(409, 'BAD_STATE'), 'DDD444', dish('draft', D)), []);
    expectBad(R2.judgeDraftVsDiscard(res(200), res(200), 'DDD444', dish('draft', D)), 'confirmed');
    expectBad(R2.judgeDraftVsDiscard(res(200), res(409, 'BAD_STATE'), 'DDD444', dish('confirmed')), '应为 draft');
    expectBad(R2.judgeDraftVsDiscard(res(409, 'BAD_STATE'), res(409, 'BAD_STATE'), 'DDD444', dish('pending')), '交稿应 200');
    expectBad(R2.judgeDraftVsDiscard(res(200), res(500, 'INTERNAL'), 'DDD444', dish('draft', D)), '200 或 409');
  });
  await test('listTotalTimeIssues / leakedTags：列表只显示最近一次确认的 total_time', r2, () => {
    assert.ok(R2.listTotalTimeIssues({ chef_status: 'pending' }).absent);
    assert.deepEqual(R2.listTotalTimeIssues({ chef_status: 'confirmed', total_time: '20分钟' },
      { formal: '20分钟' }).hard, []);
    assert.deepEqual(R2.listTotalTimeIssues({ chef_status: 'draft', total_time: null }).hard, []);
    // 重新找厨驼后仍显示旧的正式值 → 合规
    assert.deepEqual(R2.listTotalTimeIssues({ chef_status: 'draft', total_time: 'T1' },
      { formal: 'T1' }).hard, []);
    expectBad(R2.listTotalTimeIssues({ chef_status: 'draft', total_time: 'T9' }).hard, '最近一次确认');
    expectBad(R2.listTotalTimeIssues({ chef_status: 'pending', total_time: 'T9' },
      { formal: 'T1' }).hard, '最近一次确认');
    expectBad(R2.listTotalTimeIssues({ chef_status: 'confirmed', total_time: null },
      { formal: 'T1' }).hard, '最近一次确认');
    expectBad(R2.listTotalTimeIssues({ chef_status: 'confirmed', total_time: 5 }).hard, '字符串');
    assert.deepEqual(R2.leakedTags('{"a":"xAAA111"}', ['AAA111', 'BBB222']), ['AAA111']);
    assert.deepEqual(R2.leakedTags('{}', ['AAA111']), []);
  });
  await test('judgeDiscardVsAsk：两种串行都必须落在 pending 且保留 ask 的 note', r2, () => {
    const pend = (note) => ({ ...dish('pending'), requested_note: note });
    assert.deepEqual(R2.judgeDiscardVsAsk(res(200), res(200), 'n1', pend('n1')), []);
    assert.deepEqual(R2.judgeDiscardVsAsk(res(409, 'BAD_STATE'), res(200), 'n1', pend('n1')), []);
    expectBad(R2.judgeDiscardVsAsk(res(200), res(200), 'n1', dish('confirmed')), 'pending');
    expectBad(R2.judgeDiscardVsAsk(res(200), res(200), 'n1', pend(null)), 'requested_note');
    expectBad(R2.judgeDiscardVsAsk(res(409, 'CONFLICT'), res(200), 'n1', pend('n1')), 'discard');
  });
  await test('judgeConfirmVsAsk：confirm 200 → 正式=草稿；409 → 正式不变；最终都 pending', r2, () => {
    const tt = { draftTT: 'Tnew', oldTT: null };
    const pend = (t) => ({ ...dish('pending'), total_time: t });
    assert.deepEqual(R2.judgeConfirmVsAsk(res(200), res(200), tt, pend('Tnew')), []);
    assert.deepEqual(R2.judgeConfirmVsAsk(res(409, 'BAD_STATE'), res(200), tt, pend(null)), []);
    expectBad(R2.judgeConfirmVsAsk(res(200), res(200), tt, { ...dish('confirmed'), total_time: 'Tnew' }), 'pending');
    expectBad(R2.judgeConfirmVsAsk(res(200), res(200), tt, pend(null)), '草稿值');
    expectBad(R2.judgeConfirmVsAsk(res(409, 'BAD_STATE'), res(200), tt, pend('Tnew')), '不变');
  });
  await test('judgeConfirmVsDiscard：恰好一个成功，正式内容跟赢家走', r2, () => {
    const tt = { draftTT: 'Tnew', oldTT: null };
    const conf = (t) => ({ ...dish('confirmed'), total_time: t });
    assert.deepEqual(R2.judgeConfirmVsDiscard(res(200), res(409, 'BAD_STATE'), tt, conf('Tnew')), []);
    assert.deepEqual(R2.judgeConfirmVsDiscard(res(409, 'BAD_STATE'), res(200), tt, conf(null)), []);
    expectBad(R2.judgeConfirmVsDiscard(res(200), res(200), tt, conf('Tnew')), '恰好一个');
    expectBad(R2.judgeConfirmVsDiscard(res(200), res(409, 'BAD_STATE'), tt, conf(null)), 'confirm 赢了');
    expectBad(R2.judgeConfirmVsDiscard(res(409, 'BAD_STATE'), res(200), tt, conf('Tnew')), 'discard 赢了');
  });
  await test('stateConsistency：draft 必有草稿、非 draft 不得有、pending 要有请求时间', r2, () => {
    assert.deepEqual(R2.stateConsistency(dish('draft', {})), []);
    expectBad(R2.stateConsistency(dish('draft')), 'draft 为空');
    expectBad(R2.stateConsistency(dish('confirmed', {})), 'draft 非空');
    expectBad(R2.stateConsistency({ chef_status: 'pending', draft: null }), 'chef_requested_at');
  });

  await test('validateDetails：字符串 / only_number 对象通过；序号与文案不符、index 从 0 起报错', r2, () => {
    const ok = { field: 'steps', index: 3, reason: 'only_number', message: '第 3 步只写了编号，补上做法或删掉这一步' };
    assert.deepEqual(validateDetails(undefined), []);
    assert.deepEqual(validateDetails(['第 1 项食材缺少 name', ok]), []);
    expectBad(validateDetails('x'), '数组');
    expectBad(validateDetails([{ ...ok, index: 2 }]), '序号不一致');
    expectBad(validateDetails([{ ...ok, index: 0, message: '第 0 步只写了编号' }]), '从 1 起');
    expectBad(validateDetails([{ ...ok, field: 'name' }]), 'field');
    expectBad(validateErrorBody({ error: { code: 'VALIDATION', message: '中文', details: [1] } }), 'details[0]');
  });

  const sec = { api: '离线·安全护栏' };
  await test('护栏：非本次创建的 id 一律拒绝', sec, () => {
    const g = createOwnershipGuard();
    const mine = '11111111-1111-4111-8111-111111111111';
    const sample = '22222222-2222-4222-8222-222222222222';
    g.addCreated(mine);
    g.assertOwned(mine, '领取');
    assert.throws(() => g.assertOwned(sample, '领取'), /安全护栏/);
    assert.throws(() => g.assertOwned(undefined, '交稿'), /安全护栏/);
  });
  await test('脱敏：登记的密钥不会出现在输出里', sec, () => {
    const k = 'unit-test-fake-secret-' + Math.random();
    registerSecret(k);
    assert.equal(redact(`key=${k};x=${k}`), 'key=***;x=***');
  });

  // 密钥扫描：test/ 里不得出现 CHEF_KEY 的值、dev 登录 cookie 字面量，
  // 也不得有 cookie/jar 文件。密钥运行时从 worker/.dev.vars 读，只放内存。
  await test('密钥扫描：test/ 无 CHEF_KEY 值、cookie 字面量、cookie/jar 文件',
    sec, () => {
      const key = readChefKeyForScan();
      if (key) registerSecret(key);
      const cookieLit = ['koala_dev_auth', '='].join('');
      const root = fileURLToPath(testDir);
      const hits = [];
      for (const f of listFiles(root)) {
        const rel = f.slice(root.length);
        if (/cookie|jar/i.test(rel.split('/').pop())) {
          hits.push(`${rel}：疑似 cookie/jar 文件`);
        }
        const text = readFileSync(f, 'utf8');
        if (key && text.includes(key)) hits.push(`${rel}：含 CHEF_KEY 值`);
        if (text.includes(cookieLit)) hits.push(`${rel}：含 cookie 字面量`);
      }
      assert.deepEqual(hits, [], '发现疑似泄密（内容已脱敏）');
      soft(Boolean(key), '未读到 worker/.dev.vars 的 CHEF_KEY，只扫了 cookie');
    });
  await test('网络锁：blockNetwork 后 http 助手和 fetch 都抛错', sec,
    async () => {
      if (isNetworkBlocked()) return; // 已在离线模式里，由总自检覆盖
      // 子进程里验证，避免锁死本进程（在线模式还要联网）
      const code = `import('${new URL('./lib/http.mjs', import.meta.url)}')
        .then(async (h) => { h.blockNetwork('单测');
          const c = h.createClient({ base: 'http://127.0.0.1:1',
            timeoutMs: 100 });
          let n = 0;
          try { await c.req('GET', '/x'); } catch (e) {
            if (e instanceof h.NetworkBlockedError) n++; }
          try { await fetch('http://127.0.0.1:1/'); } catch (e) {
            if (e instanceof h.NetworkBlockedError) n++; }
          process.exit(n === 2 && h.blockedAttempts().length === 2
            ? 0 : 1); });`;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e',
        code], { encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 0, `子进程失败：${r.stderr.slice(0, 200)}`);
    });
  await test('离线自检：--offline + API_BASE=http://127.0.0.1:1 → exit 0，' +
    '零连接', sec, async () => {
    if (process.env.KOALA_OFFLINE_SELFTEST === '1') {
      return; // 防止子进程里递归
    }
    // 本机起一个监听器数连接；子进程把 API_BASE 指向它和 127.0.0.1:1
    let conns = 0;
    const srv = createServer((s) => { conns += 1; s.destroy(); });
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const port = srv.address().port;
    try {
      for (const base of ['http://127.0.0.1:1', `http://127.0.0.1:${port}`]) {
        const r = await new Promise((res) => {
          const env = { ...process.env, API_BASE: base,
            KOALA_OFFLINE_SELFTEST: '1' };
          delete env.OFFLINE;
          const out = spawnSync(process.execPath, [apiTest, '--offline'],
            { env, encoding: 'utf8', timeout: 60000 });
          res(out);
        });
        assert.equal(r.status, 0, `${base}：退出码 ${r.status}\n` +
          redact(r.stdout.split('\n').filter((l) => /FAIL|✘/.test(l))
            .join('\n')).slice(0, 400));
        assert.match(r.stdout, /零网络请求/);
        assert.match(r.stdout, /离线模式：全程零网络请求/);
      }
      assert.equal(conns, 0, `离线模式仍向本机监听端口发起了 ${conns} 次连接`);
    } finally {
      srv.close();
    }
  });

  // 厨驼示例菜谱（只读）用质量校验器自检；不合格记 WARN
  const dir = new URL('../../../recipes/', import.meta.url);
  await test('示例菜谱 recipes/*.json 质量自检（只读，WARN）', o, () => {
    if (!existsSync(dir)) return soft(false, '未找到 recipes/ 目录');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const r = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      const errs = validateRecipe(r);
      soft(errs.length === 0, `${f}：${errs.join('；')}`);
    }
  });
}

const testDir = new URL('./', import.meta.url);
const apiTest = fileURLToPath(new URL('./api.test.mjs', import.meta.url));
function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}${e.name}`;
      if (e.isDirectory()) walk(`${p}/`);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}
const readChefKeyForScan = () => readChefKey();

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href ===
    pathToFileURL(self).href) {
  const runner = createRunner();
  console.log('== 离线：校验器 / 护栏单测 ==');
  await runOfflineTests(runner);
  process.exitCode = runner.summary().failed ? 1 : 0;
}

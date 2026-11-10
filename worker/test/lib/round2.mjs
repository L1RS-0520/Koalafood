// 第二轮（厨驼 claim / draft 错误路径 + 并发 + total_time）的纯判定函数。
// 不联网，离线单测覆盖（validators.test.mjs）。
import { isObj } from './validators.mjs';

// ROUND2_BASE 护栏：必须显式给出，且绝不能是 8787（共享实例）。
export function round2BaseError(base) {
  if (!base) return '未设置 ROUND2_BASE：第二轮用例只跑在临时实例上（例如 http://127.0.0.1:8820）';
  let u;
  try { u = new URL(base); } catch { return `ROUND2_BASE 不是合法 URL：${base}`; }
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port === '8787') return 'ROUND2_BASE 指向 8787（共享实例），拒绝运行';
  return null;
}

// 带标记的厨驼草稿：每个字段都嵌入同一个 tag，事后可判断「整份来自谁」
export function taggedDraft(tag, { steps = 3 } = {}) {
  return {
    ingredients: [{ name: `料${tag}`, amount: `${tag}克` }],
    steps: Array.from({ length: steps }, (_, i) => ({
      text: `第${i + 1}步${tag}`, heat: '中火', time: '1分钟', caption: `说${i + 1}`,
    })),
    tips: [`贴士${tag}`],
    servings: `${tag}人份`.slice(0, 20),
    total_time: `T${tag}`.slice(0, 20),
  };
}

// 从一份（服务端规范化后的）草稿里收集每个字段携带的 tag
export function draftTags(draft, tags) {
  if (!isObj(draft)) return { ok: false, why: 'draft 不是对象' };
  const found = new Set();
  const fieldsTag = [];
  const pick = (where, s) => {
    const hit = tags.filter((t) => typeof s === 'string' && s.includes(t));
    fieldsTag.push([where, hit]);
    for (const h of hit) found.add(h);
  };
  for (const [i, it] of (draft.ingredients || []).entries()) {
    pick(`ingredients[${i}].name`, it?.name);
    pick(`ingredients[${i}].amount`, it?.amount);
  }
  for (const [i, st] of (draft.steps || []).entries()) pick(`steps[${i}].text`, st?.text);
  for (const [i, t] of (draft.tips || []).entries()) pick(`tips[${i}]`, t);
  pick('servings', draft.servings);
  pick('total_time', draft.total_time);
  const missing = fieldsTag.filter(([, h]) => h.length !== 1).map(([w]) => w);
  return { found: [...found], missing };
}

// 草稿是否「整份」来自某一个 tag（不混拼、不缺字段、步骤数不变）
export function wholeDraftFrom(draft, tags, expectSteps = 3) {
  const errs = [];
  if (!isObj(draft)) return ['draft 不是对象'];
  const r = draftTags(draft, tags);
  if (r.found.length !== 1) errs.push(`草稿字段来自 ${r.found.length} 份提交（${r.found.join(',') || '无'}），应恰好 1 份`);
  if (r.missing.length) errs.push(`这些字段没有唯一 tag：${r.missing.join(', ')}`);
  if ((draft.steps || []).length !== expectSteps) errs.push(`步骤数 ${(draft.steps || []).length} ≠ ${expectSteps}`);
  if ((draft.ingredients || []).length !== 1) errs.push(`食材数 ${(draft.ingredients || []).length} ≠ 1`);
  return errs.length ? errs : [];
}

// 状态与草稿的内部一致性（大王视角的 Dish）
export function stateConsistency(d) {
  const errs = [];
  if (!isObj(d)) return ['Dish 不是对象'];
  if (d.chef_status === 'draft' && !isObj(d.draft)) errs.push('chef_status=draft 但 draft 为空');
  if (d.chef_status !== 'draft' && d.draft != null) errs.push(`chef_status=${d.chef_status} 但 draft 非空`);
  if (d.chef_status === 'pending' && !d.chef_requested_at) errs.push('pending 但没有 chef_requested_at');
  return errs;
}

const st = (r) => r?.status;
const code = (r) => r?.data?.error?.code;

// 两个并发 claim：恰好一个 200，另一个 409 CONFLICT
export function judgeClaimRace(a, b) {
  const ok = [a, b].filter((r) => st(r) === 200).length;
  const errs = [];
  if (ok !== 1) errs.push(`应恰好 1 个 claim 成功，实际 ${ok} 个（${st(a)} / ${st(b)}）`);
  const loser = [a, b].find((r) => st(r) !== 200);
  if (ok === 1 && !(st(loser) === 409 && code(loser) === 'CONFLICT')) {
    errs.push(`失败的那个应为 409 CONFLICT，实际 ${st(loser)} ${code(loser)}`);
  }
  return errs;
}

// 两份并发草稿：恰好一个 200，另一个 409 BAD_STATE；最终草稿整份来自赢家
export function judgeDraftRace([ra, rb], [ta, tb], final) {
  const errs = [];
  const okA = st(ra) === 200, okB = st(rb) === 200;
  if (okA === okB) errs.push(`应恰好 1 份交稿成功，实际 ${st(ra)} / ${st(rb)}`);
  const loser = okA ? rb : ra;
  if (okA !== okB && !(st(loser) === 409 && code(loser) === 'BAD_STATE')) {
    errs.push(`输的那份应为 409 BAD_STATE，实际 ${st(loser)} ${code(loser)}`);
  }
  errs.push(...stateConsistency(final));
  if (final?.chef_status !== 'draft') errs.push(`最终状态应为 draft，实际 ${final?.chef_status}`);
  else {
    errs.push(...wholeDraftFrom(final.draft, [ta, tb]));
    if (okA !== okB) {
      const win = okA ? ta : tb;
      const got = draftTags(final.draft, [ta, tb]).found;
      if (got.length === 1 && got[0] !== win) errs.push(`最终草稿来自 ${got[0]}，但返回 200 的是 ${win}`);
    }
  }
  return errs;
}

// 草稿 vs ask-chef（起点 pending）。合法串行：
//  A) 交稿 → ask-chef：交稿 200（或 409），最终 pending 且无草稿
//  B) ask-chef → 交稿：交稿 200，最终 draft 且草稿整份是本次提交
export function judgeDraftVsAsk(rDraft, rAsk, tag, final) {
  const errs = [];
  if (st(rAsk) !== 200) errs.push(`ask-chef 应 200，实际 ${st(rAsk)} ${code(rAsk)}`);
  if (![200, 409].includes(st(rDraft))) errs.push(`交稿应 200 或 409，实际 ${st(rDraft)} ${code(rDraft)}`);
  errs.push(...stateConsistency(final));
  if (final?.chef_status === 'pending') {
    if (final.draft != null) errs.push('pending 却残留草稿');
  } else if (final?.chef_status === 'draft') {
    if (st(rDraft) !== 200) errs.push('最终是 draft，但交稿没返回 200');
    errs.push(...wholeDraftFrom(final.draft, [tag]));
  } else errs.push(`最终状态 ${final?.chef_status} 不是任何合法串行的结果（应 pending 或 draft）`);
  return errs;
}

// 草稿 vs discard-draft（起点 pending）。合法串行：
//  A) discard → 交稿：discard 409 BAD_STATE，交稿 200，最终 draft（整份本次提交）
//  B) 交稿 → discard：两者都 200，最终 confirmed 且无草稿
export function judgeDraftVsDiscard(rDraft, rDiscard, tag, final) {
  const errs = [];
  if (st(rDraft) !== 200) errs.push(`交稿应 200，实际 ${st(rDraft)} ${code(rDraft)}`);
  errs.push(...stateConsistency(final));
  if (st(rDiscard) === 200) {
    if (final?.chef_status !== 'confirmed') errs.push(`discard 200 后应为 confirmed，实际 ${final?.chef_status}`);
    if (final?.draft != null) errs.push('discard 200 后仍有草稿');
  } else if (st(rDiscard) === 409 && code(rDiscard) === 'BAD_STATE') {
    if (final?.chef_status !== 'draft') errs.push(`discard 409 后应为 draft，实际 ${final?.chef_status}`);
    else errs.push(...wholeDraftFrom(final.draft, [tag]));
  } else errs.push(`discard 应 200 或 409 BAD_STATE，实际 ${st(rDiscard)} ${code(rDiscard)}`);
  return errs;
}

// 未登录列表/详情的 JSON 文本里不得出现任何草稿标记
export function leakedTags(text, tags) {
  return tags.filter((t) => String(text).includes(t));
}

// 列表里 total_time 的口径（v2.3.2/2.3.3 定案）：公开列表只显示「最近一次已确认」
// 的正式值，与详情页同口径；pending/draft 的菜显示旧的正式值或 null，草稿值永不出现。
// formal: 该菜最近一次已确认的 total_time（没有则 null）
export function listTotalTimeIssues(item, { formal = null } = {}) {
  const hard = [];
  if (!('total_time' in item)) return { absent: true, hard };
  const v = item.total_time;
  if (v !== null && typeof v !== 'string') hard.push(`total_time 应为字符串或 null：${JSON.stringify(v)}`);
  else if (v !== formal) {
    hard.push(`${item.chef_status} 的菜列表 total_time=${JSON.stringify(v)}，应为最近一次确认的值 ${JSON.stringify(formal)}`);
  }
  return { absent: false, hard };
}

// discard-draft vs ask-chef（起点 draft）。合法串行：
//  A) discard → ask：两者 200，最终 pending
//  B) ask → discard：discard 409 BAD_STATE，最终 pending
// 两种结果最终都必须是 pending，且 requested_note 是这次 ask 的 note
export function judgeDiscardVsAsk(rDiscard, rAsk, note, final) {
  const errs = [];
  if (st(rAsk) !== 200) errs.push(`ask-chef 应 200，实际 ${st(rAsk)} ${code(rAsk)}`);
  if (!(st(rDiscard) === 200 || (st(rDiscard) === 409 && code(rDiscard) === 'BAD_STATE'))) {
    errs.push(`discard 应 200 或 409 BAD_STATE，实际 ${st(rDiscard)} ${code(rDiscard)}`);
  }
  errs.push(...stateConsistency(final));
  if (final?.chef_status !== 'pending') errs.push(`最终应为 pending（ask-chef 不能被覆盖），实际 ${final?.chef_status}`);
  if (final?.requested_note !== note) errs.push(`requested_note 应为本次 ask 的 note，实际 ${JSON.stringify(final?.requested_note)}`);
  return errs;
}

// confirm vs ask-chef（起点 draft，草稿 total_time=draftTT，旧正式值 oldTT）。合法串行：
//  A) confirm → ask：两者 200，最终 pending，正式内容=草稿
//  B) ask → confirm：confirm 409 BAD_STATE，最终 pending，正式内容不变
export function judgeConfirmVsAsk(rConfirm, rAsk, { draftTT, oldTT }, final) {
  const errs = [];
  if (st(rAsk) !== 200) errs.push(`ask-chef 应 200，实际 ${st(rAsk)} ${code(rAsk)}`);
  errs.push(...stateConsistency(final));
  if (final?.chef_status !== 'pending') errs.push(`最终应为 pending，实际 ${final?.chef_status}`);
  if (st(rConfirm) === 200) {
    if (final?.total_time !== draftTT) errs.push(`confirm 200 后正式 total_time 应为草稿值 ${draftTT}，实际 ${final?.total_time}`);
  } else if (st(rConfirm) === 409 && code(rConfirm) === 'BAD_STATE') {
    if (final?.total_time !== oldTT) errs.push(`confirm 409 后正式 total_time 应不变（${oldTT}），实际 ${final?.total_time}`);
  } else errs.push(`confirm 应 200 或 409 BAD_STATE，实际 ${st(rConfirm)} ${code(rConfirm)}`);
  return errs;
}

// confirm vs discard-draft（起点 draft）：恰好一个 200，另一个 409 BAD_STATE；最终 confirmed，
// 正式内容 = 草稿（confirm 赢）或旧值（discard 赢）
export function judgeConfirmVsDiscard(rConfirm, rDiscard, { draftTT, oldTT }, final) {
  const errs = [];
  const okC = st(rConfirm) === 200, okD = st(rDiscard) === 200;
  if (okC === okD) errs.push(`confirm / discard 应恰好一个成功，实际 ${st(rConfirm)} / ${st(rDiscard)}`);
  const loser = okC ? rDiscard : rConfirm;
  if (okC !== okD && !(st(loser) === 409 && code(loser) === 'BAD_STATE')) {
    errs.push(`输的那个应为 409 BAD_STATE，实际 ${st(loser)} ${code(loser)}`);
  }
  errs.push(...stateConsistency(final));
  if (final?.chef_status !== 'confirmed') errs.push(`最终应为 confirmed，实际 ${final?.chef_status}`);
  if (okC && !okD && final?.total_time !== draftTT) errs.push(`confirm 赢了，正式 total_time 应为 ${draftTT}，实际 ${final?.total_time}`);
  if (okD && !okC && final?.total_time !== oldTT) errs.push(`discard 赢了，正式 total_time 应不变（${oldTT}），实际 ${final?.total_time}`);
  return errs;
}

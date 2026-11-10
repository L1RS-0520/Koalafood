// 考拉食堂 · 接口结构校验（纯函数，可离线单测）
// 依据 app/docs/接口约定.md v2.1 最终定稿 + v2.2 多图 + v2.3
// （/api/kitchen 写入、dev 登录、未登录隐私）。
// 每个函数返回错误字符串数组，空数组表示通过。

export const CATEGORIES = Object.freeze([
  '家常菜', '汤羹', '主食', '小吃点心', '甜品饮品', '其他',
]);
// v2.1：pending(待写) → draft(已交稿待确认) → confirmed(正式)
export const CHEF_STATUSES = Object.freeze([
  'pending', 'draft', 'confirmed',
]);
export const SOURCES = Object.freeze(['chef', 'manual']);
export const PHOTO_STORES = Object.freeze(['kv', 'r2', 'd1']);
export const ERROR_CODES = Object.freeze({
  VALIDATION: 400, UNAUTHORIZED: 401, CHEF_DISABLED: 403,
  NOT_FOUND: 404, CONFLICT: 409, BAD_STATE: 409,
  TOO_LARGE: 413, BAD_TYPE: 415, STORAGE_QUOTA: 429,
  STORAGE_FULL: 507, // 507 为组长预告，约定未写入
  INTERNAL: 500,
});
export const MIN_STEPS = 3;
export const MAX_STEPS = 12;
export const MAX_CAPTION = 12;
export const MAX_NAME = 30;
export const MAX_NOTE = 200;
export const MAX_PHOTOS = 9;
// 单张照片上限（字节）。全测试唯一来源；改上限只改这里。
// 2026-11-09 约定变更：由 10MB 改为 1MB（1048576 字节）。
export const MAX_PHOTO_BYTES = 1024 * 1024;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]00:?00)$/;

export const hasChinese = (s) => typeof s === 'string' && CJK.test(s);
export const isObj = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const chars = (s) => [...s].length;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const strOrNull = (v) => v === null || typeof v === 'string';

export function isIsoUtc(s) {
  return typeof s === 'string' && ISO_UTC.test(s) &&
    !Number.isNaN(Date.parse(s));
}

// ---------- 菜谱内容 ----------

// 厨驼草稿「质量」校验（验收 5 + 厨驼菜谱标准）：
// 食材每项 name、amount 非空；步骤 3–12 步，每步 text 非空；
// caption 必须存在且 ≤12 字（可为空串）。
// opts.requireChinese 步骤 text 须含中文；opts.requireCaption。
export function validateRecipe(r, opts = {}) {
  const { requireChinese = true, requireCaption = true } = opts;
  const errs = [];
  if (!isObj(r)) return ['结果不是对象'];

  const ing = r.ingredients;
  if (!Array.isArray(ing)) {
    errs.push('ingredients 不是数组');
  } else {
    if (ing.length === 0) errs.push('ingredients 为空');
    ing.forEach((it, i) => {
      const p = `ingredients[${i}]`;
      if (!isObj(it)) return errs.push(`${p} 不是对象`);
      if (!nonEmpty(it.name)) errs.push(`${p}.name 缺失或为空`);
      if (!nonEmpty(it.amount)) errs.push(`${p}.amount 缺失或为空`);
    });
  }

  const st = r.steps;
  if (!Array.isArray(st)) {
    errs.push('steps 不是数组');
  } else {
    if (st.length < MIN_STEPS || st.length > MAX_STEPS) {
      errs.push(`steps 数量 ${st.length} 不在 ` +
        `${MIN_STEPS}-${MAX_STEPS} 之间`);
    }
    st.forEach((s, i) => checkStep(s, `steps[${i}]`, errs, {
      requireChinese, requireCaption,
    }));
  }
  return errs;
}

function checkStep(s, p, errs, { requireChinese, requireCaption }) {
  if (!isObj(s)) return errs.push(`${p} 不是对象`);
  if (!nonEmpty(s.text)) {
    errs.push(`${p}.text 缺失或为空`);
  } else if (requireChinese && !hasChinese(s.text)) {
    errs.push(`${p}.text 不含中文`);
  }
  for (const k of ['heat', 'time']) {
    if (k in s && typeof s[k] !== 'string') {
      errs.push(`${p}.${k} 应为字符串`);
    }
  }
  if (requireCaption && !('caption' in s)) {
    errs.push(`${p}.caption 缺失`);
  } else if ('caption' in s) {
    if (typeof s.caption !== 'string') {
      errs.push(`${p}.caption 应为字符串`);
    } else if (chars(s.caption) > MAX_CAPTION) {
      errs.push(`${p}.caption 超过 ${MAX_CAPTION} 字`);
    }
  }
}

// 正式内容（顶层）/ 手写内容：允许空数组、amount 允许空串；
// 存了的每项结构必须对；服务端返回的步骤应带齐四个字段。
export function validateContent(o, where = '') {
  const errs = [];
  const p0 = where ? `${where}.` : '';
  if (!Array.isArray(o.ingredients)) {
    errs.push(`${p0}ingredients 不是数组`);
  } else {
    o.ingredients.forEach((it, i) => {
      const p = `${p0}ingredients[${i}]`;
      if (!isObj(it)) return errs.push(`${p} 不是对象`);
      if (!nonEmpty(it.name)) errs.push(`${p}.name 缺失或为空`);
      if (typeof it.amount !== 'string') {
        errs.push(`${p}.amount 应为字符串（可为空串）`);
      }
    });
  }
  if (!Array.isArray(o.steps)) {
    errs.push(`${p0}steps 不是数组`);
  } else {
    o.steps.forEach((s, i) => {
      const p = `${p0}steps[${i}]`;
      checkStep(s, p, errs, { requireChinese: false,
        requireCaption: true });
      if (isObj(s)) {
        for (const k of ['heat', 'time']) {
          if (!(k in s)) errs.push(`${p}.${k} 缺失`);
        }
      }
    });
  }
  if (!Array.isArray(o.tips) ||
      !o.tips.every((t) => typeof t === 'string')) {
    errs.push(`${p0}tips 应为字符串数组`);
  }
  for (const k of ['servings', 'total_time']) {
    if (!(k in o) || !strOrNull(o[k])) {
      errs.push(`${p0}${k} 应存在且为字符串或 null`);
    }
  }
  return errs;
}

// ---------- 厨驼交稿（服务端应接受/拒绝的规则） ----------

// 按 v2.1：对象；ingredients 数组且每项有 name；steps 3–12 步、
// 每步有 text；caption 超长由服务端截断（不算错）。
// 例外：带非空 chef_message 且食材、步骤都是空数组 → 接受。
// 返回错误数组：非空即「服务端应返回 400 VALIDATION」。
export function validateChefSubmission(b) {
  if (!isObj(b)) return ['交稿必须是 JSON 对象'];
  const errs = [];
  const ing = b.ingredients;
  const st = b.steps;
  if (!Array.isArray(ing)) errs.push('ingredients 必须是数组');
  if (!Array.isArray(st)) errs.push('steps 必须是数组');
  if (errs.length) return errs;
  const giveUp = nonEmpty(b.chef_message) &&
    ing.length === 0 && st.length === 0;
  if (giveUp) return [];
  // v2.3.1：完整草稿食材 ≥1 项；每项 name、amount 都必填且非空
  // （手写菜 amount 可空，不走本函数）
  if (ing.length === 0) errs.push('完整草稿至少 1 项食材');
  ing.forEach((it, i) => {
    const name = isObj(it) ? it.name : undefined;
    const amount = isObj(it) ? it.amount : undefined;
    if (!nonEmpty(name)) errs.push(`第 ${i + 1} 项食材缺 name`);
    if (!nonEmpty(amount)) errs.push(`第 ${i + 1} 项食材缺 amount`);
  });
  if (st.length < MIN_STEPS || st.length > MAX_STEPS) {
    errs.push(`步骤须 ${MIN_STEPS}-${MAX_STEPS} 步，现为 ${st.length}`);
  }
  st.forEach((s, i) => {
    const text = isObj(s) ? s.text : s;
    if (!nonEmpty(text)) errs.push(`第 ${i + 1} 步缺 text`);
  });
  if ('tips' in b && !Array.isArray(b.tips) && b.tips !== null &&
      typeof b.tips !== 'string') {
    errs.push('tips 必须是字符串数组');
  }
  return errs;
}

// ---------- 接口对象 ----------

export const DISH_KEYS = Object.freeze([
  'id', 'name', 'category', 'note', 'photo_url', 'photos', 'ingredients',
  'steps', 'tips', 'servings', 'total_time', 'source',
  'chef_status', 'draft', 'requested_note', 'chef_requested_at',
  'created_at', 'updated_at',
]);

// 完整 Dish（v2.1）。opts.anon：未登录视角（v2.3 隐私：
// draft、requested_note 一律为 null）。
export function validateDish(d, opts = {}) {
  if (!isObj(d)) return ['Dish 不是对象'];
  const errs = [];
  for (const k of DISH_KEYS) {
    if (!(k in d)) errs.push(`缺字段 ${k}`);
  }
  if (typeof d.id !== 'string' || !UUID.test(d.id)) {
    errs.push(`id 不是 UUID：${JSON.stringify(d.id)}`);
  }
  if (!nonEmpty(d.name)) errs.push('name 缺失或为空');
  if (!CATEGORIES.includes(d.category)) {
    errs.push(`category 非固定分类：${JSON.stringify(d.category)}`);
  }
  for (const k of ['note', 'requested_note']) {
    if (k in d && !strOrNull(d[k])) {
      errs.push(`${k} 应为字符串或 null`);
    }
  }
  if (typeof d.photo_url !== 'string' ||
      !/^\/api\/photos\/.+/.test(d.photo_url)) {
    errs.push(`photo_url 格式不对：${JSON.stringify(d.photo_url)}`);
  }
  errs.push(...validatePhotos(d.photos, d.photo_url));
  errs.push(...validateContent(d));
  if (!SOURCES.includes(d.source)) {
    errs.push(`source 非法：${JSON.stringify(d.source)}`);
  }
  if (!CHEF_STATUSES.includes(d.chef_status)) {
    errs.push(`chef_status 非法：${JSON.stringify(d.chef_status)}`);
  }
  if (opts.anon) {
    if (d.draft !== null) errs.push('未登录时 draft 应为 null');
    if (d.requested_note !== null) {
      errs.push('未登录时 requested_note 应为 null');
    }
    // v2.3.3：chef_requested_at 对访客隐藏（与 draft 同口径：null）
    if (d.chef_requested_at !== null) {
      errs.push('未登录时 chef_requested_at 应为 null');
    }
  } else if (d.chef_status === 'draft') {
    if (!isObj(d.draft)) {
      errs.push('draft 状态下 draft 应为对象');
    } else {
      errs.push(...validateContent(d.draft, 'draft'));
      if ('chef_message' in d.draft && !strOrNull(d.draft.chef_message)) {
        errs.push('draft.chef_message 应为字符串或 null');
      }
    }
  } else if (d.draft !== null && d.draft !== undefined) {
    errs.push(`${d.chef_status} 状态下 draft 应为空`);
  }
  if (d.chef_requested_at !== null && d.chef_requested_at !== undefined &&
      !isIsoUtc(d.chef_requested_at)) {
    errs.push(`chef_requested_at 不是 ISO UTC：${d.chef_requested_at}`);
  }
  for (const k of ['created_at', 'updated_at']) {
    if (!isIsoUtc(d[k])) errs.push(`${k} 不是 ISO UTC：${d[k]}`);
  }
  return errs;
}

// photos: [{id,url}]，1–9 张有序，第一张为封面 = photo_url
export function validatePhotos(photos, cover, where = 'photos') {
  if (!Array.isArray(photos)) return [`${where} 不是数组`];
  const errs = [];
  if (photos.length < 1 || photos.length > MAX_PHOTOS) {
    errs.push(`${where} 数量 ${photos.length} 不在 1-${MAX_PHOTOS}`);
  }
  const ids = new Set();
  photos.forEach((ph, i) => {
    const p = `${where}[${i}]`;
    if (!isObj(ph)) return errs.push(`${p} 不是对象`);
    if (!nonEmpty(ph.id)) errs.push(`${p}.id 缺失`);
    else if (ids.has(ph.id)) errs.push(`${p}.id 重复`);
    ids.add(ph.id);
    if (typeof ph.url !== 'string' || !/^\/api\/photos\/.+/.test(ph.url)) {
      errs.push(`${p}.url 格式不对：${JSON.stringify(ph.url)}`);
    }
  });
  if (cover !== undefined && photos.length &&
      isObj(photos[0]) && photos[0].url !== cover) {
    errs.push('photo_url 应等于第一张照片（封面）的 url');
  }
  return errs;
}

export const SUMMARY_KEYS = Object.freeze([
  'id', 'name', 'category', 'photo_url', 'photo_count', 'chef_status',
  'source', 'created_at',
]);

// 列表项 DishSummary（v2：加 chef_status、source）。
export function validateSummary(s) {
  if (!isObj(s)) return ['DishSummary 不是对象'];
  const errs = SUMMARY_KEYS
    .filter((k) => s[k] === undefined).map((k) => `缺字段 ${k}`);
  if (s.category !== undefined && !CATEGORIES.includes(s.category)) {
    errs.push(`category 非固定分类：${s.category}`);
  }
  if (s.chef_status !== undefined &&
      !CHEF_STATUSES.includes(s.chef_status)) {
    errs.push(`chef_status 非法：${s.chef_status}`);
  }
  if (s.source !== undefined && !SOURCES.includes(s.source)) {
    errs.push(`source 非法：${s.source}`);
  }
  if (s.created_at !== undefined && !isIsoUtc(s.created_at)) {
    errs.push(`created_at 不是 ISO UTC：${s.created_at}`);
  }
  if (s.photo_count !== undefined && (!Number.isInteger(s.photo_count) ||
      s.photo_count < 1 || s.photo_count > MAX_PHOTOS)) {
    errs.push(`photo_count 应为 1-${MAX_PHOTOS} 的整数：${s.photo_count}`);
  }
  return errs;
}

// 厨驼任务项（GET /api/chef/tasks、claim 的返回）。
export function validateTask(t) {
  if (!isObj(t)) return ['task 不是对象'];
  const errs = [];
  for (const k of ['id', 'name', 'category']) {
    if (typeof t[k] !== 'string' || !t[k]) errs.push(`task 缺 ${k}`);
  }
  if ('note' in t && !strOrNull(t.note)) errs.push('task.note 类型不对');
  // task 的照片 url 是厨驼带密钥读图地址（Worker 实现如此）
  if (!Array.isArray(t.photos)) {
    errs.push('task.photos 不是数组');
  } else {
    t.photos.forEach((ph, i) => {
      const okUrl = isObj(ph) && typeof ph.url === 'string' &&
        (ph.url.startsWith('/api/photos/') ||
         ph.url === `/api/chef/tasks/${t.id}/photos/${ph.id}`);
      if (!isObj(ph) || !nonEmpty(ph.id) || !okUrl) {
        errs.push(`task.photos[${i}] 结构不对：${JSON.stringify(ph)}`);
      }
    });
    if (!t.photos.length) errs.push('task.photos 为空');
  }
  if ('claimed_at' in t && t.claimed_at !== null &&
      !isIsoUtc(t.claimed_at)) {
    errs.push(`task.claimed_at 不是 ISO UTC：${t.claimed_at}`);
  }
  return errs;
}

// GET /api/health（v2.3.1）：
// {ok, chef_enabled, chef_pending, chef_mock, photo_store,
//  orphan_photos}
export function validateHealth(h) {
  if (!isObj(h)) return ['health 不是对象'];
  const errs = [];
  if (h.ok !== true) errs.push('ok 应为 true');
  if (typeof h.chef_enabled !== 'boolean') {
    errs.push('chef_enabled 应为布尔');
  }
  if (!Number.isInteger(h.chef_pending) || h.chef_pending < 0) {
    errs.push(`chef_pending 应为非负整数：` +
      JSON.stringify(h.chef_pending));
  }
  if (!Number.isInteger(h.orphan_photos) || h.orphan_photos < 0) {
    errs.push(`orphan_photos 应为非负整数：` +
      JSON.stringify(h.orphan_photos));
  }
  // v2.3.1：chef_mock、photo_store 为正式字段
  if (typeof h.chef_mock !== 'boolean') errs.push('chef_mock 应为布尔');
  if (!PHOTO_STORES.includes(h.photo_store)) {
    errs.push(`photo_store 应为 ${PHOTO_STORES.join('|')}：` +
      JSON.stringify(h.photo_store));
  }
  return errs;
}

// GET /api/kitchen/storage（码驼实现 + 约定 #19/#21/#22）：
// { store, photo_count,
//   capacity: { used_bytes, limit_bytes, percent, level, photos_left },
//   daily_ops: { used, limit } }
// 容量一律 1024 进制；percent 保留 1 位小数；level ∈ ok/warn/danger
// （≥95% danger，只做红色提示、不拦上传；'full' 已作废）；
// 拦不拦只看 已用 + 本次 > 上限 → 507。
export const LEVELS = Object.freeze(['ok', 'warn', 'danger']);
export const DANGER_PCT = 95;
export const WARN_PCT = 80;
export const PHOTO_ESTIMATE_BYTES = 500 * 1024; // 500KB = 512,000 字节
const nnInt = (v) => Number.isInteger(v) && v >= 0;
// 期望值只从字节推导：level 比较原始比例，percent 保留 1 位小数
export function expectedLevel(used, limit) {
  // 整数比较，避免浮点误差：used/limit ≥ p% ⇔ used*100 ≥ p*limit
  if (used * 100 >= DANGER_PCT * limit) return 'danger';
  if (used * 100 >= WARN_PCT * limit) return 'warn';
  return 'ok';
}
export const expectedPercent = (used, limit) =>
  Math.round((used / limit) * 1000) / 10;
export function validateStorage(s) {
  if (!isObj(s)) return ['storage 不是对象'];
  const errs = [];
  if (!nonEmpty(s.store)) errs.push('store 应为非空字符串');
  if (!nnInt(s.photo_count)) errs.push('photo_count 应为非负整数');
  const c = s.capacity; const o = s.daily_ops;
  if (!isObj(c)) errs.push('缺 capacity 对象');
  else {
    for (const k of ['used_bytes', 'limit_bytes', 'photos_left']) {
      if (!nnInt(c[k])) errs.push(`capacity.${k} 应为非负整数`);
    }
    if (typeof c.percent !== 'number' || !Number.isFinite(c.percent) ||
        c.percent < 0) errs.push('capacity.percent 应为非负数');
    if (!LEVELS.includes(c.level)) {
      errs.push(`capacity.level=${JSON.stringify(c.level)} 不在 ` +
        `${LEVELS.join('/')}`);
    }
    if (nnInt(c.used_bytes) && c.limit_bytes > 0) {
      // 一律由字节原值推导，不看 percent（79.96% 显示 80.0 但仍是 ok）
      const want = expectedPercent(c.used_bytes, c.limit_bytes);
      if (typeof c.percent === 'number' && c.percent !== want) {
        errs.push(`capacity.percent=${c.percent}，按 used/limit 应为 ${want}`);
      }
      const lv = expectedLevel(c.used_bytes, c.limit_bytes);
      if (LEVELS.includes(c.level) && c.level !== lv) {
        errs.push(`capacity.level=${c.level}，按字节比例应为 ${lv}` +
          `（<${WARN_PCT}% ok，≥${WARN_PCT}% warn，≥${DANGER_PCT}% danger）`);
      }
    }
  }
  if (!isObj(o)) errs.push('缺 daily_ops 对象');
  else {
    for (const k of ['used', 'limit']) {
      if (!nnInt(o[k])) errs.push(`daily_ops.${k} 应为非负整数`);
    }
  }
  return errs;
}
// 软检查项（约定未写死）：photos_left 估算公式（500KB/张）
export function storageSoftIssues(s) {
  const c = s?.capacity; const out = [];
  if (!isObj(c) || !(c.limit_bytes > 0)) return out;
  const left = Math.floor(Math.max(0, c.limit_bytes - c.used_bytes) /
    PHOTO_ESTIMATE_BYTES);
  if (c.photos_left !== left) {
    out.push(`photos_left=${c.photos_left}，按 500KB/张应为 ${left}`);
  }
  return out;
}
// GET /api/me（v2.3）：{logged_in, email, can_edit}，can_edit=logged_in
export function validateMe(m, loggedIn) {
  if (!isObj(m)) return ['me 不是对象'];
  const errs = [];
  if (typeof m.logged_in !== 'boolean') errs.push('logged_in 应为布尔');
  if (!('email' in m) || !strOrNull(m.email)) {
    errs.push('email 应存在且为字符串或 null');
  }
  if (typeof m.can_edit !== 'boolean') errs.push('can_edit 应为布尔');
  if (m.can_edit !== m.logged_in) errs.push('can_edit 应等于 logged_in');
  if (loggedIn !== undefined && m.logged_in !== loggedIn) {
    errs.push(`logged_in 应为 ${loggedIn}`);
  }
  if (loggedIn === false && m.email !== null) {
    errs.push('未登录时 email 应为 null');
  }
  return errs;
}

// GET /api/settings
export function validateSettings(s) {
  if (!isObj(s)) return ['settings 不是对象'];
  return typeof s.chef_enabled === 'boolean'
    ? [] : ['chef_enabled 应为布尔'];
}

// 统一错误体 {"error":{"code","message"}}，message 须为中文。
export function validateErrorBody(b, code) {
  if (!isObj(b) || !isObj(b.error)) {
    return [`不是 {error:{code,message}}：${JSON.stringify(b)}`];
  }
  const errs = [];
  const { code: c, message: m } = b.error;
  if (typeof c !== 'string') errs.push('error.code 不是字符串');
  if (code && c !== code) errs.push(`error.code=${c}，期望 ${code}`);
  if (!hasChinese(m)) {
    errs.push(`error.message 不是中文提示：${JSON.stringify(m)}`);
  }
  errs.push(...validateDetails(b.error.details));
  return errs;
}

// details（可选）：字符串，或 v2.3.3 的定位对象 {field, index(从 1 起), reason, message}
export function validateDetails(d) {
  if (d === undefined) return [];
  if (!Array.isArray(d)) return ['error.details 应为数组'];
  const errs = [];
  d.forEach((x, i) => {
    if (typeof x === 'string') return;
    if (!isObj(x)) { errs.push(`details[${i}] 应为字符串或对象`); return; }
    if (!['steps', 'ingredients', 'tips'].includes(x.field)) errs.push(`details[${i}].field 非法：${x.field}`);
    if (!Number.isInteger(x.index) || x.index < 1) errs.push(`details[${i}].index 应为从 1 起的整数：${x.index}`);
    if (typeof x.reason !== 'string' || !x.reason) errs.push(`details[${i}].reason 缺失`);
    if (!hasChinese(x.message)) errs.push(`details[${i}].message 不是中文`);
    else if (Number.isInteger(x.index) && !x.message.includes(`第 ${x.index} `)) {
      errs.push(`details[${i}].index=${x.index} 与文案「${x.message}」的序号不一致`);
    }
  });
  return errs;
}

// ---------- 安全护栏 ----------

// 只允许对本次运行创建的菜（或本次随机生成、必不存在的假 id）
// 做写操作/厨驼操作。示例菜（含厨驼预留的 pending 菜）一律拒绝。
export function createOwnershipGuard() {
  const created = new Set();
  const fakes = new Set();
  return {
    created, fakes,
    addCreated(id) { created.add(id); },
    addFake(id) { fakes.add(id); },
    isOwned: (id) => created.has(id),
    assertOwned(id, action = '操作') {
      if (!created.has(id) && !fakes.has(id)) {
        throw new Error(`安全护栏：拒绝对非本次创建的菜 ${id} ${action}`);
      }
    },
  };
}

// 精简模式（默认）/ FULL=1 的写入额度预算与开跑前检查（纯函数，可离线测）。
// KV 写入额度按 put+delete 合并计数（约定 v2.3.1 #6），读 GET
// /api/kitchen/storage 的 daily_ops.used / daily_ops.limit。
export const LEAN_OPS_BUDGET = 40; // 精简模式一轮的目标上限
export const MIN_REMAINING = Object.freeze({ lean: 60, full: 200 });
export const PREFLIGHT_EXIT = 3;

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// base 是否为本机 8787（大家共用的开发实例）
export function isLocal8787(base) {
  let u;
  try { u = new URL(base); } catch { return false; }
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return LOCAL.has(u.hostname) && port === '8787';
}

// FULL=1 打 8787 需显式 ALLOW_FULL_ON_8787=1；返回 null 表示放行
export function fullGuard({ full, base, allow }) {
  if (!full || !isLocal8787(base) || allow) return null;
  return 'FULL=1 会大量消耗 8787 的每日写入额度（一轮约 150–170 次），' +
    '默认拒绝。确需在 8787 跑全量，请加 ALLOW_FULL_ON_8787=1；' +
    '更推荐指向自己的实例（API_BASE）。';
}

// storage：GET /api/kitchen/storage 返回体（daily_ops:{used, limit}）；
// null 表示接口不存在/读不到（回退：只提示，不拦）
const opsOf = (st) => st?.daily_ops ?? null;
export function preflight({ full, storage }) {
  const mode = full ? 'full' : 'lean';
  const need = MIN_REMAINING[mode];
  if (storage == null) {
    return { ok: true, need, remaining: null,
      caution: '读不到 GET /api/kitchen/storage，无法预估写入额度，按原计划继续' };
  }
  const o = opsOf(storage);
  const t = o?.used; const l = o?.limit;
  if (!Number.isInteger(t) || !Number.isInteger(l) || t < 0 || l < 0) {
    return { ok: true, need, remaining: null,
      caution: `storage.daily_ops 不是 {used, limit} 非负整数` +
        `（${JSON.stringify(o)}），无法预估写入额度，按原计划继续` };
  }
  const remaining = l - t;
  if (remaining < need) {
    return { ok: false, need, remaining,
      msg: `今日写入额度只剩 ${remaining} 次（${t}/${l}），` +
        `${full ? 'FULL' : '精简'}模式至少需要 ${need} 次，未执行任何用例。` +
        '请等额度重置（UTC 0 点）或请组长清零本地计数。' };
  }
  return { ok: true, need, remaining };
}

// 本轮用掉的写入次数（daily_ops.used 之差）；跨 UTC 日或读不到时 null
export function opsUsed(before, after) {
  const b = opsOf(before)?.used; const a = opsOf(after)?.used;
  if (!Number.isInteger(b) || !Number.isInteger(a) || a < b) return null;
  return a - b;
}

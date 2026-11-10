// 极简测试运行器：顺序执行，逐条打印 PASS/FAIL/SKIP/WARN。
// 硬断言失败 → FAIL（退出码非 0）；软检查（约定没写死、属推断）
// → WARN，不影响退出码；STRICT=1 时 WARN 也算 FAIL。
import assert from 'node:assert/strict';

export class Skip extends Error {}
export const STRICT = process.env.STRICT === '1';

// 输出脱敏：登记的秘密（如厨驼密钥）在任何输出里都替换成 ***
const secrets = new Set();
export function registerSecret(s) {
  if (typeof s === 'string' && s.length >= 4) secrets.add(s);
}
export function redact(text) {
  let t = String(text);
  for (const s of secrets) t = t.split(s).join('***');
  return t;
}
const log = (...a) => console.log(redact(a.join(' ')));

export function createRunner() {
  const results = [];
  let current = null;

  // 软检查：记录警告，不抛错
  function soft(cond, msg) {
    if (cond) return true;
    if (!current) throw new Error('soft() 只能在用例中调用');
    current.warns.push(msg);
    return false;
  }

  // 校验器返回的错误数组 → 硬断言
  function noErrors(errs, what) {
    assert.ok(Array.isArray(errs), 'validator 应返回数组');
    if (errs.length) {
      assert.fail(`${what} 结构不对：\n      - ` + errs.join('\n      - '));
    }
  }

  async function test(name, meta, fn) {
    if (typeof meta === 'function') [fn, meta] = [meta, {}];
    const r = { name, meta, status: 'PASS', warns: [], err: null };
    current = r;
    const t0 = Date.now();
    try {
      await fn();
      if (STRICT && r.warns.length) {
        r.status = 'FAIL';
        r.err = new Error('STRICT 模式：存在 WARN');
      }
    } catch (e) {
      if (e instanceof Skip) {
        r.status = 'SKIP';
        r.err = e;
      } else {
        r.status = 'FAIL';
        r.err = e;
      }
    } finally {
      current = null;
    }
    r.ms = Date.now() - t0;
    results.push(r);
    print(r);
    return r.status === 'PASS';
  }

  function print(r) {
    const tag = { PASS: '✔ PASS', FAIL: '✘ FAIL', SKIP: '- SKIP' };
    const tags = [r.meta.api, r.meta.ac && `验收${r.meta.ac}`]
      .filter(Boolean).join(' · ');
    log(`${tag[r.status]}  ${r.name}` +
      (tags ? `  [${tags}]` : '') + `  (${r.ms}ms)`);
    if (r.err && r.status !== 'PASS') {
      const msg = String(r.err.message || r.err).split('\n')
        .map((l) => '      ' + l).join('\n');
      log(msg);
    }
    for (const w of r.warns) log(`      ⚠ WARN ${w}`);
  }

  function summary() {
    const n = (s) => results.filter((r) => r.status === s).length;
    const warns = results.reduce((a, r) => a + r.warns.length, 0);
    const line = '='.repeat(60);
    log(`\n${line}`);
    log(`合计 ${results.length}：PASS ${n('PASS')}  ` +
      `FAIL ${n('FAIL')}  SKIP ${n('SKIP')}  WARN ${warns}`);
    const fails = results.filter((r) => r.status === 'FAIL');
    if (fails.length) {
      log('失败用例：');
      for (const r of fails) log(`  ✘ ${r.name}`);
    }
    log(line);
    return { results, failed: fails.length };
  }

  return { test, soft, noErrors, summary, results };
}

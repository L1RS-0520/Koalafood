// HTTP 小工具：每个请求都有超时；简易 cookie 罐；multipart 构造。
// 不打印 cookie 值和厨驼密钥（runner 里统一脱敏）。

export class CookieJar {
  constructor() { this.map = new Map(); }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie() : [];
    for (const sc of list) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a) ||
        (/^\s*expires=/i.test(a) &&
          Date.parse(a.split('=')[1]) < Date.now()));
      if (!value || expired) this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  has(name) { return this.map.has(name); }
  get(name) { return this.map.get(name); }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export class NetworkError extends Error {}

// 离线模式护栏：blockNetwork() 之后，任何 req() 以及全局 fetch 都直接抛错
let networkBlocked = null;
const attempts = [];
export class NetworkBlockedError extends Error {}
export function blockNetwork(reason = '离线模式') {
  networkBlocked = reason;
  globalThis.fetch = async (u) => {
    attempts.push(`fetch ${u}`);
    throw new NetworkBlockedError(`${reason}：禁止任何网络请求（fetch）`);
  };
}
export const isNetworkBlocked = () => networkBlocked !== null;
// 被拦下的请求记录（离线自检断言它为空）
export const blockedAttempts = () => [...attempts];

export function createClient({ base, timeoutMs }) {
  // opts: json | form | body, headers, jar(null=不带 cookie), timeout
  async function req(method, path, opts = {}) {
    if (networkBlocked) {
      attempts.push(`${method} ${path}`);
      throw new NetworkBlockedError(
        `${networkBlocked}：http 助手被调用（${method} ${path}），已拒绝`);
    }
    const headers = { ...(opts.headers || {}) };
    let body;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = typeof opts.json === 'string'
        ? opts.json : JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    } else if (opts.body !== undefined) {
      body = opts.body;
    }
    const jar = opts.jar;
    if (jar && jar.map.size) headers.cookie = jar.header();
    const url = new URL(path, base);
    const ms = opts.timeout ?? timeoutMs;
    let res;
    try {
      res = await fetch(url, {
        method, headers, body, redirect: 'manual',
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) {
      const why = e.name === 'TimeoutError'
        ? `超时（${ms}ms）` : (e.cause?.code || e.message);
      throw new NetworkError(`${method} ${url.pathname} 请求失败：${why}`);
    }
    if (jar) jar.absorb(res);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (/json/i.test(ct)) {
      try { data = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { data = undefined; }
    }
    return {
      status: res.status, headers: res.headers, ct, bytes, data,
      text: () => new TextDecoder().decode(bytes),
      where: `${method} ${url.pathname}${url.search}`,
    };
  }
  return { req };
}

// multipart：photos 为 [{bytes, type, filename}]；数组/对象自动 JSON
export function makeForm(fields = {}, photos = [], photoField = 'photos') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  for (const p of photos) {
    fd.append(photoField, new Blob([p.bytes], { type: p.type }),
      p.filename);
  }
  return fd;
}

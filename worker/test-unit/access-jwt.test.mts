// Access JWT 验签单元测试（node:test，Node ≥22 直接跑 .mts + 类型剥离）
//   npm run test:unit   （= node --test test-unit/*.test.mts）
// 放在 test-unit/ 而不是 test/unit/：test/ 是后端工程师正在用、尚未提交的目录，避免冲突。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyAccessJwt, getViewer } from "../src/auth.ts";

const TEAM = "koala-test.cloudflareaccess.com";
const AUD = "aud-koala-123";
const env: any = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const b64u = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? Buffer.from(b) : b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

async function keypair(kid: string) {
  const kp = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await webcrypto.subtle.exportKey("jwk", kp.publicKey)), kid, alg: "RS256", use: "sig" };
  return { kp, jwk, kid };
}
async function sign(k: Awaited<ReturnType<typeof keypair>>, payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: k.kid, typ: "JWT", ...header }));
  const p = b64u(JSON.stringify(payload));
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", k.kp.privateKey, Buffer.from(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ aud: [AUD], email: "koala@example.com", iss: `https://${TEAM}`, iat: now(), exp: now() + 3600 });

let K1: Awaited<ReturnType<typeof keypair>>, K2: Awaited<ReturnType<typeof keypair>>, OTHER: Awaited<ReturnType<typeof keypair>>;
let served: any[] = []; let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  K1 ??= await keypair("kid-1"); K2 ??= await keypair("kid-2"); OTHER ??= await keypair("kid-1");
  served = [K1.jwk]; fetches = 0;
  globalThis.fetch = (async (url: string) => {
    fetches++;
    assert.equal(String(url), `https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: served }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
process.on("exit", () => { globalThis.fetch = realFetch; });

test("合法 JWT 通过并取出 email", async () => {
  assert.deepEqual(await verifyAccessJwt(await sign(K1, good()), env), { email: "koala@example.com" });
});
test("aud 为字符串也可以", async () => {
  assert.ok(await verifyAccessJwt(await sign(K1, { ...good(), aud: AUD }), env));
});
test("AUD 不对 → 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, { ...good(), aud: ["别的应用"] }), env), null);
});
test("过期 → 拒绝（允许 30 秒时钟偏差）", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, { ...good(), exp: now() - 120 }), env), null);
  assert.ok(await verifyAccessJwt(await sign(K1, { ...good(), exp: now() - 5 }), env));
});
test("nbf 在未来 → 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, { ...good(), nbf: now() + 600 }), env), null);
});
test("iss 不是本团队域名 → 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, { ...good(), iss: "https://evil.cloudflareaccess.com" }), env), null);
});
test("iss 只是后缀相同（evil 前缀）→ 拒绝；缺 iss → 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, { ...good(), iss: `https://evil${TEAM}` }), env), null);
  const { iss, ...noIss } = good();
  assert.equal(await verifyAccessJwt(await sign(K1, noIss), env), null);
});
test("别人的私钥签的（同 kid）→ 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(OTHER, good()), env), null);
});
test("篡改 payload → 拒绝", async () => {
  const t = (await sign(K1, good())).split(".");
  t[1] = b64u(JSON.stringify({ ...good(), email: "hacker@example.com" }));
  assert.equal(await verifyAccessJwt(t.join("."), env), null);
});
test("alg=none / HS256 → 拒绝", async () => {
  const p = b64u(JSON.stringify(good()));
  assert.equal(await verifyAccessJwt(`${b64u(JSON.stringify({ alg: "none", kid: "kid-1" }))}.${p}.`, env), null);
  assert.equal(await verifyAccessJwt(`${b64u(JSON.stringify({ alg: "HS256", kid: "kid-1" }))}.${p}.abc`, env), null);
});
test("格式不对 → 拒绝", async () => {
  for (const t of ["", "abc", "a.b", "a.b.c.d", "!!.@@.##"]) assert.equal(await verifyAccessJwt(t, env), null, t);
});
test("密钥轮换：未知 kid 会强制重新拉 JWKS", async () => {
  await verifyAccessJwt(await sign(K1, good()), env); // 先缓存只有 kid-1 的 JWKS
  served = [K1.jwk, K2.jwk];
  const before = fetches;
  assert.ok(await verifyAccessJwt(await sign(K2, good()), env));
  assert.ok(fetches > before, "应重新拉取 JWKS");
});
test("JWKS 里找不到 kid → 拒绝", async () => {
  assert.equal(await verifyAccessJwt(await sign(K1, good(), { kid: "kid-unknown" }), env), null);
});

test("getViewer：请求头 Cf-Access-Jwt-Assertion", async () => {
  const req = new Request("https://x/api/kitchen/dishes", { headers: { "Cf-Access-Jwt-Assertion": await sign(K1, good()) } });
  assert.deepEqual(await getViewer(req, env), { logged_in: true, email: "koala@example.com", via: "access" });
});
test("getViewer：公开路径上读 CF_Authorization cookie", async () => {
  const req = new Request("https://x/api/dishes/1", { headers: { Cookie: `a=1; CF_Authorization=${await sign(K1, good())}` } });
  assert.equal((await getViewer(req, env)).logged_in, true);
});
test("getViewer：配了 Access 时 dev cookie 无效", async () => {
  const req = new Request("https://x/api/me", { headers: { Cookie: "koala_dev_auth=1" } });
  assert.equal((await getViewer(req, { ...env, DEV_AUTH: "1" })).logged_in, false);
});
test("getViewer：无效 JWT → 未登录", async () => {
  const req = new Request("https://x/api/me", { headers: { "Cf-Access-Jwt-Assertion": "bad.token.here" } });
  assert.equal((await getViewer(req, env)).logged_in, false);
});
test("getViewer：没配 Access，DEV_AUTH=1 + cookie → 登录", async () => {
  const req = new Request("https://x/api/me", { headers: { Cookie: "koala_dev_auth=1" } });
  assert.equal((await getViewer(req, { DEV_AUTH: "1" } as any)).via, "dev");
});
test("getViewer：两样都没配 → 未登录", async () => {
  const req = new Request("https://x/api/me", { headers: { Cookie: "koala_dev_auth=1" } });
  assert.equal((await getViewer(req, {} as any)).logged_in, false);
});

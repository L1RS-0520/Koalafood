/**
 * 登录判定（接口约定 v2.3）
 * - 线上：配了 ACCESS_TEAM_DOMAIN + ACCESS_AUD → 校验 Cf-Access-Jwt-Assertion（RS256，JWKS 验签，iss/aud/exp）
 * - 本地：DEV_AUTH=1 → 模拟 cookie koala_dev_auth
 * - 都没配 → 未登录
 */
import type { Env } from "./env.ts";

export interface Viewer { logged_in: boolean; email: string | null; via: "access" | "dev" | "none" }
export const DEV_COOKIE = "koala_dev_auth";
export const DEV_EMAIL = "koala-king@dev.local";

export const accessConfigured = (env: Env) => !!(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim());
export const devAuthEnabled = (env: Env) => !accessConfigured(env) && env.DEV_AUTH === "1";

const b64urlDecode = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { url: string; at: number; keys: Jwk[] } | null = null;

async function getJwks(team: string, force = false): Promise<Jwk[]> {
  const url = `https://${team.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/cdn-cgi/access/certs`;
  if (!force && jwksCache && jwksCache.url === url && Date.now() - jwksCache.at < 10 * 60_000) return jwksCache.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`JWKS ${r.status}`);
  const j = (await r.json()) as { keys?: Jwk[] };
  jwksCache = { url, at: Date.now(), keys: j.keys ?? [] };
  return jwksCache.keys;
}

export async function verifyAccessJwt(token: string, env: Env): Promise<{ email: string | null } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch { return null; }
  if (header.alg !== "RS256") return null;
  const team = env.ACCESS_TEAM_DOMAIN!.trim();
  let keys = await getJwks(team);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await getJwks(team, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now - 30) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD!.trim())) return null;
  // iss 必须正好是本团队域名（不能只比后缀，否则 evilxxx.cloudflareaccess.com 也能过）
  const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  if (host(String(payload.iss ?? "")) !== host(team)) return null;
  return { email: typeof payload.email === "string" ? payload.email : null };
}

export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.get("Cookie") ?? "";
  for (const part of h.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export async function getViewer(req: Request, env: Env): Promise<Viewer> {
  if (accessConfigured(env)) {
    // 受保护路径上 Access 会注入请求头；公开路径上浏览器仍会带 Access 的 CF_Authorization cookie（同一 JWT）
    const t = req.headers.get("Cf-Access-Jwt-Assertion") ?? readCookie(req, "CF_Authorization");
    if (!t) return { logged_in: false, email: null, via: "none" };
    try {
      const r = await verifyAccessJwt(t, env);
      return r ? { logged_in: true, email: r.email, via: "access" } : { logged_in: false, email: null, via: "none" };
    } catch (e) {
      console.error("Access JWT 校验出错", (e as Error).message);
      return { logged_in: false, email: null, via: "none" };
    }
  }
  if (devAuthEnabled(env) && readCookie(req, DEV_COOKIE) === "1")
    return { logged_in: true, email: DEV_EMAIL, via: "dev" };
  return { logged_in: false, email: null, via: "none" };
}

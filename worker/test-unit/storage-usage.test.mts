// 存储用量口径单元测试：1024 进制默认值、STORAGE_USED_SIM 只在本地生效、先 507 后 429
import { test } from "node:test";
import assert from "node:assert/strict";
import { usedBytes, checkBeforeWrite, storageLimitBytes, storageReport, capacityLevel, photosLeft, DEFAULT_STORAGE_LIMIT_BYTES, StorageFullError, StorageQuotaError } from "../src/storage/usage.ts";
import { tooLargeMessage } from "../src/lib.ts";
import { devAuthEnabled, isLocalEnv } from "../src/auth.ts";
const ONLINE = { ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud123" };

function fakeDb(sum = 1000, orphan = 200, ops = 0) {
  return { prepare: (sql: string) => ({ bind: () => ({ first: async () => (sql.includes("kv_usage") ? { ops } : null) }),
    first: async () => (sql.includes("dish_photos") ? { b: sum, n: 2 } : sql.includes("orphan_photos") ? { b: orphan } : null) }) } as any;
}
test("默认容量上限 = 950×1024×1024 = 996147200", () => {
  assert.equal(DEFAULT_STORAGE_LIMIT_BYTES, 996147200);
  assert.equal(storageLimitBytes({} as any), 996147200);
  assert.equal(storageLimitBytes({ STORAGE_LIMIT_BYTES: "5000" } as any), 5000);
});
test("线上配置下 STORAGE_LIMIT_BYTES、STORAGE_USED_SIM 都被忽略（与 DEV_AUTH 同一个判断）", async () => {
  const env = { DB: fakeDb(1000, 200), ...ONLINE, STORAGE_LIMIT_BYTES: "5000", STORAGE_USED_SIM: "123456", DEV_AUTH: "1" } as any;
  assert.equal(isLocalEnv(env), false);
  assert.equal(devAuthEnabled(env), false);
  assert.equal(storageLimitBytes(env), 996147200);
  const u = await usedBytes(env); assert.equal(u.bytes, 1200); assert.equal(u.simulated, false);
  const r = await storageReport(env, "kv");
  assert.equal(r.capacity.limit_bytes, 996147200); assert.equal(r.capacity.used_bytes, 1200);
  // 只配一半也按线上算（宁可关死）
  for (const half of [{ ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com" }, { ACCESS_AUD: "aud" }]) {
    const e = { DB: fakeDb(), ...half, STORAGE_LIMIT_BYTES: "5000", STORAGE_USED_SIM: "1", DEV_AUTH: "1" } as any;
    assert.equal(isLocalEnv(e), false); assert.equal(devAuthEnabled(e), false); assert.equal(storageLimitBytes(e), 996147200);
  }
});
test("本地：两个开关生效，DEV_AUTH 生效", () => {
  const env = { STORAGE_LIMIT_BYTES: "5000", DEV_AUTH: "1" } as any;
  assert.equal(isLocalEnv(env), true); assert.equal(devAuthEnabled(env), true); assert.equal(storageLimitBytes(env), 5000);
});
test("level：<80 ok，≥80 warn，≥95 danger（danger 不等于 STORAGE_FULL）", async () => {
  const L = 996147200;
  assert.equal(capacityLevel(L * 0.8 - 1, L), "ok"); assert.equal(capacityLevel(L * 0.8, L), "warn");
  assert.equal(capacityLevel(L * 0.95 - 1, L), "warn"); assert.equal(capacityLevel(L * 0.95, L), "danger"); assert.equal(capacityLevel(L, L), "danger");
  assert.equal(capacityLevel(7996, 10000), "ok"); assert.equal(capacityLevel(8000, 10000), "warn"); assert.equal(capacityLevel(9500, 10000), "danger");
  // 96% 已用、本次 1000 字节未超上限 → 不抛错
  await checkBeforeWrite({ DB: fakeDb(), STORAGE_USED_SIM: String(Math.round(996147200 * 0.96)) } as any, "kv", 1000, 1);
});
test("79.96%：percent 显示 80.0，但 level 仍是 ok（按字节判断）", async () => {
  const r = await storageReport({ DB: fakeDb(), STORAGE_LIMIT_BYTES: "10000", STORAGE_USED_SIM: "7996" } as any, "kv");
  assert.equal(r.capacity.percent, 80); assert.equal(r.capacity.level, "ok");
});
test("photos_left = floor(max(0, limit − used) / 512000)", () => {
  assert.equal(photosLeft(0, 996147200), 1945);
  assert.equal(photosLeft(2335552, 996147200), 1941);
  assert.equal(photosLeft(996147200, 996147200), 0);
  assert.equal(photosLeft(999999999, 996147200), 0);
});
test("storage 定稿形状 + percent 一位小数", async () => {
  const r = await storageReport({ DB: fakeDb(), STORAGE_USED_SIM: "2335552" } as any, "kv");
  assert.deepEqual(r, { store: "kv", photo_count: 2,
    capacity: { used_bytes: 2335552, limit_bytes: 996147200, percent: 0.2, level: "ok", photos_left: 1941 },
    daily_ops: { used: 0, limit: 1000 } });
});
test("413 文案：KB 向上取整 + 千分位，批量带第几张", () => {
  assert.equal(tooLargeMessage(1054720), "照片太大了（1,030KB），上限 1,024KB");
  assert.equal(tooLargeMessage(1048577, 2), "第 2 张照片太大了（1,025KB），上限 1,024KB");
});
test("已用量 = dish_photos + orphan_photos", async () => {
  assert.equal((await usedBytes({ DB: fakeDb(1000, 200) } as any)).bytes, 1200);
});
test("本地 STORAGE_USED_SIM 生效", async () => {
  const r = await usedBytes({ DB: fakeDb(), STORAGE_USED_SIM: "123456" } as any);
  assert.equal(r.bytes, 123456); assert.equal(r.simulated, true);
});
test("线上（配了 ACCESS_TEAM_DOMAIN）STORAGE_USED_SIM 一律忽略", async () => {
  const r = await usedBytes({ DB: fakeDb(1000, 200), STORAGE_USED_SIM: "123456", ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com" } as any);
  assert.equal(r.bytes, 1200); assert.equal(r.simulated, false);
});
test("同时超容量和次数：先 507（StorageFullError）", async () => {
  const env = { DB: fakeDb(0, 0, 5), STORAGE_USED_SIM: "996147000", KV_DAILY_WRITE_LIMIT: "5" } as any;
  await assert.rejects(checkBeforeWrite(env, "kv", 1000, 1), StorageFullError);
});
test("只超次数：429（StorageQuotaError）", async () => {
  const env = { DB: fakeDb(0, 0, 5), KV_DAILY_WRITE_LIMIT: "5" } as any;
  await assert.rejects(checkBeforeWrite(env, "kv", 1000, 1), StorageQuotaError);
});
test("非 KV 存储不按次数拦", async () => {
  const env = { DB: fakeDb(0, 0, 5), KV_DAILY_WRITE_LIMIT: "5" } as any;
  await checkBeforeWrite(env, "d1", 1000, 1);
});

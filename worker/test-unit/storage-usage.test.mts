// 存储用量口径单元测试：1024 进制默认值、STORAGE_USED_SIM 只在本地生效、先 507 后 429
import { test } from "node:test";
import assert from "node:assert/strict";
import { usedBytes, checkBeforeWrite, storageLimitBytes, DEFAULT_STORAGE_LIMIT_BYTES, StorageFullError, StorageQuotaError } from "../src/storage/usage.ts";

function fakeDb(sum = 1000, orphan = 200, ops = 0) {
  return { prepare: (sql: string) => ({ bind: () => ({ first: async () => (sql.includes("kv_usage") ? { ops } : null) }),
    first: async () => (sql.includes("dish_photos") ? { b: sum, n: 2 } : sql.includes("orphan_photos") ? { b: orphan } : null) }) } as any;
}
test("默认容量上限 = 950×1024×1024 = 996147200", () => {
  assert.equal(DEFAULT_STORAGE_LIMIT_BYTES, 996147200);
  assert.equal(storageLimitBytes({} as any), 996147200);
  assert.equal(storageLimitBytes({ STORAGE_LIMIT_BYTES: "5000" } as any), 5000);
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

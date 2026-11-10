# 考拉食堂 · 接口自动化测试

依据 `docs/接口约定.md` v2.1 最终定稿 + v2.2 多图 + v2.3（/api/kitchen、dev 登录、隐私）。

```bash
cd app/worker
node test/api.test.mjs              # 离线单测 + 在线全量（默认 http://localhost:8787）
node test/api.test.mjs --offline    # 只跑离线校验器/护栏单测，不需要服务器
node test/validators.test.mjs       # 同上，单独入口
API_BASE=http://127.0.0.1:8787 node test/api.test.mjs
STRICT=1 node test/api.test.mjs     # WARN（推断类检查）也算失败
```

- 退出码：0 全过；1 有 FAIL；2 服务器连不上（预检 5 秒超时）。
- 厨驼密钥：环境变量 `CHEF_KEY`，否则运行时读 `worker/.dev.vars`；只在内存里，输出统一脱敏，不写入任何文件。
- 登录：开跑时 `POST /api/dev/login` 拿 `koala_dev_auth` cookie（需 `.dev.vars` 里 `DEV_AUTH=1`），cookie 值同样脱敏。
- 安全：只对本次创建的菜（名字前缀 `【接口测试勿领】<runId>`）做写/厨驼操作；开跑前快照已有菜品，结束时核对未变；finally 删光本次数据并恢复 `chef_enabled=true`；Ctrl+C 也会先清理。
- 照片大小上限唯一来源：`lib/validators.mjs` 的 `MAX_PHOTO_BYTES`。
- 改夹具：编辑 `fixtures/build-fixtures.mjs` 后运行 `node test/fixtures/build-fixtures.mjs`。

## 存储用量 / 额度（2026-11-09 追加）
- `storage` 组：`GET /api/kitchen/storage` 结构、未登录 401、上传/追加 N 字节后
  used_bytes 精确 +N、photo_count +1，删除后复原（需顺序执行，期间别人别写照片）。
  服务端无此接口（带 cookie 仍 404）时整块 SKIP。
- `quota` 组：设置 `ALT_BASE=<小额度实例>` 才跑，否则 SKIP。持续写入直到
  507 STORAGE_FULL、429 STORAGE_QUOTA，断言列表 id 不变、无新 orphan_photos、
  用量不变；该实例同样快照已有菜、只删本次创建的菜。测试不启动服务、不跑 seed。
- `EXPECT_PHOTO_STORE`：health.photo_store 期望值，默认 kv。
- 基线记录见 `baseline-2026-11-09.txt`。

## 精简模式（默认）与 FULL=1（2026-11-09 追加）
- **默认精简**：只做少量上传，目标每轮 ≤40 次 KV 写入（put+delete 合并计数）。
  安全时同一道菜兼做多条只读检查；chef 状态类用例共用一个 pending 菜池：
  用例**成功**结束才把菜放回池，取用前先 ask-chef 恢复成干净的 pending，并核对
  无草稿、未被领取；失败用例的菜绝不复用（隔离不变）。断言一条都没放宽。
- **重用例只在 FULL=1 跑**（精简模式显示 `SKIP(FULL only)`，STRICT 下不算失败）：
  1MB 边界大文件、9 张上传/追加、10 张、8+2 追加、并发领取、整批拒绝。
- **开跑前检查**（任何写入前）：读 `GET /api/kitchen/storage` 的 daily_ops，
  剩余 = limit − used；精简 <60、FULL <200 → 打印中文原因，**退出码 3**，不跑任何用例。
  接口不存在时只警告、照常继续。
- **结束时实测**：再读一次 ops，打印「本轮用掉写入 N 次」；精简模式硬断言 N ≤ 40；
  另断言 health.orphan_photos 没有增长。
- **不鼓励在 8787 跑 FULL**：`FULL=1` 且 base 是 localhost:8787 时直接拒绝（退出码 3），
  除非显式加 `ALLOW_FULL_ON_8787=1`。FULL 一轮约 150–170 次写入，会挤占大家共用的
  每日 1000 次额度；请优先用 `API_BASE` 指向自己的实例。
- 其他实例（都不设则 SKIP，测试不启动服务）：`ALT_BASE`（507/429 额度）、
  `LEVEL_BASE_DANGER`（≥95%：level=danger 仍可上传，只有 已用+本次>上限 才 507）、
  `LEVEL_BASE_ROUND`（STORAGE_USED_SIM=floor(limit×0.7996)：percent=80.0 但 level=ok）。
- storage 结构：`{store, photo_count, capacity:{used_bytes, limit_bytes, percent, level,
  photos_left}, daily_ops:{used, limit}}`；level 只按字节比例推导（<80 ok / ≥80 warn /
  ≥95 danger，'full' 非法），percent 保留 1 位小数，1024 进制。

## 仅离线：`--offline` / `OFFLINE=1`（2026-11-09 修复）
- `node test/api.test.mjs --offline`（或 `OFFLINE=1 node test/api.test.mjs`）只跑离线单测
  和密钥扫描，**零网络请求**：参数解析在任何请求之前，离线时 http 助手和全局 fetch
  被锁死，一调用就抛错，结束时还断言被拦请求数为 0。
- 不认识的参数（如 `--offlnie`）直接报错退出 1，不会悄悄跑在线用例。
- 永久自检（在离线单测里）：子进程以 `--offline` 跑本脚本，API_BASE 分别指向
  `http://127.0.0.1:1` 和本机一个临时监听端口，要求 exit 0 且该端口收到 0 次连接。
- 密钥扫描：test/ 里不得出现 CHEF_KEY 的值、dev 登录 cookie 字面量、cookie/jar 文件。

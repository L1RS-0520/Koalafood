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

## 第二轮：厨驼 claim / draft 错误路径、并发、total_time（2026-11-10 追加）

`test/round2.test.mjs`，**只跑在临时实例上**：必须显式给 `ROUND2_BASE`，
不设或指向 8787 一律拒绝（退出码 3，不发任何请求）。

起一个临时实例（自己的 `--persist-to` 临时目录、临时配置放仓库外）：

```sh
R=$(mktemp -d /tmp/r2be-8820.XXXX)
# $R/wrangler.toml：复制 worker/wrangler.toml 的 D1/KV/vars，main、migrations_dir
# 写绝对路径，去掉 [assets]，CHEF_CLAIM_TTL_MIN = "0.05"（3 秒）
npx wrangler d1 migrations apply DB --local --persist-to $R/persist -c $R/wrangler.toml
npx wrangler dev --local --port 8820 --ip 127.0.0.1 --inspector-port 9820 \
  --persist-to $R/persist -c $R/wrangler.toml --env-file <.dev.vars 路径> &
```

运行：

```sh
ROUND2_BASE=http://127.0.0.1:8820 ROUND2_CLAIM_TTL_MIN=0.05 \
  node test/round2.test.mjs
```

- `ROUND2_CLAIM_TTL_MIN`：与实例的 `CHEF_CLAIM_TTL_MIN` 一致；不给则 TTL 用例 SKIP。
- `ROUND2_RACE_TRIALS`：每个并发用例重复次数（默认 5；claim-race 每轮至少 20）。
- `ROUND2_CLAIM_ROUNDS`：claim-race 轮数（默认 1；验收用 5 → 5×20 次，打印每轮双成功次数）。
- `CHEF_KEY_FILE`：`.dev.vars` 路径（只读，默认 `worker/.dev.vars`；worktree 里
  没有时指向主仓库那份）。环境变量里只放路径，不放密钥。`api.test.mjs` 和密钥扫描
  也认这个变量（`lib/chefkey.mjs` 是唯一的读取实现）。

覆盖：claim 404 / 非 pending（draft、厨驼确认、manual）409 BAD_STATE / 401 /
`chef_enabled=false` 403 / TTL 内 409 CONFLICT、过期后可再领；draft 404 /
confirmed 409 / 已有草稿 409 / 一组格式错 400（步骤 2、13 步、用量空、类型错、
非法 JSON、数组体、空体、超大体 400|413）/ 不 claim 也能交 / 只交 chef_message；
并发（Promise.all）：双 claim、双 draft、draft vs ask-chef、draft vs discard-draft，
最终状态必须是某个合法串行且草稿整份不混拼（判定是 `lib/round2.mjs` 里的纯函数，
有离线单测）；未登录列表/详情不泄露草稿（每个字段带唯一 tag），列表 total_time
只有 confirmed 才有值（src 没有该字段时 SKIP，泄露检查照跑）。

**v2.3.3 追加**：claim-race 已修复，改为普通断言（恰好一个 200、另一个 409 CONFLICT）；
新增 discard-draft vs ask-chef、confirm vs ask-chef、confirm vs discard-draft 并发用例；
`chef_message` 给数字 → 400；`servings`/`total_time` 超 20 字（数字先补单位再量）在交稿、
手写上传、PATCH、confirm 都 400；访客详情 `chef_requested_at` 为 null；列表/详情的
`total_time` 只显示最近一次确认的值（重新找厨驼后仍是旧值，草稿值不出现）。

**v2.3.3 追加（QA R1-06/07/08）**：所有 `/api/*` 响应带 `nosniff`；公开读、登录、kitchen、
厨驼、预检在任何 Origin 下都没有 ACAO，永不 `Allow-Credentials`；步骤 / 食材名 / 小贴士只写编号
→ 400，`details` 含 `{field, index(从 1 起), reason:"only_number"}`（手写、PATCH、confirm、交稿）；
交稿 / PATCH / confirm 的 JSON 体 65,536 字节通过、65,537 字节 413「内容太大了（65KB），上限 64KB」，
分块上传（无 Content-Length）同样拦。

**KNOWN_BUG**：已确认的真实缺陷可登记在 `round2.test.mjs` 的 `KNOWN_BUGS`，复现时记
WARN 并在末尾醒目汇总（`STRICT=1` 时算 FAIL）。当前没有登记项。

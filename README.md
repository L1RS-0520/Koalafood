仓库：L1RS-0520/Koalafood（公开），每轮 round-N 分支开 PR，不合并

# 考拉食堂 app
- `web/` 前端（Vite）— 前端组
- `worker/` 后端（Cloudflare Worker + D1 + KV）— 后端组
- `tools/chef.py` 厨驼写菜谱用的脚本 — 后端组
- 接口约定见 `docs/接口约定.md`（以文末 v2.3.1 为准）

## 前端

见 [web/README.md](web/README.md)。

## 后端

- 代码：`worker/`（Worker 源码、D1 迁移、脚本）和 `tools/chef.py`（厨驼工具，只用 Python 标准库）。
- 分支：`round-1`。
- 详细说明（目录、数据表、环境变量、已知限制、自测结果）：`docs/后端说明.md`；厨驼怎么用：`docs/厨驼使用说明.md`；照片存储选型：`docs/照片存储方案.md`。
- 全部在本地跑：D1、KV 都是 wrangler 的本地模拟（数据在 `worker/.wrangler/state`），**不连任何线上资源、不部署、不花钱**。
- 需要：Node ≥ 22（本机 24）、npm、Python 3（seed 生成占位图时如有 Pillow 会用，没有也能跑）。

### 从零启动（在 `app/worker/` 下执行）

```bash
cd worker

# 1. 安装依赖（npm 11 会拦截 esbuild/workerd 的安装脚本，需要放行一次）
npm install
npm install-scripts approve esbuild workerd   # npm 10 及以下没有这个命令，可跳过
npm rebuild esbuild workerd

# 2. 生成本地密钥文件 worker/.dev.vars（随机 CHEF_KEY + DEV_AUTH=1，权限 600，不显示密钥，不进 git）
./scripts/init-dev-vars

# 3. 初始化本地数据库（按 migrations/ 依次建表）
npx wrangler d1 migrations apply DB --local

# 4. 启动后端，端口 8787（也会托管 ../web/dist；目录不存在时 npm run dev 会放一个占位页）
npm run dev
#   等价于：npx wrangler d1 migrations apply DB --local && npx wrangler dev --local --port 8787 --ip 0.0.0.0
#   后台常驻：nohup npm run dev > /tmp/koala-worker.log 2>&1 &
#   换端口：PORT=8801 npm run dev（seed / chef.py / 测试都加 --base http://localhost:8801，接口测试用 API_BASE=…）

# 5. 另开终端导入示例菜（7 道 mode=chef 待写菜，可重复运行，已存在的同名菜会跳过）
./scripts/seed
./scripts/seed --reset      # 先删掉这 7 道示例菜（含照片）再重新导入

# 6. 跑接口测试
node test/api.test.mjs                      # 后端工程师的接口测试（默认打 http://localhost:8787；worker/test/ 由后端工程师提交）
node scripts/selftest.mjs                   # 后端组长自测（只建临时菜，跑完删光）
npm run test:unit                           # 单元测试（Access JWT 验签、存储用量口径）
node scripts/selftest-quota.mjs             # 额度/容量自测（自己在 8797 起临时实例，不碰 8787）
```

从仓库根目录跑接口测试：`node worker/test/api.test.mjs`。

### 清空并重建本地数据

```bash
cd worker
# 先停掉 wrangler dev
npm run db:reset            # = rm -rf .wrangler/state && npx wrangler d1 migrations apply DB --local
npm run dev                 # 再启动
./scripts/seed              # 重新导入示例菜
```
要保留现有数据就先备份：`tar czf ../备份-$(date +%Y%m%d-%H%M).tgz .wrangler/state`。

### 常用开关

| 做什么 | 怎么做 |
|---|---|
| 开启 CHEF_MOCK（pending 满 20 秒自动出示例草稿，联调用） | `npx wrangler dev --local --port 8787 --var CHEF_MOCK:1`（会把待写的菜都写掉，留给厨驼的菜别开） |
| 本地测 429 每天写入次数 | `.dev.vars` 加 `KV_DAILY_WRITE_LIMIT=5`，或 `--var KV_DAILY_WRITE_LIMIT:5` |
| 本地测 507 容量满 | `--var STORAGE_LIMIT_BYTES:10000` 或 `--var STORAGE_USED_SIM:996147000`（只在本地生效） |
| 换照片存储 | 默认 KV；D1：`--var PHOTO_STORE:d1`；R2：`--env r2`（默认配置不含 R2） |
| 改了 `.dev.vars` | 重启 wrangler dev |

示例：`.dev.vars` 的格式见 `worker/.dev.vars.example`（真文件只用 `init-dev-vars` 生成）。

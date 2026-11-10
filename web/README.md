# 考拉食堂 · 前端（web/）

Vite + React + TypeScript，自己写的 CSS（漫画风，没用 UI 库）。手机优先（375–430 宽），电脑也能看。
接口以 `../docs/接口约定.md` 为准，路径、字段名和状态值都集中在 `src/api/contract.ts`。

## 启动

```bash
cd app/web
npm install

# 方式一：用浏览器内置 mock（不需要后端，数据存在 localStorage）
npm run dev:mock          # http://127.0.0.1:5173

# 方式二：连本地后端（worker 在 8787，DEV_AUTH=1）
npm run dev               # /api 代理到 http://127.0.0.1:8787（可用 KOALA_API_TARGET 改）
```

打开首页右上角「大王登录」：本地调 `POST /api/dev/login`；线上走 Cloudflare Access（跳 `/kitchen/`），见 `src/api/contract.ts` 里的 `KITCHEN_LOGIN_ROUTE`。

## 构建与自测

```bash
npm run build             # tsc + vite build → dist/
npm run build:mock        # mock 版 → dist-mock/，npm run preview:mock 预览（4174）
npm run test:unit         # 压缩算法单元自测（node --test）
npm run test:compress     # 浏览器里真压缩：GPS JPEG 去 EXIF、方向、透明 PNG 铺白、≤1MB、WebP、HEIC 提示
npm run shots             # 用 mock 截 round-1 全部截图到 ../../截图/round-1/
```

截图和压缩自测需要本机有 Chrome（默认 `/usr/bin/google-chrome`，可用 `CHROME_PATH` 改）。

## mock 开发开关（localStorage）

| 键 | 作用 |
|---|---|
| `koala-canteen:mock:can_edit` = `0` | 切成访客视角 |
| `koala-canteen:mock:chef-delay` | 厨驼出稿时间（毫秒，默认 20000） |
| `koala-canteen:mock:storage-used` | 覆盖照片柜已用字节（≥80% 黄、≥95% 红、≥996147200 时上传返回 507） |
| `koala-canteen:mock:ops-today` | 覆盖今天已传次数（≥1000 时上传返回 429） |
| `koala-canteen:mock:chef-off` = `1` | 初始化时把「找厨驼写菜谱」关掉 |

菜名含「失败」→ 厨驼交带 chef_message 的空草稿；含「塞满」→ 429；含「超大」→ 413。设置页底部有「重置示例数据」。

## 目录

```
src/api/        contract.ts（路径/状态常量）、types.ts、normalize.ts、http.ts（真实后端）、mock*.ts
src/lib/        app.tsx（登录/设置/提示）、hooks.ts（轮询、离开拦截）、compress.ts（照片压缩）、uploadDraft.ts（上传页本地草稿）
src/components/ 卡片、相册、照片管理、菜谱展示/编辑、厨驼动画、存储提示、通用 UI
src/pages/      首页、详情、上传、编辑（含修改后确认）、设置、后厨守卫
src/styles/     tokens.css（设计变量）→ base → components → pages
```

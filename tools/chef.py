#!/usr/bin/env python3
"""厨驼工具：领取考拉食堂的待写菜、下载照片、提交菜谱草稿。只用 Python 标准库。

用法（在 app/ 目录下）：
  python3 tools/chef.py list                       列出待写的菜（pending）
  python3 tools/chef.py show <id>                  领取并下载全部照片到 /tmp/koala-chef/<id>/
  python3 tools/chef.py show <id> --no-claim       只看不领
  python3 tools/chef.py template                   输出草稿 JSON 模板
  python3 tools/chef.py submit <id> <draft.json>   交稿（draft.json 写 - 表示从标准输入读）
全局选项：--json 输出 JSON；--base http://localhost:8787 指定地址（也可用环境变量 KOALA_API）

密钥：优先读环境变量 CHEF_KEY；没有就自动读 app/worker/.dev.vars 里的 CHEF_KEY。脚本从不打印密钥。
"""
import argparse, json, os, sys, urllib.request, urllib.error
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
DEV_VARS = APP_DIR / "worker" / ".dev.vars"
DOWNLOAD_DIR = Path("/tmp/koala-chef")
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

TEMPLATE = {
    "ingredients": [
        {"name": "鸡蛋", "amount": "3个"},
        {"name": "番茄", "amount": "2个（约300克）"},
        {"name": "盐", "amount": "3克"},
    ],
    "steps": [
        {"text": "鸡蛋打入碗中，加 1 克盐，用筷子打散约 30 秒至表面起细泡", "heat": "", "time": "30秒", "caption": "打散它！"},
        {"text": "热锅倒 15 毫升油，烧到微微冒烟，倒入蛋液大火炒 1 分钟至八成熟盛出", "heat": "大火", "time": "1分钟", "caption": "嫩嫩的！"},
        {"text": "下番茄块中火翻炒约 2 分钟，压出汁后倒回鸡蛋，加 2 克盐炒匀 20 秒出锅", "heat": "中火", "time": "2分钟", "caption": "合体！"},
    ],
    "tips": ["番茄选熟透的更出汁"],
    "servings": "2人份",
    "total_time": "15分钟",
    "chef_message": None,
}


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def load_key():
    key = os.environ.get("CHEF_KEY", "").strip()
    if key:
        return key
    if DEV_VARS.exists():
        for line in DEV_VARS.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("CHEF_KEY="):
                v = line.split("=", 1)[1].strip().strip('"').strip("'")
                if v:
                    return v
    die(f"找不到厨驼密钥：没有环境变量 CHEF_KEY，{DEV_VARS} 里也没有 CHEF_KEY。\n"
        "请先在 app/worker 下运行 ./scripts/init-dev-vars，然后重启 wrangler dev。")


class ApiErr(Exception):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or []


def call(base, key, method, path, body=None, raw=False):
    data = None
    headers = {"X-Chef-Key": key}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            if raw:
                return payload, r.headers.get("Content-Type", "")
            return json.loads(payload.decode("utf-8"))
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(text)["error"]
            raise ApiErr(e.code, err.get("code"), err.get("message"), err.get("details"))
        except (ValueError, KeyError, TypeError):
            raise ApiErr(e.code, "HTTP", text[:300])
    except urllib.error.URLError as e:
        die(f"连不上 {base}（{e.reason}）。请先确认 wrangler dev 在跑：cd app/worker && npm run dev")


def out(args, data, human):
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(human)


def fail(args, e):
    if args.json:
        print(json.dumps({"error": {"status": e.status, "code": e.code, "message": e.message, "details": e.details}},
                         ensure_ascii=False, indent=2))
    else:
        print(f"失败（{e.status} {e.code}）：{e.message}", file=sys.stderr)
        for d in e.details:
            print(f"  - {d}", file=sys.stderr)
    sys.exit(2)


def cmd_list(args, key):
    tasks = call(args.base, key, "GET", "/api/chef/tasks")["tasks"]
    lines = [f"待写菜品 {len(tasks)} 道："] if tasks else ["没有待写的菜 🎉"]
    for t in tasks:
        claimed = f"（{t['claimed_at']} 已领）" if t.get("claimed_at") else ""
        lines.append(f"- {t['id']}  {t['name']}  [{t['category']}]  照片 {len(t['photos'])} 张{claimed}")
        if t.get("note"):
            lines.append(f"    备注：{t['note']}")
        if t.get("requested_note"):
            lines.append(f"    大王的要求：{t['requested_note']}")
    out(args, {"tasks": tasks}, "\n".join(lines))


def cmd_show(args, key):
    task, warn = None, None
    if not args.no_claim:
        try:
            task = call(args.base, key, "POST", f"/api/chef/tasks/{args.id}/claim")
        except ApiErr as e:
            if e.code != "CONFLICT":
                fail(args, e)
            warn = f"提醒：{e.message}（如果是你自己刚领的，可以继续写）"
    if task is None:
        tasks = call(args.base, key, "GET", "/api/chef/tasks")["tasks"]
        task = next((t for t in tasks if t["id"] == args.id), None)
        if task is None:
            fail(args, ApiErr(404, "NOT_FOUND", "待写列表里没有这道菜（可能不是 pending 状态，或 id 不对）"))
    folder = DOWNLOAD_DIR / task["id"]
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, p in enumerate(task["photos"], 1):
        data, ctype = call(args.base, key, "GET", f"/api/chef/tasks/{task['id']}/photos/{p['id']}", raw=True)
        path = folder / f"{i}.{EXT.get(ctype.split(';')[0].strip(), 'jpg')}"
        path.write_bytes(data)
        paths.append(str(path))
    result = dict(task, photo_paths=paths, warning=warn)
    lines = [warn] if warn else []
    lines += [f"菜名：{task['name']}", f"分类：{task['category']}", f"备注：{task.get('note') or '（无）'}"]
    if task.get("requested_note"):
        lines.append(f"大王的要求：{task['requested_note']}")
    lines.append(f"领取时间：{task.get('claimed_at') or '（未领取）'}")
    lines.append(f"照片 {len(paths)} 张（第 1 张是封面）：")
    lines += [f"  {x}" for x in paths]
    lines.append(f"写好后：python3 tools/chef.py submit {task['id']} 草稿.json")
    out(args, result, "\n".join(lines))


def cmd_template(args, key):
    print(json.dumps(TEMPLATE, ensure_ascii=False, indent=2))


def cmd_submit(args, key):
    try:
        text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8")
    except OSError as e:
        die(f"读不了草稿文件：{e}")
    try:
        draft = json.loads(text)
    except ValueError as e:
        die(f"草稿文件不是合法的 JSON：{e}")
    try:
        dish = call(args.base, key, "POST", f"/api/chef/tasks/{args.id}/draft", body=draft)
    except ApiErr as e:
        fail(args, e)
    d = dish.get("draft") or {}
    lines = [f"交稿成功：{dish['name']}（{dish['id']}）现在是 {dish['chef_status']} 状态，等大王确认。",
             f"食材 {len(d.get('ingredients', []))} 项，步骤 {len(d.get('steps', []))} 步。"]
    if d.get("chef_message"):
        lines.append(f"留言：{d['chef_message']}")
    for w in dish.get("warnings", []):
        lines.append(f"提醒：{w}")
    out(args, dish, "\n".join(lines))


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="输出 JSON")
    common.add_argument("--base", default=os.environ.get("KOALA_API", "http://localhost:8787"), help="后端地址")
    ap = argparse.ArgumentParser(description="考拉食堂 · 厨驼工具", parents=[common])
    # 子命令里也能写 --json/--base；用 SUPPRESS 避免覆盖写在子命令前面的值
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="输出 JSON")
    common.add_argument("--base", default=argparse.SUPPRESS, help="后端地址")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", parents=[common], help="列出待写的菜")
    s = sub.add_parser("show", parents=[common], help="领取并下载照片")
    s.add_argument("id")
    s.add_argument("--no-claim", action="store_true", help="只看不领")
    sub.add_parser("template", parents=[common], help="输出草稿模板")
    s = sub.add_parser("submit", parents=[common], help="提交草稿")
    s.add_argument("id")
    s.add_argument("file", help="草稿 JSON 文件，- 表示标准输入")
    args = ap.parse_args()
    key = None if args.cmd == "template" else load_key()
    {"list": cmd_list, "show": cmd_show, "template": cmd_template, "submit": cmd_submit}[args.cmd](args, key)


if __name__ == "__main__":
    main()

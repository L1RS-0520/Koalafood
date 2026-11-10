// 厨驼密钥读取（唯一实现）：运行时从 .dev.vars 读，只放内存，从不打印。
// 默认读 worker/.dev.vars；CHEF_KEY_FILE=<路径> 可指向别处的 .dev.vars
// （例如 worktree 里没有 .dev.vars 时，指向主仓库那份；只读）。
// 环境变量里只放「路径」，绝不放密钥本身。
import { readFileSync, existsSync } from 'node:fs';

export function chefKeyFile() {
  return process.env.CHEF_KEY_FILE || new URL('../../.dev.vars',
    import.meta.url);
}
export function readChefKey(file = chefKeyFile()) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?CHEF_KEY\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[1];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    return v || null;
  }
  return null;
}

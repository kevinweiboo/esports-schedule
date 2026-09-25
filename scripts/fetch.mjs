// 主抓取入口
//   node scripts/fetch.mjs            抓取并写入 data/
//   node scripts/fetch.mjs --dry-run  只打印，不写文件
//   node scripts/fetch.mjs --json     额外输出 data/schedule.json（给其它程序复用，
//                                     默认不写：网页只读 schedule.js，多一份会白白翻倍体积）

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchLol } from './sources/lol.mjs';
import { fetchF1 } from './sources/f1.mjs';
import { fetchCs2 } from './sources/cs2.mjs';
import { fetchValorant } from './sources/valorant.mjs';
import { normalize } from './normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
const WRITE_JSON = process.argv.includes('--json') || process.env.WRITE_JSON === '1';

const SOURCES = [
  { key: 'lol', label: '英雄联盟 LPL/LCK', game: 'lol', run: () => fetchLol() },
  { key: 'valorant', label: '瓦洛兰特 VCT', game: 'valorant', run: () => fetchValorant() },
  { key: 'cs2', label: 'CS2 S级/S+/Major', game: 'cs2', run: () => fetchCs2() },
  { key: 'f1', label: 'F1', game: 'f1', run: () => fetchF1() }
];

// 上次的数据兜底：某个源这次挂了时，用它上一轮留下的结果顶上，避免页面整块变空。
// 从 schedule.js 读（剥掉 `window.__SCHEDULE__ = ` 前缀），这样仓库里不用再存一份 schedule.json。
async function previousEvents() {
  for (const name of ['schedule.js', 'schedule.json']) {
    const file = path.join(DATA_DIR, name);
    if (!existsSync(file)) continue;
    try {
      let text = await readFile(file, 'utf8');
      text = text.trim().replace(/^window\.__SCHEDULE__\s*=\s*/, '').replace(/;+\s*$/, '');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.events)) return parsed.events;
    } catch {
      // 文件坏了就当没有，继续尝试下一个
    }
  }
  return [];
}

console.log(`开始抓取 ${new Date().toISOString()}`);

const settled = await Promise.allSettled(SOURCES.map((s) => s.run()));

const fresh = [];
const sources = [];
const failedGames = new Set();

settled.forEach((res, i) => {
  const def = SOURCES[i];
  if (res.status === 'fulfilled') {
    fresh.push(...res.value);
    // 赛事数和对局明细数都要打印：只报赛事数时，「赛事抓到了但一场明细都没有」
    // 这种静默退化在日志里完全看不出来（瓦洛兰特就这么坏了几周）。
    const mcount = res.value.reduce((s, e) => s + (e.matches?.length ?? 0), 0);
    sources.push({ key: def.key, label: def.label, ok: true, count: res.value.length, error: '' });
    console.log(`  ok   ${def.label.padEnd(18)} ${res.value.length} 场赛事` + (mcount ? ` / ${mcount} 场对局明细` : ' / ⚠ 无对局明细'));
  } else {
    failedGames.add(def.game);
    const msg = res.reason?.message ?? String(res.reason);
    sources.push({ key: def.key, label: def.label, ok: false, count: 0, error: msg });
    console.warn(`  FAIL ${def.label.padEnd(18)} ${msg}`);
  }
});

const prev = await previousEvents();
const keptStale = failedGames.size ? prev.filter((e) => failedGames.has(e.game)) : [];
if (keptStale.length) {
  console.warn(`  保留上次缓存 ${keptStale.length} 场（对应数据源本次失败）`);
}

const events = normalize([...fresh, ...keptStale]);

const byGame = {};
for (const e of events) byGame[e.game] = (byGame[e.game] ?? 0) + 1;

const meta = {
  generatedAt: new Date().toISOString(),
  total: events.length,
  byGame,
  sources
};

console.log(`\n合计 ${events.length} 场`, byGame);

if (DRY) {
  console.log('--dry-run：未写入文件');
  process.exit(0);
}

await mkdir(DATA_DIR, { recursive: true });
// 网页唯一读取的文件：http 与 file:// 都能用 <script src> 载入，不需要后端
await writeFile(
  path.join(DATA_DIR, 'schedule.js'),
  `window.__SCHEDULE__ = ${JSON.stringify({ meta, events })};\n`,
  'utf8'
);
await writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

let msg = '已写入 data/schedule.js、data/meta.json';
if (WRITE_JSON) {
  await writeFile(path.join(DATA_DIR, 'schedule.json'), JSON.stringify({ meta, events }, null, 2), 'utf8');
  msg += '、data/schedule.json';
}
console.log(msg);

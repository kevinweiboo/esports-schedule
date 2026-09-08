// 主抓取入口
//   node scripts/fetch.mjs            抓取并写入 data/
//   node scripts/fetch.mjs --dry-run  只打印，不写文件

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

const SOURCES = [
  { key: 'lol', label: '英雄联盟 LPL/LCK', game: 'lol', run: () => fetchLol() },
  { key: 'valorant', label: '瓦洛兰特 VCT CN', game: 'valorant', run: () => fetchValorant() },
  { key: 'cs2', label: 'CS2 S级/S+/Major', game: 'cs2', run: () => fetchCs2() },
  { key: 'f1', label: 'F1', game: 'f1', run: () => fetchF1() }
];

async function previousEvents() {
  const file = path.join(DATA_DIR, 'schedule.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch {
    return [];
  }
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
    sources.push({ key: def.key, label: def.label, ok: true, count: res.value.length, error: '' });
    console.log(`  ok   ${def.label.padEnd(18)} ${res.value.length} 场`);
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
await writeFile(path.join(DATA_DIR, 'schedule.json'), JSON.stringify({ meta, events }, null, 2), 'utf8');
await writeFile(
  path.join(DATA_DIR, 'schedule.js'),
  `window.__SCHEDULE__ = ${JSON.stringify({ meta, events })};\n`,
  'utf8'
);
await writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

console.log('已写入 data/schedule.json、data/schedule.js、data/meta.json');

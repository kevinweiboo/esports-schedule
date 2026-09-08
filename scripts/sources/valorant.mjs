// 瓦洛兰特：号角（https://web.haojiao.cc/wiki/wiki_home/t2Ud5pOQlscKLbRC）
// 只保留 VCT（冠军巡回赛）下的 CN 联赛、大师赛、全球冠军赛
// 用法：node scripts/sources/valorant.mjs

import crypto from 'node:crypto';
import { postJson, windowBounds } from '../http.mjs';
import {
  HAOJIAO_SECRET, HAOJIAO_VERSION, HAOJIAO_GAME_ID,
  VAL_SERIES_NAME, VAL_GROUP_PATTERNS, WINDOW
} from '../config.mjs';

const BASE = 'https://api.haojiao.cc/wiki';
const ORIGIN = 'https://web.haojiao.cc';

// 号角接口要求一组签名头：sign = SHA1(secret + nonce + timestamp)
function signHeaders() {
  const nonce = Math.random().toString(36).slice(2, 12);
  const ts = Date.now().toString();
  const sign = crypto.createHash('sha1').update(HAOJIAO_SECRET + nonce + ts).digest('hex');
  return {
    'x-hj-version': HAOJIAO_VERSION,
    'x-hj-os': 'web',
    'x-hj-nonce': nonce,
    'x-hj-timestamp': ts,
    'x-hj-sign': sign,
    Origin: ORIGIN,
    Referer: ORIGIN + '/'
  };
}

async function listPage(page, pageSize = 200) {
  const json = await postJson(
    `${BASE}/api/v1/tournament/list`,
    { game_id: HAOJIAO_GAME_ID, platform: 'web', page, page_size: pageSize },
    { headers: signHeaders() }
  );
  if (json?.code !== 200) throw new Error(`号角返回 code=${json?.code}`);
  return json.data ?? {};
}

function matchGroup(name) {
  for (const p of VAL_GROUP_PATTERNS) if (p.re.test(name)) return p;
  return null;
}

export async function fetchValorant() {
  const { from, to } = windowBounds(WINDOW);
  const out = [];
  const seen = new Set();
  let scanned = 0;

  for (let page = 1; page <= 6; page++) {
    const data = await listPage(page);
    const list = data.list ?? [];
    if (!list.length) break;
    scanned += list.length;

    for (const t of list) {
      // 只要 VCT 系列
      if (t.series_info?.series_name !== VAL_SERIES_NAME) continue;
      const group = t.tournament_group_info?.name_main || '';
      const rule = matchGroup(group);
      if (!rule) continue;

      const startMs = t.start_date || 0;
      const endMs = t.end_date || 0;
      if (!startMs) continue;
      const start = new Date(startMs).toISOString();
      const end = endMs ? new Date(endMs).toISOString() : null;
      if (end && end < from) continue;
      if (start > to) continue;

      const id = `valorant-${t.tournament_id || t.unique_id}`;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({
        id,
        game: 'valorant',
        gameLabel: '瓦洛兰特',
        league: rule.label,
        leagueSlug: '',
        leagueImage: t.icon ? `https://files.haojiao.cc${t.icon}` : '',
        region: t.zone_name || '',
        tournament: [t.name, group].filter(Boolean).join(' '),
        stage: group,
        title: [t.name, group].filter(Boolean).join(' · '),
        teams: [],
        bestOf: null,
        startTime: start,
        endTime: end,
        status: 'upcoming',
        tierKey: rule.tier,
        tierLabel: rule.label,
        venue: t.supple_text || '',
        prize: t.total_bonus || '',
        streams: [],
        source: 'haojiao'
      });
    }

    if (out.length && list.length < 200) break;
  }

  if (!out.length && scanned) {
    console.warn(`  [瓦洛兰特] 扫描 ${scanned} 个赛事未命中。检查 config.mjs 的 VAL_SERIES_NAME / VAL_GROUP_PATTERNS`);
  }

  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('sources/valorant.mjs')) {
  const evs = await fetchValorant();
  console.log(`瓦洛兰特 抓取到 ${evs.length} 个赛事`);
  for (const e of evs) {
    console.log(`  ${e.startTime.slice(0, 10)} ~ ${(e.endTime || '').slice(0, 10)}  [${e.tierLabel}] ${e.title} · ${e.venue || '-'}`);
  }
}

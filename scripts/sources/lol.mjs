// 英雄联盟：Riot 官方 esports API（社区公开 key）
// 用法：node scripts/sources/lol.mjs            —— 抓取
//       node scripts/sources/lol.mjs --leagues  —— 列出全部可用联赛 slug

import { fetchJson, windowBounds } from '../http.mjs';
import { LOL_LEAGUES, RIOT_API_KEY, WINDOW } from '../config.mjs';

const BASE = 'https://esports-api.lolesports.com/persisted/gw';
const HL = 'zh-CN';
const HEADERS = { 'x-api-key': RIOT_API_KEY };

const MAX_PAGES = 3; // 每页 80 条，够覆盖一个赛季

async function getLeagues() {
  const data = await fetchJson(`${BASE}/getLeagues?hl=${HL}`, { headers: HEADERS });
  return data?.data?.leagues ?? [];
}

async function getSchedulePage(leagueId, pageToken) {
  let url = `${BASE}/getSchedule?hl=${HL}&leagueId=${leagueId}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
  const data = await fetchJson(url, { headers: HEADERS });
  return data?.data?.schedule ?? { events: [], pages: {} };
}

function mapStatus(state) {
  if (state === 'inProgress') return 'live';
  if (state === 'completed') return 'completed';
  return 'upcoming';
}

function toEvent(e) {
  const match = e.match ?? {};
  const teams = (match.teams ?? []).map((t) => ({
    name: t.name ?? 'TBD',
    code: t.code ?? '',
    logo: t.image ?? '',
    score: t.result?.gameWins ?? null
  }));
  return {
    id: `lol-${match.id ?? e.startTime}`,
    game: 'lol',
    gameLabel: '英雄联盟',
    league: e.league?.name ?? '',
    leagueSlug: e.league?.slug ?? '',
    leagueImage: e.league?.image ?? '',
    region: e.league?.region ?? '',
    tournament: e.league?.name ?? '',
    stage: e.blockName ?? '',
    title: teams.length ? teams.map((t) => t.code || t.name).join(' vs ') : (e.blockName ?? ''),
    teams,
    bestOf: match.strategy?.count ?? null,
    startTime: new Date(e.startTime).toISOString(),
    status: mapStatus(e.state),
    venue: '',
    streams: [],
    source: 'riot'
  };
}

export async function fetchLol() {
  const all = await getLeagues();
  const wanted = all.filter((l) => LOL_LEAGUES.includes(l.slug));

  if (!wanted.length) {
    const available = all.map((l) => l.slug).join(', ');
    throw new Error(`配置的联赛 ${LOL_LEAGUES.join('/')} 都不存在。可用：${available}`);
  }

  const { from, to } = windowBounds(WINDOW);
  const out = [];
  const seen = new Set();

  for (const league of wanted) {
    // 先取默认页，再分别向更早 / 更晚翻页
    const first = await getSchedulePage(league.id, null);
    const buckets = [first];
    let token = first.pages?.older;
    for (let i = 0; i < MAX_PAGES && token; i++) {
      const page = await getSchedulePage(league.id, token);
      buckets.push(page);
      token = page.pages?.older;
    }
    token = first.pages?.newer;
    for (let i = 0; i < MAX_PAGES && token; i++) {
      const page = await getSchedulePage(league.id, token);
      buckets.push(page);
      token = page.pages?.newer;
    }

    for (const bucket of buckets) {
      for (const e of bucket.events ?? []) {
        if (e.type !== 'match' || !e.match) continue;
        const t = new Date(e.startTime).toISOString();
        if (t < from || t > to) continue;
        if (seen.has(e.match.id)) continue;
        seen.add(e.match.id);
        out.push(toEvent(e));
      }
    }
  }

  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}

// 直接运行时打印结果，方便单独调试
if (process.argv[1]?.replace(/\\/g, '/').endsWith('sources/lol.mjs')) {
  if (process.argv.includes('--leagues')) {
    const all = await getLeagues();
    for (const l of all) console.log(`${l.slug.padEnd(28)} ${l.id.padEnd(22)} ${l.name}  [${l.region}]`);
  } else {
    const evs = await fetchLol();
    console.log(`英雄联盟 抓取到 ${evs.length} 场`);
    for (const e of evs.slice(0, 12)) {
      console.log(`  ${e.startTime}  ${e.league.padEnd(6)} ${(e.stage || '').padEnd(10)} ${e.title}`);
    }
  }
}

// CS2：5eplay 赛事数据中心（https://event.5eplay.com/csgo/events）
// 两层数据：
//   1) csgo_event_list_v1 —— 赛事级（Major / S+ / S级），给出赛事起止区间
//   2) session_list       —— 比赛级（具体每场 BO 对局：时间/队伍/比分/阶段）
// 用法：node scripts/sources/cs2.mjs

import { postJson, fetchJson as getJson, windowBounds } from '../http.mjs';
import { CS_GRADES, CS_GRADE_LABEL, WINDOW } from '../config.mjs';

const EVENT_API = 'https://app.5eplay.com/api/csgo/tournament/csgo_event_list_v1';
const MATCH_API = 'https://app.5eplay.com/api/tournament/session_list';
const ORIGIN = 'https://event.5eplay.com';
const HEADERS = {
  Origin: ORIGIN,
  Referer: ORIGIN + '/csgo/matches',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

// 5eplay 返回的 "2026-09-08 00:00:00" 是北京时间，补上 +08:00
function toIso(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T') + '+08:00').toISOString();
}

async function fetchEvents(grade, pageToken) {
  const body = {
    tournaments_options: {
      cursor: '',
      player_id: '',
      time_value: null,
      team_id: '',
      time_type: null,
      tt_series: [],
      grade,
      tt_bonus: [],
      page_token: pageToken || ''
    }
  };
  const json = await postJson(EVENT_API, body, { headers: HEADERS });
  if (!json?.success) throw new Error(json?.message || '5eplay event_list 返回失败');
  return json.data ?? {};
}

// game_status: 0=未开始的比赛 1=进行中赛事的比赛 2=已结束的比赛（赛果）
// 接口按时间倒序（新 -> 旧），翻到早于窗口起点即停
async function fetchMatches(gameStatus, from, to) {
  const out = [];
  for (let page = 1; page <= 8; page++) {
    const url = `${MATCH_API}?game_status=${gameStatus}&game_type=1&grades=${CS_GRADES.join(',')}&page=${page}&limit=100`;
    const json = await getJson(url, { headers: HEADERS });
    if (!json?.success) break;
    const ms = json.data?.matches ?? [];
    if (!ms.length) break;
    let allOld = true;
    for (const m of ms) {
      const t = Number(m.mc_info?.plan_ts) * 1000;
      if (!t) continue;
      if (t > to) continue;      // 太晚（罕见，倒序时一般在首页前部）
      if (t < from) continue;    // 太早
      allOld = false;
      out.push(m);
    }
    if (allOld) break;           // 本页全部早于窗口，后面更老，停止翻页
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

function mapMatch(m) {
  const mc = m.mc_info ?? {};
  const st = m.state ?? {};
  const t1 = mc.t1_info ?? {};
  const t2 = mc.t2_info ?? {};
  const ts = Number(mc.plan_ts) * 1000;
  const statusNum = Number(st.status) || 0;
  const boNum = parseInt(mc.format, 10);
  return {
    id: `cs2m-${mc.id}`,
    time: ts ? new Date(ts).toISOString() : null,
    bo: boNum > 0 ? boNum : null,
    stage: mc.tt_stage_desc || mc.round_name || '',
    t1: { name: t1.disp_name || '', logo: t1.logo || '', score: st.t1_score ?? '' },
    t2: { name: t2.disp_name || '', logo: t2.logo || '', score: st.t2_score ?? '' },
    status: statusNum === 2 ? 'completed' : statusNum === 1 ? 'live' : 'upcoming'
  };
}

export async function fetchCs2() {
  const { from, to } = windowBounds(WINDOW);
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();

  // ---- 1) 赛事级 ----
  const ttById = new Map();
  const order = [];
  let token = '';
  for (let page = 0; page < 5; page++) {
    const data = await fetchEvents(CS_GRADES, token);
    const items = data.items ?? [];
    if (!items.length) break;
    for (const it of items) {
      const b = it.basic_info ?? {};
      if (!b.id || ttById.has(b.id)) continue;
      const start = toIso(b.start_time);
      const end = toIso(b.end_time);
      if (!start) continue;
      if (end && end < from) continue;
      if (start > to) continue;
      ttById.set(b.id, {
        id: `cs2-${b.id}`,
        ttId: b.id,
        game: 'cs2',
        gameLabel: 'CS2',
        league: 'CS2',
        leagueSlug: 'cs2',
        leagueImage: b.logo || '',
        region: '',
        tournament: b.disp_name || '',
        stage: CS_GRADE_LABEL[b.grade] || b.grade_label || '',
        title: b.disp_name || '',
        teams: [],
        bestOf: null,
        startTime: start,
        endTime: end,
        status: 'upcoming',
        tierKey: b.grade === '1' ? 'international' : 't1',
        tierLabel: CS_GRADE_LABEL[b.grade] || b.grade_label || '',
        venue: b.city_name || '',
        prize: b.bonus || '',
        streams: [],
        matches: [],
        source: '5eplay'
      });
      order.push(b.id);
    }
    token = data.page_token || '';
    if (!token) break;
  }

  // ---- 2) 比赛级（挂到赛事下；三种状态可能重叠，按比赛 id 去重）----
  const rawMatches = [];
  const seenMc = new Set();
  for (const gs of [1, 0, 2]) {
    const ms = await fetchMatches(gs, fromMs, toMs);
    for (const m of ms) {
      const mcId = m.mc_info?.id;
      if (!mcId || seenMc.has(mcId)) continue;
      seenMc.add(mcId);
      rawMatches.push(m);
    }
  }

  const extraTt = new Map(); // 比赛里出现但赛事列表没有的赛事（保险）
  for (const m of rawMatches) {
    const ev = mapMatch(m);
    if (!ev.time) continue;
    const tt = m.tt_info ?? {};
    const ttId = tt.id || '';
    let host = ttById.get(ttId);
    if (!host) {
      host = extraTt.get(ttId);
      if (!host) {
        const start = toIso(tt.start_time) || ev.time;
        const end = toIso(tt.end_time) || ev.time;
        if (end < from || start > to) continue;
        host = {
          id: `cs2-${ttId}`,
          ttId,
          game: 'cs2',
          gameLabel: 'CS2',
          league: 'CS2',
          leagueSlug: 'cs2',
          leagueImage: tt.logo || '',
          region: '',
          tournament: tt.disp_name || '',
          stage: CS_GRADE_LABEL[tt.grade] || tt.grade_label || '',
          title: tt.disp_name || '',
          teams: [],
          bestOf: null,
          startTime: start,
          endTime: end,
          status: 'upcoming',
          tierKey: tt.grade === '1' ? 'international' : 't1',
          tierLabel: CS_GRADE_LABEL[tt.grade] || tt.grade_label || '',
          venue: tt.city_name || '',
          prize: tt.bonus || '',
          streams: [],
          matches: [],
          source: '5eplay'
        };
        extraTt.set(ttId, host);
      }
    }
    host.matches.push(ev);
  }
  for (const h of extraTt.values()) { ttById.set(h.ttId, h); order.push(h.ttId); }

  // ---- 汇总：排序、推导赛事状态 ----
  const now = Date.now();
  const out = [];
  for (const ttId of order) {
    const e = ttById.get(ttId);
    if (!e) continue;
    e.matches.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const st = e.matches.map(m => m.status);
    const startMs = new Date(e.startTime).getTime();
    const endMs = e.endTime ? new Date(e.endTime).getTime() : 0;
    let status = 'upcoming';
    if (st.includes('live')) status = 'live';
    else if (st.length && st.every(s => s === 'completed') && (!endMs || endMs < now)) status = 'completed';
    else if (endMs && endMs < now) status = 'completed';
    else if (now >= startMs && (!endMs || now <= endMs)) status = 'live'; // 赛事区间覆盖当前时间
    e.status = status;
    if (e.matches.length) e.matchCount = e.matches.length;
    out.push(e);
  }
  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('sources/cs2.mjs')) {
  const evs = await fetchCs2();
  const withM = evs.filter(e => e.matches.length);
  const total = evs.reduce((s, e) => s + e.matches.length, 0);
  console.log(`CS2 抓取到 ${evs.length} 个赛事，其中 ${withM.length} 个有比赛明细，共 ${total} 场比赛`);
  for (const e of evs) {
    console.log(`  ${e.startTime.slice(0, 10)} ~ ${(e.endTime || '').slice(0, 10)}  [${e.tierLabel}] ${e.title} · 比赛 ${e.matches.length} 场 · ${e.status}`);
    for (const m of e.matches.slice(0, 2)) {
      console.log(`      ${m.time}  ${m.t1.name} ${m.t1.score}:${m.t2.score} ${m.t2.name}  BO${m.bo ?? '?'}  ${m.stage}`);
    }
  }
}

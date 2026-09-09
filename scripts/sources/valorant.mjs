// 瓦洛兰特：号角（https://web.haojiao.cc/wiki/wiki_home/t2Ud5pOQlscKLbRC）
// 两层数据：
//   1) tournament/list      —— 赛事级（起止区间、赛区、奖金）
//   2) match/list_index     —— 比赛级（每场对局：时间/队伍/比分/BO/阶段），响应是 AES 加密的
// 用法：node scripts/sources/valorant.mjs

import crypto from 'node:crypto';
import { postJson, postText, windowBounds } from '../http.mjs';
import {
  HAOJIAO_SECRET, HAOJIAO_VERSION, HAOJIAO_GAME_ID, HAOJIAO_AES_KEY,
  VAL_SERIES_NAME, VAL_GROUP_PATTERNS, WINDOW
} from '../config.mjs';

const BASE = 'https://api.haojiao.cc/wiki';
const ORIGIN = 'https://web.haojiao.cc';
const FILES = 'https://files.haojiao.cc';

// ---- 号角比赛接口的解密 ----
// 响应是 base64(AES-192-CBC 密文)，content-type 为 text/plain。
// CryptoJS 的 enc.Utf8.parse(key) 就是按 UTF-8 取字节；24 字节密钥 → aes-192；
// IV 用的也是这个字符串，CryptoJS 只取前 16 字节。
const AES_KEY = Buffer.from(HAOJIAO_AES_KEY, 'utf8');
const AES_IV = AES_KEY.subarray(0, 16);

function decryptPayload(text) {
  const d = crypto.createDecipheriv('aes-192-cbc', AES_KEY, AES_IV);
  return Buffer.concat([
    d.update(Buffer.from(String(text).trim(), 'base64')),
    d.final()
  ]).toString('utf8');
}

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

// ---- 2) 比赛级 ----
// match_status: 1=未开始 2=进行中 3=已结束
async function fetchMatches(startMs, endMs) {
  const raw = await postText(
    `${BASE}/api/v2/match/list_index`,
    { game_id: HAOJIAO_GAME_ID, zone_id: [], level: [], start_time: startMs, end_time: endMs, platform: 'web' },
    { headers: signHeaders() }
  );
  let json;
  try {
    json = JSON.parse(decryptPayload(raw));
  } catch {
    // 参数不对时它返回的是没加密的错误 JSON，直接按明文解析
    try { json = JSON.parse(raw); } catch { throw new Error('比赛接口解密失败（密钥可能已换）'); }
  }
  if (json?.code !== 200) throw new Error(`号角比赛接口 code=${json?.code}`);
  return Array.isArray(json.data) ? json.data : [];
}

function mapMatch(m) {
  const v = m.versus_info ?? {};
  const t1 = (v.main_camp ?? [])[0] ?? {};
  const t2 = (v.guest_camp ?? [])[0] ?? {};
  const statusNum = Number(m.match_status) || 0;
  return {
    id: `valm-${m.unique_id}`,
    time: m.match_start_time ? new Date(Number(m.match_start_time)).toISOString() : null,
    bo: Number(m.match_num_type) > 0 ? Number(m.match_num_type) : null,
    stage: [m.stage_info?.stage_name, m.schedule_name].filter(Boolean).join(' '),
    t1: { name: t1.name_main || t1.name_short || 'TBD', logo: t1.icon ? FILES + t1.icon : '', score: v.main_score ?? '' },
    t2: { name: t2.name_main || t2.name_short || 'TBD', logo: t2.icon ? FILES + t2.icon : '', score: v.guest_score ?? '' },
    status: statusNum === 3 ? 'completed' : statusNum === 2 ? 'live' : 'upcoming'
  };
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
        matches: [],
        source: 'haojiao'
      });
    }

    if (out.length && list.length < 200) break;
  }

  if (!out.length && scanned) {
    console.warn(`  [瓦洛兰特] 扫描 ${scanned} 个赛事未命中。检查 config.mjs 的 VAL_SERIES_NAME / VAL_GROUP_PATTERNS`);
  }

  // ---- 2) 比赛级：挂到对应赛事下 ----
  const now = Date.now();
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  let rawMatches = [];
  try {
    rawMatches = await fetchMatches(fromMs, toMs);
  } catch (e) {
    // 明细拿不到也要保住赛事级数据，不要让整块变空
    console.warn(`  [瓦洛兰特] 比赛明细抓取失败：${e.message}`);
  }

  const byTt = new Map();
  for (const e of out) byTt.set(String(e.id).replace(/^valorant-/, ''), e);

  const extra = [];
  for (const m of rawMatches) {
    if (m.series_info?.series_name !== VAL_SERIES_NAME) continue;
    const group = m.tournament_group_info?.name_main || '';
    const rule = matchGroup(group);
    if (!rule) continue;

    const ev = mapMatch(m);
    if (!ev.time || ev.time < from || ev.time > to) continue;

    const ttId = m.tournament_info?.tournament_id || '';
    let host = byTt.get(ttId);
    if (!host) {
      // 比赛里有、赛事列表里没有的赛事（保险）：用这批比赛的起止时间造一个
      host = extra.find((e) => e.ttId === ttId);
      if (!host) {
        host = {
          id: `valorant-${ttId}`,
          ttId,
          game: 'valorant',
          gameLabel: '瓦洛兰特',
          league: rule.label,
          leagueSlug: '',
          leagueImage: m.tournament_info?.icon ? FILES + m.tournament_info.icon : '',
          region: '',
          tournament: [m.tournament_info?.name_main, group].filter(Boolean).join(' '),
          stage: group,
          title: [m.tournament_info?.name_main, group].filter(Boolean).join(' · '),
          teams: [],
          bestOf: null,
          startTime: ev.time,
          endTime: ev.time,
          status: 'upcoming',
          tierKey: rule.tier,
          tierLabel: rule.label,
          venue: '',
          prize: '',
          streams: [],
          matches: [],
          source: 'haojiao'
        };
        extra.push(host);
      }
    }
    host.matches.push(ev);
    if (ev.time < host.startTime) host.startTime = ev.time;
    if (ev.time > host.endTime) host.endTime = ev.time;
  }
  if (extra.length) out.push(...extra);

  // 有明细后按明细推导赛事状态（与 CS2 一致），没有明细的交给 normalize 按起止区间推断
  for (const e of out) {
    if (!e.matches.length) continue;
    e.matches.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const st = e.matches.map((m) => m.status);
    const endMs = e.endTime ? Date.parse(e.endTime) : 0;
    if (st.includes('live')) e.status = 'live';
    else if (st.every((s) => s === 'completed') && (!endMs || endMs < now)) e.status = 'completed';
    e.matchCount = e.matches.length;
  }

  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('sources/valorant.mjs')) {
  const evs = await fetchValorant();
  const withM = evs.filter((e) => e.matches.length);
  const total = evs.reduce((s, e) => s + e.matches.length, 0);
  console.log(`瓦洛兰特 抓取到 ${evs.length} 个赛事，其中 ${withM.length} 个有比赛明细，共 ${total} 场`);
  for (const e of evs) {
    console.log(`  ${e.startTime.slice(0, 10)} ~ ${(e.endTime || '').slice(0, 10)}  [${e.tierLabel}] ${e.title} · 比赛 ${e.matches.length} 场 · ${e.status}`);
    for (const m of e.matches.slice(0, 3)) {
      console.log(`      ${m.time}  ${m.t1.name} ${m.t1.score}:${m.t2.score} ${m.t2.name}  BO${m.bo ?? '?'}  ${m.stage}`);
    }
  }
}

// F1：Jolpica（Ergast 兼容接口，无需鉴权）
// 一场大奖赛会被拆成多个 session（练习赛 / 排位 / 冲刺 / 正赛），每条都是独立的一「场」
// 用法：node scripts/sources/f1.mjs

import { fetchJson, windowBounds } from '../http.mjs';
import { F1_SEASON, WINDOW } from '../config.mjs';

const BASE = 'https://api.jolpi.ca/ergast/f1';

// 大奖赛中文名（查不到就退回英文原名）
const GP_CN = {
  'Australian Grand Prix': '澳大利亚大奖赛',
  'Chinese Grand Prix': '中国大奖赛',
  'Japanese Grand Prix': '日本大奖赛',
  'Bahrain Grand Prix': '巴林大奖赛',
  'Saudi Arabian Grand Prix': '沙特阿拉伯大奖赛',
  'Miami Grand Prix': '迈阿密大奖赛',
  'Emilia Romagna Grand Prix': '艾米利亚-罗马涅大奖赛',
  'Monaco Grand Prix': '摩纳哥大奖赛',
  'Spanish Grand Prix': '西班牙大奖赛',
  'Madrid Grand Prix': '马德里大奖赛',
  'Canadian Grand Prix': '加拿大大奖赛',
  'Austrian Grand Prix': '奥地利大奖赛',
  'British Grand Prix': '英国大奖赛',
  'Hungarian Grand Prix': '匈牙利大奖赛',
  'Belgian Grand Prix': '比利时大奖赛',
  'Dutch Grand Prix': '荷兰大奖赛',
  'Italian Grand Prix': '意大利大奖赛',
  'Azerbaijan Grand Prix': '阿塞拜疆大奖赛',
  'Singapore Grand Prix': '新加坡大奖赛',
  'United States Grand Prix': '美国大奖赛',
  'Mexico City Grand Prix': '墨西哥城大奖赛',
  'São Paulo Grand Prix': '圣保罗大奖赛',
  'Brazilian Grand Prix': '巴西大奖赛',
  'Las Vegas Grand Prix': '拉斯维加斯大奖赛',
  'Qatar Grand Prix': '卡塔尔大奖赛',
  'Abu Dhabi Grand Prix': '阿布扎比大奖赛',
  'Argentine Grand Prix': '阿根廷大奖赛',
  'French Grand Prix': '法国大奖赛',
  'German Grand Prix': '德国大奖赛'
};

const COUNTRY_CN = {
  Australia: '澳大利亚', China: '中国', Japan: '日本', Bahrain: '巴林',
  'Saudi Arabia': '沙特阿拉伯', USA: '美国', Italy: '意大利', Monaco: '摩纳哥',
  Spain: '西班牙', Canada: '加拿大', Austria: '奥地利', UK: '英国',
  Hungary: '匈牙利', Belgium: '比利时', Netherlands: '荷兰', Azerbaijan: '阿塞拜疆',
  Singapore: '新加坡', Mexico: '墨西哥', Brazil: '巴西', Qatar: '卡塔尔',
  UAE: '阿联酋', Argentina: '阿根廷', France: '法国', Germany: '德国'
};

// Ergast 字段 -> [中文名, sessionKey, tierKey]
const SESSIONS = [
  ['FirstPractice', '练习赛 1', 'fp1', 'practice'],
  ['SecondPractice', '练习赛 2', 'fp2', 'practice'],
  ['ThirdPractice', '练习赛 3', 'fp3', 'practice'],
  ['SprintQualifying', '冲刺排位赛', 'sprint-quali', 'international'],
  ['SprintShootout', '冲刺排位赛', 'sprint-shootout', 'international'],
  ['Sprint', '冲刺赛', 'sprint', 'international'],
  ['Qualifying', '排位赛', 'quali', 'international']
];

function sessionTime(s) {
  if (!s || !s.date) return null;
  const time = s.time ?? '00:00:00Z';
  return new Date(`${s.date}T${time}`).toISOString();
}

export async function fetchF1() {
  const season = F1_SEASON || String(new Date().getUTCFullYear());
  // 当前赛季没数据（例如休赛期）时，顺带拉下一赛季
  const seasons = [season, String(Number(season) + 1)];
  const { from, to } = windowBounds(WINDOW);
  const out = [];

  for (const s of seasons) {
    const data = await fetchJson(`${BASE}/${s}/races/?format=json&limit=40`);
    const races = data?.MRData?.RaceTable?.Races ?? [];

    for (const r of races) {
      const gp = GP_CN[r.raceName] ?? r.raceName;
      const country = COUNTRY_CN[r.Circuit?.Location?.country] ?? r.Circuit?.Location?.country ?? '';
      const venue = [r.Circuit?.circuitName, r.Circuit?.Location?.locality].filter(Boolean).join(' · ');
      const meta = {
        game: 'f1',
        gameLabel: 'F1',
        league: 'Formula 1',
        leagueSlug: 'f1',
        leagueImage: '',
        region: country,
        tournament: `${r.season} ${gp}`,
        venue,
        teams: [],
        bestOf: null,
        streams: [],
        source: 'jolpica'
      };

      const push = (key, stage, tierKey, isoTime, label) => {
        if (!isoTime || isoTime < from || isoTime > to) return;
        out.push({
          ...meta,
          id: `f1-${r.season}-${r.round}-${key}`,
          stage,
          tierKey,
          sessionKey: key,
          title: `${gp} · ${label}`,
          startTime: isoTime,
          status: new Date(isoTime).getTime() < Date.now() ? 'completed' : 'upcoming'
        });
      };

      for (const [field, label, key, tierKey] of SESSIONS) {
        push(key, label, tierKey, sessionTime(r[field]), label);
      }
      push('race', '正赛', 'international', sessionTime({ date: r.date, time: r.time }), '正赛');
    }
  }

  out.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return out;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('sources/f1.mjs')) {
  const evs = await fetchF1();
  console.log(`F1 抓取到 ${evs.length} 个场次`);
  for (const e of evs.slice(0, 12)) {
    console.log(`  ${e.startTime}  ${e.title}`);
  }
}

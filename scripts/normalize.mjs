// 统一 schema 收口：补齐分类字段、去重、排序

const TIER_LABEL = {
  t1: 'T1',
  t2: 'T2',
  international: '国际大赛',
  regional: '赛区联赛',
  practice: '练习赛'
};

const INTERNATIONAL_LOL = ['worlds', 'msi', 'first_stand', 'ewc_lol'];

function tierOf(e) {
  if (e.tierKey) return [e.tierKey, e.tierLabel || TIER_LABEL[e.tierKey] || '未分类'];
  if (e.game === 'lol') {
    return INTERNATIONAL_LOL.includes(e.leagueSlug)
      ? ['international', '国际大赛']
      : ['regional', '赛区联赛'];
  }
  if (e.game === 'valorant') {
    return /champions|masters|冠军赛|大师赛/i.test(`${e.tournament} ${e.league}`)
      ? ['international', '国际大赛']
      : ['regional', '赛区联赛'];
  }
  if (e.game === 'f1') return ['international', '国际大赛'];
  return ['regional', '赛区联赛'];
}

function regionGroup(e) {
  if (e.game === 'cs2' || e.game === 'f1') return '国际';
  const s = `${e.region ?? ''} ${e.league ?? ''} ${e.tournament ?? ''} ${e.leagueSlug ?? ''}`;
  if (/中国大陆|中国赛区|CN赛区|\bLPL\b|China/i.test(s)) return '中国大陆';
  if (/韩国|LCK|Korea/i.test(s)) return '韩国';
  if (/欧洲|EMEA|Europe/i.test(s)) return '欧洲';
  if (/北美|LCS|North America/i.test(s)) return '北美';
  if (/太平洋|LCP|Pacific/i.test(s)) return '太平洋';
  return '国际';
}

// 有起止区间的赛事（CS2 / 瓦洛兰特）按区间推断状态；有明确状态的（LoL / F1）用接口给的
function statusOf(raw) {
  let st = raw.status === 'live' ? 'live' : raw.status === 'completed' ? 'completed' : 'upcoming';
  const end = raw.endTime ? Date.parse(raw.endTime) : null;
  if (end && st === 'upcoming') {
    const now = Date.now();
    const start = Date.parse(raw.startTime);
    st = now > end ? 'completed' : (now >= start ? 'live' : 'upcoming');
  }
  return st;
}

export function normalize(events) {
  const map = new Map();

  for (const raw of events) {
    if (!raw?.id || !raw?.startTime) continue;
    const [tierKey, tierLabel] = tierOf(raw);
    const item = {
      id: String(raw.id),
      game: raw.game,
      gameLabel: raw.gameLabel,
      league: raw.league || raw.gameLabel,
      leagueSlug: raw.leagueSlug || '',
      leagueImage: raw.leagueImage || '',
      region: raw.region || '',
      regionGroup: regionGroup(raw),
      tournament: raw.tournament || '',
      stage: raw.stage || '',
      title: raw.title || '',
      teams: (raw.teams ?? []).map((t) => ({
        name: t.name ?? 'TBD',
        code: t.code ?? '',
        logo: t.logo ?? '',
        score: t.score ?? null
      })),
      bestOf: raw.bestOf ?? null,
      startTime: raw.startTime,
      endTime: raw.endTime || null,
      status: statusOf(raw),
      tierKey,
      tierLabel,
      venue: raw.venue || '',
      prize: raw.prize || '',
      streams: (raw.streams ?? []).filter((s) => s && s.url),
      matches: (raw.matches ?? []).map((m) => ({
        id: m.id,
        time: m.time,
        bo: m.bo ?? null,
        stage: m.stage || '',
        t1: { name: m.t1?.name || '', logo: m.t1?.logo || '', score: m.t1?.score ?? '' },
        t2: { name: m.t2?.name || '', logo: m.t2?.logo || '', score: m.t2?.score ?? '' },
        status: m.status || 'upcoming'
      })),
      source: raw.source || ''
    };
    // 同一场被多个源抓到时，保留字段更全的那条
    const prev = map.get(item.id);
    if (!prev || (prev.teams?.length ?? 0) < (item.teams?.length ?? 0)) map.set(item.id, item);
  }

  return [...map.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

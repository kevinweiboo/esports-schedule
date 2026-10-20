// 统一 schema 收口：补齐分类字段、去重、排序

const TIER_LABEL = {
  t1: 'T1',
  t2: 'T2',
  international: '国际大赛',
  regional: '赛区联赛',
  practice: '练习赛'
};

const INTERNATIONAL_LOL = ['worlds', 'msi', 'first_stand', 'ewc_lol'];

// Riot 的队徽是 http://static.lolesports.com/...，HTTPS 页面会按混合内容拦掉
function secureUrl(u) {
  if (typeof u !== 'string') return '';
  return u.slice(0, 7).toLowerCase() === 'http://' ? 'https://' + u.slice(7) : u;
}

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

// 状态统一按「开始时间 + 结束时间/时长」判断。
// 接口给的状态只在两种情况下优先：已结束、进行中；「未开始」可能是滞后的，
// 所以到点后要由本地时间接管（F1 之前就是在这里把正赛误判成已结束）。
function statusOf(raw) {
  if (raw.status === 'completed') return 'completed';
  if (raw.status === 'live') return 'live';

  const start = Date.parse(raw.startTime);
  const end = raw.endTime
    ? Date.parse(raw.endTime)
    : (raw.durationMin ? start + Number(raw.durationMin) * 60000 : null);
  if (!end) return 'upcoming';

  const now = Date.now();
  if (now > end) return 'completed';
  if (now >= start) return 'live';
  return 'upcoming';
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
      leagueImage: secureUrl(raw.leagueImage),
      region: raw.region || '',
      regionGroup: regionGroup(raw),
      tournament: raw.tournament || '',
      stage: raw.stage || '',
      title: raw.title || '',
      teams: (raw.teams ?? []).map((t) => ({
        name: t.name ?? 'TBD',
        code: t.code ?? '',
        logo: secureUrl(t.logo),
        score: t.score ?? null
      })),
      bestOf: raw.bestOf ?? null,
      startTime: raw.startTime,
      endTime: raw.endTime || null,
      durationMin: raw.durationMin ?? null,
      round: raw.round ?? null,
      season: raw.season ?? null,
      sessionKey: raw.sessionKey || '',
      status: statusOf(raw),
      tierKey,
      tierLabel,
      venue: raw.venue || '',
      prize: raw.prize || '',
      streams: (raw.streams ?? []).filter((s) => s && s.url),
      matches: (raw.matches ?? []).map((m) => {
        const t1 = { name: m.t1?.name || '', logo: m.t1?.logo || '', score: m.t1?.score ?? '' };
        const t2 = { name: m.t2?.name || '', logo: m.t2?.logo || '', score: m.t2?.score ?? '' };
        const tbd = !t1.name || !t2.name || t1.name === 'TBD' || t2.name === 'TBD';
        const maps = (Array.isArray(m.maps) ? m.maps : [])
          .filter((b) => b && b.name)
          .map((b) => ({
            name: String(b.name),
            t1: b.t1 ?? '',
            t2: b.t2 ?? '',
            result: b.result || '',
            status: Number(b.status) || 0
          }));
        const prob1 = m.prob1 != null && m.prob1 !== '' && Number.isFinite(Number(m.prob1)) ? Number(m.prob1) : null;
        const prob2 = m.prob2 != null && m.prob2 !== '' && Number.isFinite(Number(m.prob2)) ? Number(m.prob2) : null;
        return {
          id: m.id,
          time: m.time,
          bo: m.bo ?? null,
          stage: m.stage || '',
          t1,
          t2,
          tbd,
          maps,
          prob1,
          prob2,
          sourceUrl: m.sourceUrl || '',
          status: m.status || 'upcoming'
        };
      }),
      source: raw.source || ''
    };
    // 同一场被多个源抓到时，保留字段更全的那条
    const prev = map.get(item.id);
    if (!prev || (prev.teams?.length ?? 0) < (item.teams?.length ?? 0)) map.set(item.id, item);
  }

  return [...map.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

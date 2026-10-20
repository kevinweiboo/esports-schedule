/* 综合赛程 · 前端
   零构建：经典 script + 原生 DOM，file:// 与静态托管都能跑。
   数据来自 data/schedule.js 暴露的 window.__SCHEDULE__。 */
(function () {
  'use strict';

  var RAW = window.__SCHEDULE__ || { meta: null, events: [] };
  var DEFAULT_TZ = 'Asia/Shanghai';
  var TZ_ALLOWED = ['Asia/Shanghai', 'UTC', 'local'];
  var STORE_FOLLOWS = 'esports.follows.v1';
  var STORE_BANNER = 'esports.banner.v1';
  // Riot 的社区公开 key，与 scripts/config.mjs 里的默认值一致；仅用于 getLive
  var RIOT_LIVE_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
  var TIER_ORDER = ['Major', 'S+', 'S级', '国际大赛', '大师赛', '冠军赛', 'VCT 国际', 'VCT CN', '赛区联赛', '练习赛'];

  var GAMES = {
    lol: { label: '英雄联盟', color: 'var(--lol)' },
    valorant: { label: '瓦洛兰特', color: 'var(--val)' },
    cs2: { label: 'CS2', color: 'var(--cs2)' },
    f1: { label: 'F1', color: 'var(--f1)' }
  };
  var GAME_KEYS = ['lol', 'valorant', 'cs2', 'f1'];

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uniq(arr) { return arr.filter(function (v, i) { return v && arr.indexOf(v) === i; }); }

  /* ---------------- 时间 ---------------- */
  var F = {};
  function buildFormatters() {
    var tz = state.tz === 'local' ? undefined : state.tz;
    function mk(opts) { return new Intl.DateTimeFormat('en-CA', Object.assign({ timeZone: tz }, opts)); }
    F.day = mk({ year: 'numeric', month: '2-digit', day: '2-digit' });
    F.hm = mk({ hour: '2-digit', minute: '2-digit', hour12: false });
    F.md = mk({ month: '2-digit', day: '2-digit' });
    F.wd = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, weekday: 'short' });
    F.full = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  }
  function dayKey(iso) { return F.day.format(new Date(iso)); }
  function hm(iso) { return F.hm.format(new Date(iso)); }
  function md(iso) { var p = dayKey(iso).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function weekday(iso) { return F.wd.format(new Date(iso)); }
  function todayKey() { return dayKey(new Date()); }
  function addDays(key, n) {
    var d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return dayKey(d.toISOString());
  }
  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  function fullDay(key) {
    var p = key.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }
  function rel(iso) {
    var ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return '已开赛';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return d + ' 天后';
    if (h > 0) return h + ' 小时 ' + (m % 60) + ' 分后';
    if (m > 0) return m + ' 分钟后';
    return '即将开始';
  }
  function elapsed(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '即将开始';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    if (h > 0) return '已进行 ' + h + ' 小时 ' + (m % 60) + ' 分';
    if (m > 0) return '已进行 ' + m + ' 分钟';
    return '刚开始';
  }
  function ageText(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return '刚刚更新';
    if (m < 60) return m + ' 分钟前';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.round(h / 24) + ' 天前';
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    view: 'upcoming',
    game: 'all',
    q: '',
    day: '',
    weekOffset: 0,
    region: '',
    tiers: null,
    tiersOff: null,
    showPractice: true,
    showTbd: true,
    tz: DEFAULT_TZ,
    eventKey: '',
    eventLabel: '',
    open: {},
    tbdOpen: {},
    follows: [],
    bannerDismissed: false
  };

  var LIVE = {
    timer: null,
    inFlight: false,
    lastAt: 0,
    liveCount: 0,
    active: false,
    error: false,
    skip: { cs2: 0, lol: 0 },
    seen: {}
  };

  function loadFollows() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_FOLLOWS) || '[]');
      if (!Array.isArray(v)) return [];
      return v.filter(function (x) { return typeof x === 'string' && x && x.length < 40; }).slice(0, 30);
    } catch (e) { return []; }
  }
  function saveFollows() {
    try { localStorage.setItem(STORE_FOLLOWS, JSON.stringify(state.follows)); } catch (e) { /* 忽略 */ }
  }
  state.follows = loadFollows();

  /* ---------------- 建模 ---------------- */
  var ENTRIES = [];

  function cleanGP(s) {
    return String(s || '').replace(/^\d{4}\s*/, '').replace(/\s*·\s*[^·]*$/, '').trim();
  }
  function durationOf(raw, game) {
    if (raw != null) return Number(raw);
    return game === 'lol' ? 240 : 0;
  }
  function endMsOf(x) {
    if (x.end) return Date.parse(x.end);
    if (x.kind === 'f1') return Date.parse(x.sessions[x.sessions.length - 1].startTime)
      + durationOf(x.sessions[x.sessions.length - 1].durationMin, 'f1') * 60000;
    return Date.parse(x.start) + durationOf(x.durationMin, x.game) * 60000;
  }
  function statusOf(x) {
    if (x.status === 'completed') return 'completed';
    if (x.status === 'live') return 'live';
    var now = Date.now(), s = Date.parse(x.start), e = endMsOf(x);
    if (now > e) return 'completed';
    if (now >= s) return 'live';
    return 'upcoming';
  }
  function buildEntries() {
    var ev = RAW.events || [];
    var out = [];
    var f1map = {};

    ev.forEach(function (e) {
      if (e.game !== 'f1') return;
      var key = e.round ? e.season + '-' + e.round : (e.tournament || e.title);
      (f1map[key] = f1map[key] || []).push(e);
    });

    Object.keys(f1map).forEach(function (k) {
      var ss = f1map[k].sort(function (a, b) { return a.startTime.localeCompare(b.startTime); });
      var first = ss[0], last = ss[ss.length - 1];
      var lastEnd = Date.parse(last.startTime) + durationOf(last.durationMin, 'f1') * 60000;
      out.push({
        id: 'f1:' + k, kind: 'f1', game: 'f1', league: 'Formula 1',
        title: cleanGP(first.tournament) || cleanGP(first.title),
        round: first.round, season: first.season,
        region: '国际', regionGroup: '国际',
        tier: '国际大赛', tierLabel: '国际大赛',
        venue: first.venue || '', prize: '',
        start: first.startTime, end: new Date(lastEnd).toISOString(),
        sessions: ss, matches: [], status: '',
        durationMin: null
      });
    });

    ev.forEach(function (e) {
      if (e.game === 'f1') return;
      var span = e.endTime ? Date.parse(e.endTime) - Date.parse(e.startTime) : 0;
      var isTour = span > 36 * 3600 * 1000;
      out.push({
        id: e.id,
        kind: isTour ? 'tournament' : 'fixture',
        game: e.game,
        league: e.league || (GAMES[e.game] || {}).label || e.game,
        title: e.title || e.tournament || '',
        stage: e.stage || '',
        tier: e.tierLabel || '',
        tierLabel: e.tierLabel || '',
        region: e.region || '',
        regionGroup: e.regionGroup || '国际',
        venue: e.venue || '',
        prize: e.prize || '',
        start: e.startTime,
        end: isTour ? (e.endTime || e.startTime) : (e.endTime || null),
        durationMin: e.durationMin != null ? e.durationMin : durationOf(null, e.game),
        teams: e.teams || [],
        bestOf: e.bestOf || null,
        matches: e.matches || [],
        streams: e.streams || [],
        status: e.status || ''
      });
    });

    out.forEach(function (x) {
      x._hay = [
        x.title, x.league, x.stage, x.venue, x.region, x.regionGroup, x.tier,
        (x.teams || []).map(function (t) { return t.name + ' ' + (t.code || ''); }).join(' '),
        (x.matches || []).map(function (m) { return (m.t1 && m.t1.name) + ' ' + (m.t2 && m.t2.name) + ' ' + (m.stage || ''); }).join(' '),
        (x.sessions || []).map(function (s) { return s.stage; }).join(' ')
      ].join(' ').toLowerCase();
    });

    out.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return out;
  }

  function anchorDay(x) {
    return state.view === 'results' ? dayKey(x.end || x.start) : dayKey(x.start);
  }
  // 「赛事筛选」的键：跨天赛事按赛事，单场按联赛（LoL 的 Worlds、LPL 等）
  function eventKeyOf(x) {
    if (x.kind === 'fixture') return 'league:' + x.game + ':' + (x.league || '');
    return 'event:' + x.id;
  }
  function eventLabelOf(x) {
    if (x.kind === 'fixture') return x.league || x.title;
    return x.title;
  }
  function resolveEventLabel() {
    if (!state.eventKey) { state.eventLabel = ''; return; }
    var hit = null;
    for (var i = 0; i < ENTRIES.length; i++) {
      if (eventKeyOf(ENTRIES[i]) === state.eventKey) { hit = ENTRIES[i]; break; }
    }
    state.eventLabel = hit ? eventLabelOf(hit) : '';
    if (!hit) state.eventKey = '';
  }
  function sessionsOn(x, key) {
    return (x.sessions || []).filter(function (s) {
      return dayKey(s.startTime) === key && (state.showPractice || !/练习赛/.test(s.stage));
    });
  }
  function matchesOn(x, key) {
    return (x.matches || []).filter(function (m) { return m.time && dayKey(m.time) === key; });
  }
  function isTbdFixture(x) {
    var ts = x.teams || [];
    return x.kind === 'fixture' && ts.length >= 2 && ts.every(function (t) {
      return !t.name || t.name === 'TBD';
    });
  }
  function searchHit(x, q) {
    return !q || x._hay.indexOf(q) >= 0;
  }
  // 只看项目/赛区/级别/搜索，不掺「赛程 or 赛果」；侧栏与日历导出都要用它
  function passBase(x, q, opts) {
    opts = opts || {};
    if (!opts.ignoreGame && state.game !== 'all' && x.game !== state.game) return false;
    if (state.region && x.regionGroup !== state.region) return false;
    if (state.tiers && x.tier && state.tiers[x.tier] === false) return false;
    if (state.eventKey && eventKeyOf(x) !== state.eventKey) return false;
    return searchHit(x, q);
  }
  function pass(x, q, opts) {
    if (!passBase(x, q, opts)) return false;
    var st = statusOf(x);
    if (state.view === 'upcoming' && st === 'completed') return false;
    if (state.view === 'results' && st !== 'completed') return false;
    return true;
  }
  function nextUpcoming(afterKey) {
    var q = state.q.trim().toLowerCase();
    for (var i = 0; i < ENTRIES.length; i++) {
      var x = ENTRIES[i];
      if (!passBase(x, q)) continue;
      if (afterKey && dayKey(x.start) <= afterKey) continue;
      if (statusOf(x) === 'completed') continue;
      return x;
    }
    return null;
  }
  function nextEntry(afterKey) { return nextUpcoming(afterKey); }

  /* ---------------- 片段 ---------------- */
  function starHtml(name) {
    if (!name || name === 'TBD' || name === '待定') return '';
    return state.follows.indexOf(name) >= 0 ? '<span class="star" aria-hidden="true">★</span>' : '';
  }
  function teamButton(name, inner, cls) {
    if (!name) return '<span class="' + cls + '">' + inner + '</span>';
    var on = state.follows.indexOf(name) >= 0;
    return '<button type="button" class="' + cls + '" data-follow="' + esc(name) + '"'
      + ' aria-pressed="' + on + '" aria-label="' + (on ? '取消关注 ' : '关注 ') + esc(name) + '"'
      + ' title="' + (on ? '取消关注 ' : '关注 ') + esc(name) + '">' + inner + '</button>';
  }
  function safeUrl(u) {
    if (typeof u !== 'string') return '';
  return u.slice(0, 7).toLowerCase() === 'http://' ? 'https://' + u.slice(7) : u;
  }
  function logoHtml(t) {
    var ch = (t.code || t.name || '?').slice(0, 2).toUpperCase();
    if (!t.logo) return '<span class="ph">' + esc(ch) + '</span>';
    return '<img src="' + esc(safeUrl(t.logo)) + '" alt="" loading="lazy" data-ph="' + esc(ch) + '">';
  }
  function teamHtml(t, other, side) {
    var cls = '';
    if (t.score != null && t.score !== '' && other && other.score != null && other.score !== '') {
      var a = Number(t.score), b = Number(other.score);
      if (!isNaN(a) && !isNaN(b)) cls = a > b ? ' win' : (a < b ? ' lose' : '');
    }
    var name = t.code || t.name || 'TBD';
    var body = logoHtml(t) + '<span class="nm">' + esc(name) + '</span>' + starHtml(name);
    return teamButton(name, body, 'team ' + (side || '') + cls);
  }
  function scoreHtml(a, b, has, id) {
    var attr = id ? ' data-score-id="' + esc(id) + '"' : '';
    if (!has) return '<span class="score vs"' + attr + '>VS</span>';
    return '<span class="score"' + attr + '>' + esc(a) + ' : ' + esc(b) + '</span>';
  }

  function evTitle(x, text) {
    return '<button type="button" class="evlink" data-event-filter="' + esc(eventKeyOf(x))
      + '" data-event-label="' + esc(eventLabelOf(x)) + '" title="只看这个赛事">'
      + esc(text == null ? x.title : text) + '</button>';
  }

  function fixtureRow(x) {
    var st = statusOf(x);
    var teams = x.teams || [];
    var hasScore = (st === 'live' || st === 'completed') && teams.length === 2
      && teams[0].score != null && teams[0].score !== ''
      && teams[1].score != null && teams[1].score !== '';
    var mid;
    if (teams.length >= 2) {
      mid = '<div class="matchup">' + teamHtml(teams[0], teams[1], 'a')
        + scoreHtml(teams[0].score, teams[1].score, hasScore, x.id)
        + teamHtml(teams[1], teams[0], '') + '</div>';
    } else {
      mid = '<div class="title">' + esc(x.title || x.stage || '') + '</div>';
    }
    var time;
    if (st === 'live') time = '<b>' + hm(x.start) + '</b><span class="live"><i class="pulse"></i>进行中</span>';
    else if (st === 'completed') time = '<b>' + hm(x.start) + '</b><span class="s">已结束</span>';
    else {
      var soon = Date.parse(x.start) - Date.now() < 6 * 3600 * 1000;
      time = '<b>' + hm(x.start) + '</b><span class="s' + (soon ? ' soon' : '') + '">' + (soon ? rel(x.start) : '未开始') + '</span>';
    }

    var meta = '<span class="pill ' + x.game + '">' + esc(GAMES[x.game] ? GAMES[x.game].label : x.league) + '</span>'
      + (x.league && x.league !== (GAMES[x.game] || {}).label ? evTitle(x, x.league) : '')
      + (x.stage ? '<i class="sep"></i><span class="tier">' + esc(x.stage) + '</span>' : '');
    var right = '';
    if (x.bestOf) right += '<span class="bo">BO' + x.bestOf + '</span>';
    if (st === 'live') right += '<span class="action">直播</span>';
    return '<div class="row' + (st === 'live' ? ' live' : '') + '" style="--gc:' + (GAMES[x.game] || {}).color + '" data-key="' + esc(x.id) + '@' + dayKey(x.start) + '" data-live-row="' + esc(x.id) + '">'
      + '<div class="t">' + time + '</div>'
      + '<div class="m"><div class="meta">' + meta + '</div>' + mid + '</div>'
      + '<div class="right">' + right + '</div>'
      + '</div>';
  }

  function chevSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  }

  function finalWinner(x) {
    var ms = (x.matches || []).filter(function (m) {
      return m.status === 'completed' && !m.tbd && /决赛|Final/i.test(m.stage || '');
    });
    if (!ms.length) return '';
    var m = ms[ms.length - 1];
    var a = Number(m.t1.score), b = Number(m.t2.score);
    if (isNaN(a) || isNaN(b) || a === b) return '';
    return a > b ? m.t1.name : m.t2.name;
  }

  function eventRow(x, key) {
    var st = statusOf(x);
    var isStart = dayKey(x.start) === key;
    var liveMatch = (x.matches || []).some(function (m) { return m.status === 'live'; });
    var totalDays = Math.max(1, dayDiff(dayKey(x.start), dayKey(x.end || x.start)) + 1);
    var dayNo = dayDiff(dayKey(x.start), key) + 1;
    var gc = (GAMES[x.game] || {}).color;
    var openKey = x.id + '@' + key;
    var open = !!state.open[openKey];
    var time, meta, title, sub, right;

    if (x.kind === 'f1') {
      var today = sessionsOn(x, key);
      var first = today[0];
      time = '<b>' + (first ? hm(first.startTime) : (isStart ? hm(x.start) : '—')) + '</b>'
        + '<span class="s">' + (isStart ? '第 1 天' : '第 ' + dayNo + '/' + totalDays + ' 天') + '</span>';
      meta = '<span class="pill f1">F1</span><span>' + esc(x.league) + '</span>'
        + (x.round ? '<i class="sep"></i><span class="tier">第 ' + x.round + ' 站</span>' : '');
      title = '<div class="title">' + evTitle(x)
        + (isStart ? ' <span class="tag f1-tag">本周末</span>' : '') + '</div>';
      sub = '<div class="sub">'
        + (today.length
          ? '<b>今日 ' + today.length + ' 场</b>' + today.map(function (s) {
            return '<span>' + esc(s.stage) + ' ' + hm(s.startTime) + '</span>';
          }).join('<i class="sep"></i>')
          : '<span>今日无场次</span>')
        + '</div>';
      right = '<span class="bo">' + x.sessions.length + ' 个场次</span>'
        + '<button type="button" class="chev" data-toggle="' + esc(x.id) + '@' + key + '" aria-expanded="' + open + '" aria-label="' + (open ? '收起场次' : '展开场次') + '">' + chevSvg() + '</button>';
    } else {
      var total = (x.matches || []).length;
      var winner = state.view === 'results' ? finalWinner(x) : '';
      if (state.view === 'results') {
        time = '<b>' + md(x.end || x.start) + '</b><span class="s">'
          + (x.end && dayKey(x.end) !== dayKey(x.start) ? md(x.start) + ' 起' : '已结束') + '</span>';
      } else {
        time = isStart
          ? '<b>' + md(x.start) + '</b><span class="s">至 ' + md(x.end) + '</span>'
          : '<b>第 ' + dayNo + ' 天</b><span class="s">共 ' + totalDays + ' 天</span>';
      }
      meta = '<span class="pill ' + x.game + '">' + esc((GAMES[x.game] || {}).label || x.league) + '</span>'
        + (x.league && x.league !== (GAMES[x.game] || {}).label ? '<span>' + esc(x.league) + '</span>' : '')
        + (x.tier && x.tier !== x.league ? '<i class="sep"></i><span class="tier">' + esc(x.tier) + '</span>' : '');
      title = '<div class="title">' + evTitle(x)
        + (liveMatch ? ' <span class="tag live-tag">LIVE</span>'
          : (st === 'live' && isStart ? ' <span class="tag live-tag">进行中</span>' : '')) + '</div>';
      sub = '<div class="sub">'
        + (state.view === 'results' ? '<b>共 ' + totalDays + ' 天</b>' : (isStart ? '<b>' + totalDays + ' 天</b>' : '<b>第 ' + dayNo + '/' + totalDays + ' 天</b>'))
        + (total ? '<i class="sep"></i><span>' + total + ' 场对局</span>' : '')
        + (matchesOn(x, key).length ? '<i class="sep"></i><span>' + (state.view === 'results' ? '收官' : '今日') + ' ' + matchesOn(x, key).length + ' 场</span>' : '')
        + (winner ? '<i class="sep"></i><b>冠军 ' + esc(winner) + '</b>' : '')
        + (x.venue ? '<i class="sep"></i><span>' + esc(x.venue) + '</span>' : '')
        + '</div>';
      right = (x.prize ? '<span class="bo">' + esc(x.prize) + '</span>' : '')
        + (total ? '<button type="button" class="chev" data-toggle="' + esc(x.id) + '@' + key + '" aria-expanded="' + open + '" aria-label="' + (open ? '收起对局' : '展开对局') + '">' + chevSvg() + '</button>' : '');
    }

    var clickable = x.kind === 'f1' || (x.matches || []).length > 0;
    return '<div class="row' + (clickable ? ' clickable' : '') + (open ? ' open' : '') + ((st === 'live' || liveMatch) ? ' live' : '') + '"'
      + ' style="--gc:' + gc + '" data-key="' + esc(openKey) + '">'
      + '<div class="t">' + time + '</div>'
      + '<div class="m"><div class="meta">' + meta + '</div>' + title + sub + '</div>'
      + '<div class="right">' + right + '</div>'
      + (open ? expansion(x, key) : '')
      + '</div>';
  }

  function expansion(x, key) {
    if (x.kind === 'f1') return '<div class="panel">' + f1Sessions(x) + '</div>';
    return '<div class="panel">' + matchList(x, key) + '</div>';
  }

  function f1Sessions(x) {
    var html = '', last = '';
    x.sessions.forEach(function (s) {
      if (!state.showPractice && /练习赛/.test(s.stage)) return;
      var k = dayKey(s.startTime);
      if (k !== last) {
        html += '<div class="pgroup"><div class="pgh"><b>' + md(s.startTime) + ' ' + weekday(s.startTime) + '</b><span class="ln"></span></div>';
        last = k;
      }
      var st = statusOf({ kind: 'fixture', game: 'f1', start: s.startTime, durationMin: s.durationMin, status: s.status });
      html += '<div class="sess' + (/练习赛/.test(s.stage) ? ' dim' : '') + '">'
        + '<div class="st">' + hm(s.startTime) + '</div>'
        + '<div><div class="sn">' + esc(s.stage) + '</div><div class="ss">' + esc(x.venue || '') + '</div></div>'
        + '<div>' + (st === 'live' ? '<span class="is-live">进行中</span>' : '<span class="ss">' + (st === 'completed' ? '已结束' : '') + '</span>') + '</div>'
        + '</div>';
    });
    return html || '<div class="empty" style="padding:20px">暂无场次</div>';
  }

  function matchDetailHtml(m) {
    var parts = [];

    var maps = (m.maps || []).filter(function (b) {
      return b && b.name && (b.t1 !== '' || b.t2 !== '');
    });
    if (maps.length) {
      parts.push('<span class="maps">' + maps.map(function (b) {
        var a = b.result === 't1' ? ' class="w"' : '';
        var c = b.result === 't2' ? ' class="w"' : '';
        return '<span class="mapchip' + (b.status === 1 ? ' live' : '') + '">'
          + '<i>' + esc(b.name) + '</i>'
          + '<b' + a + '>' + esc(b.t1 || '–') + '</b><s>:</s><b' + c + '>' + esc(b.t2 || '–') + '</b></span>';
      }).join('') + '</span>');
    }

    var p1 = Number(m.prob1), p2 = Number(m.prob2);
    if (m.prob1 != null && m.prob2 != null && isFinite(p1) && isFinite(p2) && p1 + p2 > 0) {
      var left = p1 / (p1 + p2) * 100;
      var l = Math.round(left), r = 100 - l;
      var fav = p1 >= p2;
      parts.push('<span class="mprob" title="胜率参考，数据来源 5EPlay（赔率换算）" aria-label="胜率 '
        + Math.round(left) + '% 对 ' + Math.round(100 - left) + '%">'
        + '<span class="plabel">胜率</span>'
        + '<span class="bar"><i class="' + (fav ? 'fav' : '') + '" style="width:' + left.toFixed(1) + '%"></i>'
        + '<i class="' + (fav ? '' : 'fav') + '" style="width:' + (100 - left).toFixed(1) + '%"></i></span>'
        + '<em>' + l + '%</em><span class="ps">/</span><em>' + r + '%</em></span>');
    }

    if (m.sourceUrl) {
      parts.push('<a class="mdata" href="' + esc(m.sourceUrl) + '" target="_blank" rel="noopener noreferrer"'
        + ' aria-label="在 5EPlay 查看这场比赛的详细数据">数据 ↗</a>');
    }
    return parts.length ? '<div class="mdetail" data-detail="' + esc(m.id) + '">' + parts.join('') + '</div>' : '';
  }

  function matchList(x, key) {
    var ms = (x.matches || []).slice();
    if (!ms.length) return '<div class="empty" style="padding:20px">暂无对阵明细</div>';
    function isTbd(m) { return m.tbd || !m.t1.name || !m.t2.name || m.t1.name === 'TBD' || m.t2.name === 'TBD'; }
    var known = ms.filter(function (m) { return !isTbd(m); }).sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    var tbd = ms.filter(isTbd).sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
    var html = '', last = '';

    known.forEach(function (m) {
      var k = dayKey(m.time);
      if (k !== last) {
        html += '<div class="pgh" style="margin-top:8px"><b>' + md(m.time) + ' ' + weekday(m.time) + '</b>'
          + '<span class="ln"></span><span>' + known.filter(function (y) { return dayKey(y.time) === k; }).length + ' 场</span></div>';
        last = k;
      }
      var live = m.status === 'live';
      var has = (m.status === 'completed' || live) && m.t1.score !== '' && m.t2.score !== ''
        && m.t1.score != null && m.t2.score != null;
      var a = Number(m.t1.score), b = Number(m.t2.score);
      var c1 = has && !isNaN(a) && !isNaN(b) ? (a > b ? ' mteam-win' : (a < b ? ' mteam-lose' : '')) : '';
      var c2 = has && !isNaN(a) && !isNaN(b) ? (b > a ? ' mteam-win' : (b < a ? ' mteam-lose' : '')) : '';
      html += '<div class="mrow' + (live ? ' live' : '') + '" data-mid="' + esc(m.id) + '">'
        + '<div class="mt">' + (live ? '<i class="ldot"></i>' : '') + hm(m.time) + '</div>'
        + teamButton(m.t1.name, logoHtml(m.t1) + '<span>' + esc(m.t1.name) + '</span>' + starHtml(m.t1.name), 'mte a' + c1)
        + '<div class="msc' + (has ? '' : ' ns') + (live ? ' live' : '') + '" data-mscore>' + (has ? esc(m.t1.score) + ' : ' + esc(m.t2.score) : (live ? 'LIVE' : 'vs')) + '</div>'
        + teamButton(m.t2.name, '<span>' + esc(m.t2.name) + '</span>' + logoHtml(m.t2) + starHtml(m.t2.name), 'mte' + c2)
        + '<div class="mst">' + esc(m.stage || '') + (m.bo ? ' · BO' + m.bo : '') + '</div>'
        + matchDetailHtml(m)
        + '</div>';
    });

    if (tbd.length && state.showTbd) {
      var open = !!state.tbdOpen[x.id + '@' + key];
      html += '<div class="tbdbar"><span><b>另有 ' + tbd.length + ' 场待定对阵</b> · 对手要等上一轮结束才确定</span>'
        + '<button type="button" data-tbd="' + esc(x.id) + '@' + key + '">' + (open ? '收起' : '查看时间') + '</button></div>';
      if (open) {
        html += tbd.slice(0, 80).map(function (m) {
          if (!m.time) return '';
          return '<div class="mrow" style="opacity:.55">'
            + '<div class="mt">' + md(m.time) + ' ' + hm(m.time) + '</div>'
            + '<div class="mte a tbd"><span>待定</span></div>'
            + '<div class="msc ns">vs</div>'
            + '<div class="mte tbd"><span>待定</span></div>'
            + '<div class="mst">' + esc(m.stage || '') + (m.bo ? ' · BO' + m.bo : '') + '</div></div>';
        }).join('');
      }
    }
    return html;
  }

  /* ---------------- 议程 ---------------- */
  function countForDay(key, q, game) {
    var n = 0;
    var ignoreGame = game != null;
    ENTRIES.forEach(function (x) {
      if (!pass(x, q, { ignoreGame: ignoreGame })) return;
      if (game && game !== 'all' && x.game !== game) return;
      if (state.view === 'results') {
        if (anchorDay(x) === key) n += 1;
        return;
      }
      if (x.kind === 'f1') {
        var s = sessionsOn(x, key).length;
        n += s || (dayKey(x.start) === key ? 1 : 0);
      } else if (x.kind === 'tournament') {
        var m = matchesOn(x, key).length;
        n += m || (dayKey(x.start) === key ? 1 : 0);
      } else if (dayKey(x.start) === key) {
        n += 1;
      }
    });
    return n;
  }

  function dayEntries(key, q) {
    var starters = [], ongoing = [], tbd = [];
    ENTRIES.forEach(function (x) {
      if (!pass(x, q)) return;
      if (state.view === 'results') {
        if (anchorDay(x) === key) starters.push(x);
        return;
      }
      var s = dayKey(x.start), e = dayKey(x.end || x.start);
      if (x.kind === 'fixture') {
        if (s !== key) return;
        if (isTbdFixture(x)) tbd.push(x); else starters.push(x);
        return;
      }
      if (s > key || e < key) return;
      if (s === key) starters.push(x);
      else if (x.kind === 'f1' ? sessionsOn(x, key).length : true) ongoing.push(x);
    });
    starters.sort(function (a, b) { return a.start.localeCompare(b.start); });
    ongoing.sort(function (a, b) { return a.start.localeCompare(b.start); });
    tbd.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return { starters: starters, ongoing: ongoing, tbd: tbd };
  }

  function weekStart() {
    var t = todayKey();
    if (state.view === 'results') return addDays(t, state.weekOffset * 7 - 6);
    return addDays(t, state.weekOffset * 7);
  }
  function weekKeys() {
    var s = weekStart(), out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(s, i));
    return out;
  }

  function dayBlock(key, d, q) {
    var tk = todayKey();
    var n = countForDay(key, q);
    var y = addDays(tk, -1), tmr = addDays(tk, 1);
    var label = key === tk ? '今天' : (key === tmr ? '明天' : (key === y ? '昨天' : fullDay(key)));
    var sub = (key === tk || key === tmr || key === y) ? (fullDay(key) + ' ' + weekday(key + 'T12:00:00Z')) : weekday(key + 'T12:00:00Z');
    var html = '<div class="dayhead' + (key === tk ? ' today' : '') + '" id="d-' + key + '">'
      + '<h2>' + esc(label) + '</h2><span class="wd2">' + esc(sub) + '</span><span class="n">' + n + (state.view === 'results' ? ' 项' : ' 场') + '</span></div>';

    if (!d.starters.length && !d.ongoing.length && !(d.tbd && d.tbd.length)) {
      return html + '<div class="list"><div class="empty" style="padding:24px">这天没有'
        + (state.eventKey ? '该赛事' : '安排比赛') + '</div></div>';
    }
    html += '<div class="list">';
    d.ongoing.forEach(function (x) { html += eventRow(x, key); });
    d.starters.forEach(function (x) {
      html += x.kind === 'fixture' ? fixtureRow(x) : eventRow(x, key);
    });
    if (d.tbd && d.tbd.length) {
      var tk2 = 'tbd@' + key;
      var open2 = !!state.tbdOpen[tk2];
      html += '<div class="tbdbar"><span><b>另有 ' + d.tbd.length + ' 场待定对阵</b> · 时间已定，队伍待定</span>'
        + '<button type="button" data-tbd="' + esc(tk2) + '">' + (open2 ? '收起' : '查看场次') + '</button></div>';
      if (open2) {
        html += d.tbd.map(function (x) {
          return '<div class="row tbdrow" style="--gc:' + (GAMES[x.game] || {}).color + '">'
            + '<div class="t"><b>' + hm(x.start) + '</b><span class="s">待定</span></div>'
            + '<div class="m"><div class="meta"><span class="pill ' + x.game + '">' + esc((GAMES[x.game] || {}).label || x.league) + '</span>'
            + '<span>' + esc(x.league) + '</span>' + (x.stage ? '<i class="sep"></i><span class="tier">' + esc(x.stage) + '</span>' : '') + '</div>'
            + '<div class="title" style="color:var(--tx-3);font-weight:500">待定对阵</div>'
            + '<div class="sub">' + (x.bestOf ? 'BO' + x.bestOf + ' · ' : '') + '队伍待上一轮结束后确定</div></div>'
            + '<div class="right"></div></div>';
        }).join('');
      }
    }
    html += '</div>';
    return html;
  }

  function gapBand(from, to, q) {
    var next = nextEntry(addDays(to, -1));
    var n = dayDiff(from, to);
    var label = n <= 1 ? md(from + 'T12:00:00Z') : md(from + 'T12:00:00Z') + ' – ' + md(addDays(to, -1) + 'T12:00:00Z');
    return '<div class="gap"><span>' + label + '</span><span class="arrow">→</span><b>' + n + ' 天没有'
      + (state.eventKey ? '该赛事' : '比赛') + '</b>'
      + (next ? '<span class="arrow">·</span><span>下一场 ' + md(next.start) + ' ' + hm(next.start) + ' ' + esc(next.title) + '</span>'
        + '<button type="button" class="jump" data-jump="' + dayKey(next.start) + '">跳到</button>' : '')
      + '</div>';
  }

  function renderAgenda() {
    var q = state.q.trim().toLowerCase();
    var el = $('#agenda');
    if (!ENTRIES.length) {
      el.innerHTML = '<div class="empty"><b>还没有数据</b>赛程数据尚未生成，请稍后再试。'
        + (isLocal() ? '<br>本地可运行 <code>node scripts/fetch.mjs</code>。' : '') + '</div>';
      return;
    }

    var keys = weekKeys();
    var html = '';

    if (state.day) {
      var d0 = dayEntries(state.day, q);
      html = dayBlock(state.day, d0, q);
      if (!d0.starters.length && !d0.ongoing.length && !(d0.tbd && d0.tbd.length)) {
        html += '<div class="empty" style="margin-top:12px"><b>这天没有' + (state.eventKey ? '该赛事' : '比赛') + '</b>换个日期，或清除日期筛选。</div>';
      }
      el.innerHTML = html;
      return;
    }

    if (state.view === 'upcoming') {
      var filled = keys.filter(function (k) { return countForDay(k, q) > 0; });
      if (!filled.length) {
        var nx = nextEntry(addDays(keys[6], -1));
        el.innerHTML = '<div class="empty"><b>这一周没有' + (state.eventKey ? '该赛事' : '比赛') + '</b>'
          + (nx ? '下一场：' + md(nx.start) + ' ' + hm(nx.start) + ' · ' + esc(nx.title) : '当前筛选条件下没有更多比赛')
          + '<br><button type="button" class="btn primary" data-jump="' + (nx ? dayKey(nx.start) : '') + '">跳到下一场</button></div>';
        return;
      }
      var leadingTo = null;
      if (filled[0] > keys[0]) { html += gapBand(keys[0], filled[0], q); leadingTo = filled[0]; }
      var run = [];
      keys.forEach(function (k) {
        var n = countForDay(k, q);
        if (!n) { run.push(k); return; }
        if (run.length >= 2) {
          var end = addDays(run[run.length - 1], 1);
          if (!leadingTo || end > leadingTo) html += gapBand(run[0], end, q);
        }
        run = [];
        html += dayBlock(k, dayEntries(k, q), q);
      });
      if (run.length >= 2) html += gapBand(run[0], addDays(run[run.length - 1], 1), q);
      el.innerHTML = html;
    } else {
      var any = false;
      keys.slice().reverse().forEach(function (k) {
        if (!countForDay(k, q)) return;
        any = true;
        html += dayBlock(k, dayEntries(k, q), q);
      });
      el.innerHTML = any ? html : '<div class="empty"><b>这一周没有赛果</b>往前翻一周看看，或切回赛程。</div>';
    }
  }

  /* ---------------- 周条 / 工具条 ---------------- */
  function renderWeek() {
    var keys = weekKeys();
    var q = state.q.trim().toLowerCase();
    var tk = todayKey();
    var html = keys.map(function (k) {
      var n = countForDay(k, q);
      var live = state.view === 'upcoming' && ENTRIES.some(function (x) {
        return passBase(x, q) && statusOf(x) === 'live'
          && (x.kind === 'fixture' ? dayKey(x.start) === k : (dayKey(x.start) <= k && dayKey(x.end) >= k));
      });
      return '<button type="button" class="wd' + (k === tk ? ' today' : '') + (state.day === k ? ' sel' : '') + (live ? ' live' : '') + '" data-day="' + k + '" aria-pressed="' + (state.day === k) + '">'
        + '<span class="w">' + (k === tk ? '今天' : weekday(k + 'T12:00:00Z')) + '</span>'
        + '<b>' + Number(k.slice(8, 10)) + '</b>'
        + '<span class="c' + (n ? ' has' : '') + '">' + (n ? n + (state.view === 'results' ? ' 项' : ' 场') : '—') + '</span></button>';
    }).join('');
    $('#weekGrid').innerHTML = html;

    var s = keys[0], e = keys[6];
    var label = md(s + 'T12:00:00Z') + ' – ' + md(e + 'T12:00:00Z');
    if (state.weekOffset === 0) label += state.view === 'results' ? ' · 最近 7 天' : ' · 本周';
    $('#weekLabel').textContent = label;
    $('#weekToday').disabled = state.weekOffset === 0;
    var btns = $$('[data-week]');
    btns[0].disabled = state.view === 'upcoming' ? state.weekOffset <= 0 : false;
    btns[1].disabled = state.view === 'results' ? state.weekOffset >= 0 : false;
  }

  function renderGames() {
    var q = state.q.trim().toLowerCase();
    // 计数跟当前视图一致：本周（或选中某天）实际会看到的场次数，
    // 而不是「赛事条目数」——否则筛到 PGL 会显示「全部 1」，但下面有 30 场。
    var keys = state.day ? [state.day] : weekKeys();
    function total(game) {
      return keys.reduce(function (sum, k) { return sum + countForDay(k, q, game); }, 0);
    }
    var counts = { all: total('all') };
    GAME_KEYS.forEach(function (g) { counts[g] = total(g); });
    var html = '<button type="button" class="g' + (state.game === 'all' ? ' on' : '') + '" data-game="all" aria-pressed="' + (state.game === 'all') + '" title="当前视图共 ' + counts.all + ' 场">全部 <em>' + counts.all + '</em></button>';
    GAME_KEYS.forEach(function (g) {
      html += '<button type="button" class="g' + (state.game === g ? ' on' : '') + '" data-game="' + g + '" aria-pressed="' + (state.game === g) + '" title="' + GAMES[g].label + '：当前视图 ' + counts[g] + ' 场">'
        + '<span class="dot"></span>' + GAMES[g].label + ' <em>' + counts[g] + '</em></button>';
    });
    $('#games').innerHTML = html;
  }

  /* ---------------- Hero ---------------- */
  function renderHero() {
    var tk = todayKey();
    var hq = state.q.trim().toLowerCase();
    if (state.view === 'results') {
      var done = ENTRIES.filter(function (x) {
        return passBase(x, hq) && statusOf(x) === 'completed';
      });
      var last = done.slice().sort(function (a, b) { return (b.end || b.start).localeCompare(a.end || a.start); })[0];
      $('#kicker').textContent = 'RESULTS · 最近赛果';
      $('#nowTitle').textContent = done.length ? (done.length + ' 项赛事已结束') : '还没有赛果';
      $('#nowSub').innerHTML = last
        ? '最近：<b>' + esc(last.title) + '</b> · ' + md(last.end || last.start) + ' 收官'
        : '当前数据窗口内没有已结束的赛事。';
      var nx = nextUpcoming('');
      $('#nextCard').innerHTML = nx ? nextCardHtml(nx, '接下来') : '';
      $('#nextCard').style.setProperty('--accent', (GAMES[nx ? nx.game : 'cs2'] || {}).color || 'var(--cs2)');
      var primary = $('#icsBtn');
      primary.textContent = '回到赛程';
      primary.dataset.mode = 'back';
      $('#jumpBtn').hidden = true;
      return;
    }

    var live = ENTRIES.filter(function (x) { return passBase(x, hq) && statusOf(x) === 'live'; });
    var today = ENTRIES.filter(function (x) {
      if (!passBase(x, hq)) return false;
      if (statusOf(x) === 'completed') return false;
      if (x.kind === 'fixture') return dayKey(x.start) === tk;
      return dayKey(x.start) <= tk && dayKey(x.end) >= tk;
    });
    var next = nextEntry('');
    var title = '今天没有比赛', sub = '';

    if (live.length) {
      var liveMatchCount = live.reduce(function (n, x) {
        return n + (x.kind === 'tournament'
          ? (x.matches || []).filter(function (m) { return m.status === 'live'; }).length
          : 1);
      }, 0);
      title = '正在进行 ' + (liveMatchCount || live.length) + ' 场';
      sub = live.slice(0, 2).map(function (x) {
        return '<b>' + esc(x.title) + '</b>' + (x.kind === 'fixture' ? ' · ' + elapsed(x.start) : '');
      }).join(' · ');
    } else if (today.length) {
      title = '今天有 ' + today.length + ' 项赛事';
      sub = '最近的场次：<b>' + esc(today[0].title) + '</b> · ' + hm(today[0].start);
    } else if (next) {
      sub = '最近一场在 <b>' + rel(next.start) + '</b>：' + md(next.start) + ' ' + hm(next.start)
        + ' · <b>' + esc(next.title) + '</b>';
    } else {
      sub = '当前筛选条件下没有未开始的比赛。';
    }

    $('#kicker').textContent = 'TODAY · ' + fullDay(tk) + ' ' + weekday(tk + 'T12:00:00Z');
    $('#nowTitle').textContent = title;
    $('#nowSub').innerHTML = sub;
    $('#icsBtn').textContent = '导出日历';
    $('#icsBtn').dataset.mode = 'ics';
    $('#jumpBtn').hidden = !next;

    if (next) {
      $('#nextCard').innerHTML = nextCardHtml(next, live.length ? '接下来' : '下一场');
      $('#nextCard').style.setProperty('--accent', (GAMES[next.game] || {}).color || 'var(--cs2)');
    } else {
      $('#nextCard').innerHTML = '<div class="next-top"><span>下一场</span></div>'
        + '<div class="next-name" style="margin-top:16px">当前筛选下没有更多比赛</div>'
        + '<div class="next-foot"><span>换个项目或清除筛选</span></div>';
      $('#nextCard').style.setProperty('--accent', 'var(--line-2)');
    }
  }

  function nextCardHtml(x, label) {
    var meta = '<span>' + esc((GAMES[x.game] || {}).label || '') + '</span>'
      + (x.tier && x.tier !== x.league ? '<span>·</span><span>' + esc(x.tier) + '</span>' : '')
      + (x.round ? '<span>·</span><span>第 ' + x.round + ' 站</span>' : '');
    var foot = x.kind === 'f1'
      ? (x.venue ? esc(x.venue) : '共 ' + x.sessions.length + ' 个场次')
      : (x.venue ? esc(x.venue) : (x.league || ''));
    return '<div class="next-top"><span>' + label + '</span><span class="cd">' + rel(x.start) + '</span></div>'
      + '<div class="next-time">' + md(x.start) + '<small>' + hm(x.start) + '</small></div>'
      + '<div class="next-name">' + esc(x.title) + '</div>'
      + '<div class="next-meta">' + meta + '</div>'
      + '<div class="next-foot"><span>' + foot + '</span>'
      + '<button type="button" class="action" data-jump="' + dayKey(x.start) + '">查看 ›</button></div>';
  }

  /* ---------------- 侧栏 ---------------- */
  function nextForTeam(name) {
    var now = Date.now(), best = null;
    ENTRIES.forEach(function (x) {
      if (statusOf(x) === 'completed') return;
      if (x.kind === 'fixture') {
        var t = (x.teams || []).filter(function (y) { return y.name === name || y.code === name; })[0];
        if (t && Date.parse(x.start) >= now) {
          var other = (x.teams || []).filter(function (y) { return y !== t; })[0];
          if (!best || Date.parse(x.start) < Date.parse(best.time)) {
            best = { time: x.start, opp: other ? other.name : 'TBD', logo: t.logo, label: x.league };
          }
        }
      } else if (x.matches && x.matches.length) {
        x.matches.forEach(function (m) {
          if (m.tbd || m.t1.name === 'TBD' || m.t2.name === 'TBD' || !m.time || Date.parse(m.time) < now) return;
          var isA = m.t1.name === name;
          var isB = m.t2.name === name;
          if (!isA && !isB) return;
          var opp = isA ? m.t2.name : m.t1.name;
          if (!best || Date.parse(m.time) < Date.parse(best.time)) {
            best = { time: m.time, opp: opp, logo: (isA ? m.t1.logo : m.t2.logo), label: x.title };
          }
        });
      }
    });
    return best;
  }

  function renderSide() {
    var m = RAW.meta || {};
    var html = '<div class="card"><h3>我的关注 <span class="cnt">' + state.follows.length + '</span></h3>';
    if (!state.follows.length) {
      html += '<div class="empty-note">还没有关注队伍。<br>在赛程里点队伍名即可添加。</div>';
    } else {
      state.follows.forEach(function (name) {
        var nx = nextForTeam(name);
        html += '<div class="follow"><div class="av">'
          + (nx && nx.logo ? '<img src="' + esc(safeUrl(nx.logo)) + '" alt="" loading="lazy" data-ph="' + esc(name.slice(0, 2)) + '">' : esc(name.slice(0, 2)))
          + '</div><div class="fi"><div class="fn">' + esc(name) + '</div><div class="fm">'
          + (nx ? md(nx.time) + ' ' + hm(nx.time) + ' · vs ' + esc(nx.opp) : '暂无近期比赛')
          + '</div></div><button type="button" class="x" data-unfollow="' + esc(name) + '" aria-label="取消关注 ' + esc(name) + '">×</button></div>';
      });
    }
    html += '</div>';

    var picks = ENTRIES.filter(function (x) {
      return passBase(x, state.q.trim().toLowerCase()) && statusOf(x) !== 'completed';
    }).slice(0, 4);
    html += '<div class="card"><h3>接下来</h3>';
    if (!picks.length) html += '<div class="empty-note">当前筛选下没有更多比赛。</div>';
    picks.forEach(function (x) {
      html += '<div class="watch"><div class="dt">' + md(x.start) + '<br>' + hm(x.start) + '</div>'
        + '<div><div class="wt">' + esc(x.title) + '</div><div class="wm">'
        + esc((GAMES[x.game] || {}).label || '') + (x.venue ? ' · ' + esc(x.venue) : '') + '</div></div></div>';
    });
    html += '</div>';

    var ok = (m.sources || []).filter(function (s) { return s.ok && !s.degraded; }).length;
    var total = (m.sources || []).length;
    html += '<div class="card"><h3>数据状态</h3>'
      + '<div class="status"><span class="ok' + (ok < total ? ' bad' : '') + '"></span><span>'
      + (total ? ok + '/' + total + ' 个数据源正常 · <b>' + (m.generatedAt ? ageText(m.generatedAt) : '—') + '</b>' : '尚无数据')
      + '</span></div>';
    (m.sources || []).forEach(function (s) {
      html += '<div class="srcline"><span class="ok' + (!s.ok || s.degraded ? ' bad' : '') + '"></span>'
        + esc(s.label) + '<span class="n">' + s.count + (s.degraded ? '!' : '') + '</span></div>';
    });
    html += '<div class="side-actions"><button type="button" class="btn ghost" id="icsSide">导出 .ics</button>'
      + '<button type="button" class="btn ghost" id="shareSide">复制链接</button></div></div>';
    $('#side').innerHTML = html;
    var a = $('#icsSide'); if (a) a.onclick = downloadICS;
    var b = $('#shareSide'); if (b) b.onclick = copyLink;
  }

  function renderFollowStrip() {
    var strip = $('#followStrip');
    if (!state.follows.length) { strip.hidden = true; strip.innerHTML = ''; return; }
    strip.hidden = false;
    strip.innerHTML = state.follows.map(function (name) {
      var nx = nextForTeam(name);
      return '<span class="follow-pill"><span class="av">' + esc(name.slice(0, 2)) + '</span>'
        + '<b>' + esc(name) + '</b><em>' + (nx ? md(nx.time) + ' ' + hm(nx.time) : '暂无') + '</em></span>';
    }).join('');
  }

  /* ---------------- 实时比分 ---------------- */
  function cssEsc(v) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
  }
  function countLive() {
    var n = 0;
    ENTRIES.forEach(function (x) {
      if (x.game === 'lol' && x.kind === 'fixture') {
        if (statusOf(x) === 'live') n++;
      } else if (x.kind === 'tournament') {
        n += (x.matches || []).filter(function (m) { return m.status === 'live'; }).length;
      }
    });
    return n;
  }
  function liveTargets() {
    var now = Date.now(), ahead = 10 * 60000, back = 4 * 3600000;
    var cs2 = false, lol = false, soon = false, cs2Live = false, lolLive = false;
    ENTRIES.forEach(function (x) {
      if (x.game === 'lol' && x.kind === 'fixture') {
        var st = statusOf(x), t = Date.parse(x.start);
        if (st === 'live') { lol = true; lolLive = true; }
        else if (st !== 'completed' && t - now < ahead && t - now > -back) { lol = true; soon = true; }
      } else if (x.kind === 'tournament') {
        (x.matches || []).forEach(function (m) {
          if (!m.time || m.tbd) return;
          var t = Date.parse(m.time);
          if (m.status === 'live') { cs2 = true; cs2Live = true; }
          else if (m.status !== 'completed' && t - now < ahead && t - now > -back) { cs2 = true; soon = true; }
        });
      }
    });
    return { cs2: cs2, lol: lol, soon: soon, cs2Live: cs2Live, lolLive: lolLive };
  }
  function scheduleLive(delay) {
    clearTimeout(LIVE.timer);
    LIVE.timer = setTimeout(pollLive, delay);
  }
  function nextLiveDelay() {
    var t = liveTargets();
    LIVE.active = !!(t.cs2 || t.lol || t.soon);
    if (t.cs2Live || t.lolLive) return 30000;
    if (t.cs2 || t.lol || t.soon) return 60000;
    return 3 * 60 * 1000;
  }
  function renderLiveBadge() {
    var pill = $('#livePill'), txt = $('#livePillText');
    if (!pill) return;
    if (!LIVE.liveCount) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.classList.toggle('err', !!LIVE.error);
    txt.textContent = LIVE.error ? '实时中断' : '实时 · ' + LIVE.liveCount;
    pill.title = LIVE.error
      ? '实时比分暂时取不到，显示的是最后一次成功的数据'
      : '比分每 30 秒刷新 · 最后 ' + new Date(LIVE.lastAt || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
  }
  function updateMatchScoreDom(el, m) {
    var live = m.status === 'live';
    var has = (live || m.status === 'completed')
      && m.t1.score != null && m.t1.score !== ''
      && m.t2.score != null && m.t2.score !== '';
    el.textContent = has ? (m.t1.score + ' : ' + m.t2.score) : (live ? 'LIVE' : 'vs');
    el.classList.toggle('ns', !has);
    el.classList.toggle('live', live);
  }
  function updateFixtureScoreDom(row, x) {
    var sc = row.querySelector('[data-score-id="' + cssEsc(x.id) + '"]');
    if (!sc) return;
    var a = x.teams[0] || {}, b = x.teams[1] || {};
    var st = statusOf(x);
    var has = (st === 'live' || st === 'completed') && a.score !== '' && b.score !== '';
    sc.textContent = has ? (a.score + ' : ' + b.score) : 'VS';
    sc.classList.toggle('vs', !has);
    var teams = row.querySelectorAll('.team');
    if (teams.length >= 2) {
      var sa = Number(a.score), sb = Number(b.score);
      teams[0].classList.toggle('lose', has && sa < sb);
      teams[0].classList.toggle('win', has && sa > sb);
      teams[1].classList.toggle('lose', has && sb < sa);
      teams[1].classList.toggle('win', has && sb > sa);
    }
  }
  function applyLiveDom(ids) {
    ids.forEach(function (id) {
      var match = null, event = null;
      for (var i = 0; i < ENTRIES.length; i++) {
        var x = ENTRIES[i];
        if (x.id === id) { event = x; break; }
        if (x.kind === 'tournament') {
          var m = (x.matches || []).filter(function (y) { return y.id === id; })[0];
          if (m) { match = m; break; }
        }
      }
      if (match) {
        var row = document.querySelector('.mrow[data-mid="' + cssEsc(id) + '"]');
        if (!row) return;
        var sc = row.querySelector('[data-mscore]');
        if (sc) updateMatchScoreDom(sc, match);
        var detail = row.querySelector('[data-detail]');
        if (detail) {
          var tmp = document.createElement('div');
          tmp.innerHTML = matchDetailHtml(match);
          var next = tmp.firstChild;
          if (next) detail.replaceWith(next);
        }
      } else if (event) {
        var fr = document.querySelector('.row[data-live-row="' + cssEsc(id) + '"]');
        if (fr) updateFixtureScoreDom(fr, event);
      }
    });
  }
  async function pollLive() {
    try {
      await pollLiveImpl();
    } catch (e) {
      // 任何意外都不能让轮询死掉：标记中断，按退避继续下一次
      LIVE.error = true;
      LIVE.inFlight = false;
      renderLiveBadge();
      scheduleLive(nextLiveDelay());
    }
  }
  async function pollLiveImpl() {
    if (document.hidden) { scheduleLive(60000); return; }
    if (LIVE.inFlight) return;
    var t = liveTargets();
    LIVE.active = !!(t.cs2 || t.lol || t.soon);
    if (!t.cs2 && !t.lol) { renderLiveBadge(); scheduleLive(3 * 60 * 1000); return; }
    if (!window.LiveScores) return;
    LIVE.inFlight = true;
    var now = Date.now(), jobs = [];
    // 首次轮询时，静态数据里标着 live 的对局也要有 seen 起点，否则结束后永远不会被兜底标完成
    ENTRIES.forEach(function (x) {
      if (x.game === 'lol' && x.kind === 'fixture' && x.status === 'live') {
        LIVE.seen[x.id] = LIVE.seen[x.id] || now;
      }
      if (x.kind === 'tournament') {
        (x.matches || []).forEach(function (m) {
          if (m.status === 'live') LIVE.seen[m.id] = LIVE.seen[m.id] || now;
        });
      }
    });
    if (t.cs2 && LIVE.skip.cs2 < now) jobs.push(LiveScores.fetchCs2().then(function (d) { return { k: 'cs2', d: d }; }).catch(function (e) { return { k: 'cs2', e: e }; }));
    if (t.lol && LIVE.skip.lol < now) jobs.push(LiveScores.fetchLol(RIOT_LIVE_KEY).then(function (d) { return { k: 'lol', d: d }; }).catch(function (e) { return { k: 'lol', e: e }; }));
    if (!jobs.length) { LIVE.inFlight = false; renderLiveBadge(); scheduleLive(120000); return; }
    var settled = await Promise.all(jobs);
    var changed = [], statusChanged = false, ok = 0, failed = 0;
    settled.forEach(function (r) {
      if (r.e) {
        failed++;
        LIVE.skip[r.k] = Date.now() + 5 * 60 * 1000;
        return;
      }
      ok++;
      LIVE.skip[r.k] = 0;
      var res = r.k === 'cs2' ? LiveScores.mergeCs2(ENTRIES, r.d) : LiveScores.mergeLol(ENTRIES, r.d);
      changed = changed.concat(res.changed);
      statusChanged = statusChanged || res.statusChanged;
      var present = {};
      r.d.forEach(function (z) { present[z.id] = true; });
      if (markStaleLive(r.k, { has: function (id) { return !!present[id]; } }, Date.now())) statusChanged = true;
    });
    LIVE.inFlight = false;
    LIVE.error = failed > 0 && ok === 0;
    LIVE.liveCount = countLive();
    if (ok) LIVE.lastAt = Date.now();
    if (statusChanged) renderAll();
    else {
      if (changed.length) applyLiveDom(changed);
      renderLiveBadge();
    }
    scheduleLive(nextLiveDelay());
  }
  function initLive() {
    if (!window.LiveScores) return;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pollLive(); });
    window.addEventListener('online', function () { LIVE.skip = { cs2: 0, lol: 0 }; pollLive(); });
    window.addEventListener('offline', function () { LIVE.error = true; renderLiveBadge(); });
    setTimeout(pollLive, 2500);
  }
  // 比分源把「已结束」的对局从列表里拿掉时，给 5 分钟宽限再标完成；
  // 下一次如果它又出现，merge 会把它改回 live，自愈。
  function markStaleLive(kind, present, now) {
    var changed = false;
    if (kind === 'lol') {
      ENTRIES.forEach(function (x) {
        if (x.game !== 'lol' || x.kind !== 'fixture' || x.status !== 'live') return;
        if (present.has(x.id)) { LIVE.seen[x.id] = now; return; }
        var last = LIVE.seen[x.id];
        if (last && now - last > 5 * 60000) { x.status = 'completed'; changed = true; }
      });
    } else {
      ENTRIES.forEach(function (x) {
        if (x.kind !== 'tournament') return;
        (x.matches || []).forEach(function (m) {
          if (m.status !== 'live') return;
          if (present.has(m.id)) { LIVE.seen[m.id] = now; return; }
          var last = LIVE.seen[m.id];
          if (last && now - last > 5 * 60000) { m.status = 'completed'; changed = true; }
        });
      });
    }
    return changed;
  }

  function applyLiveDebug(kind, payload) {
    var r = kind === 'cs2' ? LiveScores.mergeCs2(ENTRIES, payload) : LiveScores.mergeLol(ENTRIES, payload);
    LIVE.liveCount = countLive();
    LIVE.lastAt = Date.now();
    LIVE.active = true;
    if (r.statusChanged) renderAll();
    else {
      if (r.changed.length) applyLiveDom(r.changed);
      renderLiveBadge();
    }
    return r;
  }

  /* ---------------- 状态与提示 ---------------- */
  function renderMeta() {
    var m = RAW.meta || {};
    var fresh = $('#fresh');
    if (m.generatedAt) {
      var mins = Math.round((Date.now() - Date.parse(m.generatedAt)) / 60000);
      fresh.textContent = ageText(m.generatedAt);
      fresh.title = '数据生成于 ' + new Date(m.generatedAt).toLocaleString('zh-CN');
      fresh.classList.toggle('stale', mins > 480);
    } else {
      fresh.textContent = '尚无数据';
    }
    var tzText = state.tz === 'Asia/Shanghai' ? '北京时间 (UTC+8)' : (state.tz === 'UTC' ? 'UTC' : '本机时区');
    $('#footTz').textContent = '时区 ' + tzText;
    $('#footCount').textContent = ENTRIES.length + ' 项赛事 / ' + ((RAW.events || []).length) + ' 条数据';
  }

  function renderBanner() {
    var m = RAW.meta || {};
    var wrap = $('#banner');
    if (state.bannerDismissed) { wrap.innerHTML = ''; return; }
    var msgs = [];
    if (m.generatedAt && Date.now() - Date.parse(m.generatedAt) > 8 * 3600 * 1000) {
      msgs.push('<b>数据可能已过期</b>：更新于 ' + ageText(m.generatedAt) + '，页面展示的是最近一次成功抓取的结果。');
    }
    var bad = (m.sources || []).filter(function (s) { return !s.ok; });
    var deg = (m.sources || []).filter(function (s) { return s.ok && s.degraded; });
    if (bad.length) {
      msgs.push('<b>数据源抓取失败</b>：' + bad.map(function (s) { return esc(s.label) + '（' + esc(s.error || '未知错误') + '）'; }).join('；') + '，该部分沿用上次缓存。');
    }
    if (deg.length) {
      msgs.push('<b>数据源本次返回 0 条</b>：' + deg.map(function (s) { return esc(s.label); }).join('；') + '。可能是休赛期，也可能是接口变化。');
    }
    if (!msgs.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<div class="banner">' + msgs.join('<br>')
      + '<button type="button" class="x" data-dismiss="1" aria-label="关闭提示">×</button></div>';
  }

  /* ---------------- 控件同步 ---------------- */
  function syncControls() {
    $$('[data-view]').forEach(function (b) {
      var on = b.getAttribute('data-view') === state.view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#q').value = state.q;
    $('#tzTop').value = state.tz;
    $('#tzSheet').value = state.tz;
    $('#practiceChip').classList.toggle('on', state.showPractice);
    $('#practiceChip').setAttribute('aria-pressed', String(state.showPractice));
    $('#tbdChip').classList.toggle('on', state.showTbd);
    $('#tbdChip').setAttribute('aria-pressed', String(state.showTbd));

    var labels = tierLabels();
    $('#tiers').innerHTML = labels.map(function (l) {
      var on = !state.tiers || state.tiers[l] !== false;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-tier="' + esc(l) + '" aria-pressed="' + on + '">' + esc(l) + '</button>';
    }).join('');

    var sel = $('#region');
    var regions = uniq(ENTRIES.map(function (x) { return x.regionGroup; })).sort();
    var cur = state.region;
    sel.innerHTML = '<option value="">全部赛区</option>' + regions.map(function (r) {
      return '<option value="' + esc(r) + '"' + (r === cur ? ' selected' : '') + '>' + esc(r) + '</option>';
    }).join('');
    sel.value = cur;

    var dayVal = state.day || (state.weekOffset ? weekStart() : todayKey());
    if ($('#datePick').value !== dayVal) $('#datePick').value = dayVal;
    if ($('#datePickSheet').value !== dayVal) $('#datePickSheet').value = dayVal;

    var af = $('#activeFilter');
    if (state.eventKey) {
      af.hidden = false;
      af.innerHTML = '<span class="lab">赛事</span><b>' + esc(state.eventLabel || state.eventKey) + '</b>'
        + '<button type="button" class="x" data-clear-event aria-label="清除赛事筛选">×</button>';
    } else {
      af.hidden = true;
      af.innerHTML = '';
    }

    var n = 0;
    if (state.region) n++;
    if (state.eventKey) n++;
    if (!state.showPractice) n++;
    if (!state.showTbd) n++;
    if (state.tiers) n += Object.keys(state.tiers).filter(function (k) { return !state.tiers[k]; }).length;
    var fc = $('#filterCount');
    fc.hidden = n === 0;
    fc.textContent = String(n);
  }

  function tierLabels() {
    return uniq(ENTRIES.map(function (x) { return x.tier; })).sort(function (a, b) {
      var ia = TIER_ORDER.indexOf(a), ib = TIER_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function ensureTiers() {
    var labels = tierLabels();
    if (!state.tiers) state.tiers = {};
    labels.forEach(function (l) { if (!(l in state.tiers)) state.tiers[l] = true; });
    if (state.tiersOff) {
      state.tiersOff.forEach(function (l) { if (l in state.tiers) state.tiers[l] = false; });
      state.tiersOff = null;
    }
  }

  /* ---------------- URL 状态 ---------------- */
  var lastHash = '';
  function stateToHash() {
    var p = new URLSearchParams();
    if (state.view !== 'upcoming') p.set('v', state.view);
    var on = GAME_KEYS.filter(function (g) { return state.game === g; });
    if (state.game !== 'all') p.set('g', state.game);
    if (state.day) p.set('d', state.day);
    if (state.weekOffset) p.set('w', String(state.weekOffset));
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.tz !== DEFAULT_TZ) p.set('tz', state.tz);
    if (state.region) p.set('r', state.region);
    if (state.eventKey) p.set('e', state.eventKey);
    if (!state.showPractice) p.set('np', '1');
    if (!state.showTbd) p.set('tb', '0');
    if (state.tiers) {
      var off = Object.keys(state.tiers).filter(function (k) { return !state.tiers[k]; });
      if (off.length) p.set('t', off.join('|'));
    }
    return p.toString();
  }
  function writeHash() {
    var h = stateToHash();
    if (h === lastHash) return;
    lastHash = h;
    var target = h ? '#' + h : (location.pathname + location.search);
    try { history.replaceState(null, '', target); } catch (e) { /* file:// 可能被拦 */ }
  }
  function readHash() {
    var p = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (!p.toString()) return;
    if (p.get('v') === 'results') state.view = 'results';
    if (p.has('g') && GAME_KEYS.indexOf(p.get('g')) >= 0) state.game = p.get('g');
    if (p.has('d') && /^\d{4}-\d{2}-\d{2}$/.test(p.get('d'))) state.day = p.get('d');
    if (p.has('w')) {
      var w = parseInt(p.get('w'), 10);
      if (!isNaN(w) && w >= -52 && w <= 52) state.weekOffset = w;
    }
    if (p.has('q')) state.q = (p.get('q') || '').slice(0, 80);
    if (p.has('tz') && TZ_ALLOWED.indexOf(p.get('tz')) >= 0) state.tz = p.get('tz');
    if (p.has('r')) state.region = (p.get('r') || '').slice(0, 20);
    if (p.has('e')) state.eventKey = (p.get('e') || '').slice(0, 120);
    if (p.get('np') === '1') state.showPractice = false;
    if (p.get('tb') === '0') state.showTbd = false;
    if (p.has('t')) state.tiersOff = (p.get('t') || '').split('|').filter(Boolean);
    if (state.day) {
      var diff = dayDiff(todayKey(), state.day);
      state.weekOffset = state.view === 'results'
        ? Math.ceil(diff / 7)
        : Math.floor(diff / 7);
    }
  }

  /* ---------------- ICS ---------------- */
  function icsText(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsDate(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function icsLines(lines) {
    // RFC 5545 行折叠：按 73 字符折行（够用，避免 Outlook 截断）
    var out = [];
    lines.forEach(function (line) {
      var s = String(line);
      while (s.length > 73) {
        out.push(s.slice(0, 73));
        s = ' ' + s.slice(73);
      }
      out.push(s);
    });
    return out.join('\r\n');
  }
  function downloadICS() {
    var from = todayKey();
    var to = addDays(from, 7);
    var q = state.q.trim().toLowerCase();
    var evs = [];

    ENTRIES.forEach(function (x) {
      if (!passBase(x, q)) return;
      if (statusOf(x) === 'completed') return;
      if (x.kind === 'f1') {
        x.sessions.forEach(function (s) {
          if (!state.showPractice && /练习赛/.test(s.stage)) return;
          var k = dayKey(s.startTime);
          if (k < from || k > to) return;
          evs.push({
            id: x.id + '-' + s.sessionKey,
            start: s.startTime,
            end: new Date(Date.parse(s.startTime) + (s.durationMin || 60) * 60000).toISOString(),
            summary: x.title + ' · ' + s.stage,
            location: x.venue,
            desc: 'F1 · 第 ' + x.round + ' 站'
          });
        });
      } else if (x.kind === 'tournament') {
        if (dayKey(x.end) < from || dayKey(x.start) > to) return;
        evs.push({
          id: x.id,
          start: x.start,
          end: x.end,
          summary: x.title,
          location: x.venue,
          desc: x.league + (x.tier ? ' · ' + x.tier : '') + (x.matches.length ? ' · ' + x.matches.length + ' 场对局' : '')
        });
      } else {
        if (isTbdFixture(x)) return;
        var k = dayKey(x.start);
        if (k < from || k > to) return;
        var end = new Date(Date.parse(x.start) + (x.durationMin || 180) * 60000).toISOString();
        var teams = (x.teams || []).map(function (t) { return t.name; }).join(' vs ');
        evs.push({
          id: x.id, start: x.start, end: end,
          summary: teams || x.title, location: x.venue,
          desc: x.league + (x.stage ? ' · ' + x.stage : '') + (x.bestOf ? ' · BO' + x.bestOf : '')
        });
      }
    });

    if (!evs.length) { toast('当前筛选下没有可导出的比赛'); return; }
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//esports-schedule//CN', 'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:综合赛程', 'X-WR-TIMEZONE:' + (state.tz === 'local' ? 'LOCAL' : state.tz)
    ];
    evs.forEach(function (e) {
      if (Date.parse(e.end) <= Date.parse(e.start)) e.end = new Date(Date.parse(e.start) + 3600000).toISOString();
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsText(e.id) + '@esports-schedule');
      lines.push('DTSTAMP:' + icsDate(new Date().toISOString()));
      lines.push('DTSTART:' + icsDate(e.start));
      lines.push('DTEND:' + icsDate(e.end));
      lines.push('SUMMARY:' + icsText(e.summary));
      if (e.location) lines.push('LOCATION:' + icsText(e.location));
      if (e.desc) lines.push('DESCRIPTION:' + icsText(e.desc));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');

    var blob = new Blob([icsLines(lines)], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'esports-schedule-' + from.replace(/-/g, '') + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已导出 ' + evs.length + ' 个日历条目');
  }

  function copyLink() {
    writeHash();
    var url = location.href;
    function ok() { toast('链接已复制'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok();
      } catch (e) { toast('复制失败，请手动复制地址栏'); }
    }
    if (navigator.clipboard && location.protocol !== 'file:') {
      navigator.clipboard.writeText(url).then(ok).catch(fallback);
    } else { fallback(); }
  }

  /* ---------------- 交互 ---------------- */
  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }

  function toggleOpen(key) {
    state.open[key] = !state.open[key];
    renderAgenda();
  }
  function toggleFollow(name) {
    if (!name || name === 'TBD' || name === '待定') return;
    var i = state.follows.indexOf(name);
    if (i >= 0) state.follows.splice(i, 1); else state.follows.push(name);
    saveFollows();
    renderAgenda();
    renderSide();
    renderFollowStrip();
    syncControls();
    toast(i >= 0 ? '已取消关注 ' + name : '已关注 ' + name);
  }
  function jumpTo(day) {
    if (!day) return;
    state.view = 'upcoming';
    state.day = day;
    var diff = dayDiff(todayKey(), day);
    state.weekOffset = Math.floor(diff / 7);
    renderAll();
    setTimeout(function () {
      var el = document.getElementById('d-' + day);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 30);
  }
  function jumpToDate(day) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    var tk = todayKey();
    if (day > tk) state.view = 'upcoming';
    else if (day < tk) state.view = 'results';
    state.day = day;
    var diff = dayDiff(tk, day);
    state.weekOffset = state.view === 'results' ? Math.ceil(diff / 7) : Math.floor(diff / 7);
    renderAll();
    setTimeout(function () {
      var el = document.getElementById('d-' + day);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 30);
  }

  function focusEvent(key, label) {
    var hits = ENTRIES.filter(function (x) { return eventKeyOf(x) === key; });
    if (!hits.length) { toast('当前数据窗口内没有这个赛事'); return; }
    state.eventKey = key;
    state.eventLabel = label || eventLabelOf(hits[0]);
    state.day = '';
    var day;
    if (state.view === 'results') {
      var done = hits.filter(function (x) { return statusOf(x) === 'completed'; });
      if (!done.length) { state.view = 'upcoming'; }
      else day = dayKey(done[done.length - 1].end || done[done.length - 1].start);
    }
    if (state.view === 'upcoming') {
      var next = hits.filter(function (x) { return statusOf(x) !== 'completed'; })[0] || hits[0];
      day = dayKey(next.start);
      if (day < todayKey()) day = todayKey();
    }
    var diff = dayDiff(todayKey(), day);
    state.weekOffset = state.view === 'results' ? Math.ceil(diff / 7) : Math.floor(diff / 7);
    renderAll();
    setTimeout(function () {
      var el = document.querySelector('#agenda .dayhead');
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
    }, 30);
  }

  function jumpToNext() {
    var n = nextEntry('');
    if (!n) { toast('当前筛选下没有更多比赛'); return; }
    jumpTo(dayKey(n.start));
  }
  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    state.weekOffset = 0;
    state.day = '';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderAll() {
    ensureTiers();
    buildFormatters();
    renderMeta();
    renderBanner();
    renderHero();
    renderWeek();
    renderGames();
    renderAgenda();
    renderSide();
    renderFollowStrip();
    renderLiveBadge();
    syncControls();
    writeHash();
    lastStatusSig = statusSignature();
  }

  function statusSignature() {
    return ENTRIES.map(function (x) { return statusOf(x).charAt(0); }).join('');
  }
  var lastStatusSig = '';

  /* ---------------- 刷新 ---------------- */
  var LOCAL = (location.protocol === 'http:' || location.protocol === 'https:')
    && ['localhost', '127.0.0.1', '::1'].indexOf(location.hostname) >= 0;
  var CLIENT_ID = 'c' + Math.random().toString(36).slice(2, 10);

  function isLocal() { return LOCAL; }

  function initMode() {
    var btn = $('#refresh');
    btn.title = LOCAL ? '重新抓取一次数据' : '重新载入数据文件（静态托管）';
    $('#refreshText').textContent = LOCAL ? '更新数据' : '检查更新';
  }

  var hbTimer = null;
  function heartbeat() {
    if (!LOCAL) return;
    function offline() {
      LOCAL = false;
      initMode();
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    }
    function beat() {
      if (!LOCAL) return;
      fetch('/api/ping?id=' + CLIENT_ID).then(function (r) {
        // 静态服务器（python -m http.server、预览面板等）会返回 404，不能当成 serve.mjs
        if (!r.ok) offline();
      }).catch(offline);
    }
    beat();
    hbTimer = setInterval(beat, 5000);
    window.addEventListener('beforeunload', function () {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/bye?id=' + CLIENT_ID);
    });
  }

  function reloadData() {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'data/schedule.js?t=' + Date.now();
      s.onload = function () {
        s.remove();
        if (window.__SCHEDULE__ && Array.isArray(window.__SCHEDULE__.events)) {
          RAW = window.__SCHEDULE__;
          rebuild();
          resolve(true);
        } else resolve(false);
      };
      s.onerror = function () { s.remove(); resolve(false); };
      document.body.appendChild(s);
    });
  }

  function rebuild() {
    ENTRIES = buildEntries();
    ensureTiers();
    resolveEventLabel();
    // 换了一份静态数据，实时覆盖也跟着作废，等下一次轮询重新建立
    LIVE.liveCount = 0;
    LIVE.seen = {};
  }

  async function refresh(manual) {
    var btn = $('#refresh'), tip = $('#refreshText');
    btn.disabled = true;
    btn.classList.add('busy');
    tip.textContent = '更新中…';
    var old = RAW.meta ? RAW.meta.generatedAt : '';

    try {
      if (LOCAL) {
        var r = await fetch('/api/refresh', { method: 'POST' });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok || !j.ok) throw new Error(j.error || '抓取失败');
        var loaded = await reloadData();
        renderAll();
        toast(loaded ? '已更新 ' + ((RAW.meta || {}).total || '') + ' 条' : '数据文件载入失败');
      } else {
        var ok = await reloadData();
        if (!ok) throw new Error('数据文件载入失败');
        var now = RAW.meta ? RAW.meta.generatedAt : '';
        renderAll();
        toast(now && now !== old ? '已载入最新数据' : '暂无新数据');
      }
    } catch (err) {
      toast('更新失败：' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
      initMode();
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var ef = e.target.closest('[data-event-filter]');
      if (ef) {
        e.preventDefault();
        var ekey = ef.getAttribute('data-event-filter');
        if (!ekey) return;
        if (state.eventKey === ekey) { state.eventKey = ''; state.eventLabel = ''; state.day = ''; renderAll(); }
        else focusEvent(ekey, ef.getAttribute('data-event-label') || '');
        return;
      }

      var ce = e.target.closest('[data-clear-event]');
      if (ce) { e.preventDefault(); state.eventKey = ''; state.eventLabel = ''; renderAll(); return; }

      var follow = e.target.closest('[data-follow]');
      if (follow) { e.preventDefault(); toggleFollow(follow.getAttribute('data-follow')); return; }

      var unfollow = e.target.closest('[data-unfollow]');
      if (unfollow) { e.preventDefault(); toggleFollow(unfollow.getAttribute('data-unfollow')); return; }

      var toggle = e.target.closest('[data-toggle]');
      if (toggle) { e.preventDefault(); toggleOpen(toggle.getAttribute('data-toggle')); return; }

      var tbd = e.target.closest('[data-tbd]');
      if (tbd) {
        e.preventDefault();
        var k = tbd.getAttribute('data-tbd');
        state.tbdOpen[k] = !state.tbdOpen[k];
        renderAgenda();
        return;
      }

      var jump = e.target.closest('[data-jump]');
      if (jump) { e.preventDefault(); jumpTo(jump.getAttribute('data-jump')); return; }

      var dismiss = e.target.closest('[data-dismiss]');
      if (dismiss) { state.bannerDismissed = true; renderBanner(); return; }

      var view = e.target.closest('[data-view]');
      if (view) { setView(view.getAttribute('data-view')); return; }

      var wk = e.target.closest('[data-week]');
      if (wk) {
        e.preventDefault();
        var delta = parseInt(wk.getAttribute('data-week'), 10);
        state.weekOffset = Math.max(-52, Math.min(52, state.weekOffset + delta));
        state.day = '';
        renderAll();
        return;
      }

      var game = e.target.closest('[data-game]');
      if (game) { state.game = game.getAttribute('data-game'); state.day = ''; renderAll(); return; }

      var tier = e.target.closest('[data-tier]');
      if (tier) {
        var l = tier.getAttribute('data-tier');
        state.tiers[l] = !state.tiers[l];
        renderAll();
        return;
      }

      var day = e.target.closest('[data-day]');
      if (day) {
        var k2 = day.getAttribute('data-day');
        state.day = state.day === k2 ? '' : k2;
        renderAll();
        return;
      }

      var row = e.target.closest('.row[data-key]');
      if (row && !e.target.closest('button,a')) {
        var key = row.getAttribute('data-key');
        if (row.classList.contains('clickable') || row.querySelector('.panel')) toggleOpen(key);
      }
    });

    $('#weekToday').onclick = function () {
      state.weekOffset = 0; state.day = ''; renderAll();
    };
    $('#datePick').onchange = function () { jumpToDate(this.value); };
    $('#datePickSheet').onchange = function () { jumpToDate(this.value); closeDlg(); };

    $('#q').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(this._t);
      this._t = setTimeout(function () {
        state.q = v;
        renderAll();
      }, 180);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault(); $('#q').focus();
      }
      if (e.key === 'Escape' && document.activeElement === $('#q')) {
        $('#q').value = ''; state.q = ''; renderAll();
      }
    });

    $('#searchBtn').onclick = function () {
      $('#q').focus();
      $('#q').scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    $('#followBtn').onclick = function () {
      if (!state.follows.length) { toast('在赛程里点队伍名即可关注'); return; }
      var strip = $('#followStrip');
      if (!strip.hidden) strip.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else $('#side').scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    $('#refresh').onclick = function () { refresh(true); };

    $('#icsBtn').onclick = function () {
      if (this.dataset.mode === 'back') { setView('upcoming'); return; }
      downloadICS();
    };
    $('#jumpBtn').onclick = jumpToNext;

    var dlg = $('#filters');
    $('#filterBtn').onclick = function () {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    };
    function closeDlg() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
    $('#filterClose').onclick = closeDlg;
    $('#applyFilters').onclick = closeDlg;
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeDlg(); });

    $('#region').onchange = function () { state.region = this.value; renderAll(); };
    $('#practiceChip').onclick = function () { state.showPractice = !state.showPractice; renderAll(); };
    $('#tbdChip').onclick = function () { state.showTbd = !state.showTbd; renderAll(); };
    $('#resetFilters').onclick = function () {
      state.game = 'all'; state.region = ''; state.q = ''; state.day = ''; state.weekOffset = 0;
      state.eventKey = ''; state.eventLabel = '';
      state.showPractice = true; state.showTbd = true; state.tiers = null;
      renderAll();
      toast('已重置筛选');
    };
    $('#icsSheet').onclick = downloadICS;
    $('#shareBtn').onclick = copyLink;
    $('#tzTop').onchange = $('#tzSheet').onchange = function () {
      var v = this.value;
      state.tz = TZ_ALLOWED.indexOf(v) >= 0 ? v : DEFAULT_TZ;
      buildFormatters();
      renderAll();
    };

    window.addEventListener('hashchange', function () {
      readHash();
      buildFormatters();
      renderAll();
    });

    // 破图兜底
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      var ph = img.getAttribute('data-ph');
      if (!ph) return;
      var s = document.createElement('span');
      s.className = 'ph';
      s.textContent = ph;
      img.replaceWith(s);
    }, true);

    setInterval(function () {
      $$('[data-cd]').forEach(function (el) { el.textContent = rel(el.getAttribute('data-cd')); });
      $$('[data-el]').forEach(function (el) { el.textContent = elapsed(el.getAttribute('data-el')); });
      var sig = statusSignature();
      if (sig !== lastStatusSig) { lastStatusSig = sig; renderAll(); }
      renderMeta();
    }, 30000);

    if (!LOCAL) {
      setInterval(async function () {
        var old = RAW.meta ? RAW.meta.generatedAt : '';
        var ok = await reloadData();
        if (ok && RAW.meta && RAW.meta.generatedAt !== old) {
          renderAll();
          toast('已载入新数据');
        }
      }, 10 * 60 * 1000);
    }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 只在 HTTPS 下注入：file:// 会 CORS，本地/预览静态服务器没有 manifest 文件
    if (location.protocol === 'https:') {
      var link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'site.webmanifest';
      document.head.appendChild(link);
    }
    buildFormatters();
    readHash();
    rebuild();
    initMode();
    renderAll();
    bindEvents();
    heartbeat();
    initLive();
    if ((location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].indexOf(location.hostname) >= 0)
      && new URLSearchParams(location.search).has('liveDebug') && window.LiveScores) {
      window.__liveDebug = {
        entries: function () { return ENTRIES; },
        applyCs2: function (p) { return applyLiveDebug('cs2', p); },
        applyLol: function (p) { return applyLiveDebug('lol', p); },
        countLive: countLive,
        poll: pollLive
      };
    }
    lastStatusSig = statusSignature();
  }

  boot();
})();

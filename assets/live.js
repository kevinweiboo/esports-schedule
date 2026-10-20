/* 实时比分数据层
   纯逻辑 + 两个 fetch，不依赖 DOM；浏览器挂 window.LiveScores，Node 可 require 做单测。
   数据源：
   - CS2：5EPlay session_list（CORS: *）
   - LoL：Riot getLive（CORS: *，需要社区公开 key）
   注意：号角 OPTIONS 返回 403，瓦洛兰特不做客户端轮询。 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveScores = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CS2_URL = 'https://app.5eplay.com/api/tournament/session_list?game_status=1&game_type=1&grades=&page=1&limit=100';
  var LOL_URL = 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=zh-CN';
  var TIMEOUT = 8000;

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function score(v) {
    return v == null ? '' : String(v);
  }

  function mapCs2Match(m) {
    var mc = m.mc_info || {};
    var st = m.state || {};
    var t1 = mc.t1_info || {};
    var t2 = mc.t2_info || {};
    var code = String(st.status);
    var status = code === '1' ? 'live' : code === '2' ? 'completed' : 'upcoming';
    var maps = (Array.isArray(st.bout_states) ? st.bout_states : [])
      .filter(function (b) { return b && b.map_name; })
      .map(function (b) {
        return {
          name: String(b.map_name),
          t1: score(b.t1_score),
          t2: score(b.t2_score),
          result: b.result || '',
          status: Number(b.status) || 0
        };
      });
    return {
      id: 'cs2m-' + mc.id,
      status: status,
      t1: { name: t1.disp_name || '', score: score(st.t1_score) },
      t2: { name: t2.disp_name || '', score: score(st.t2_score) },
      maps: maps,
      prob1: num(st.t1_odds_percent),
      prob2: num(st.t2_odds_percent)
    };
  }

  function extractCs2(json) {
    var ms = (json && json.data && json.data.matches) || [];
    return ms.map(mapCs2Match).filter(function (x) { return x.status !== 'upcoming'; });
  }

  function mapLolEvent(e) {
    var match = e.match || {};
    var teams = match.teams || [];
    return {
      id: 'lol-' + match.id,
      status: e.state === 'inProgress' ? 'live' : (e.state === 'completed' ? 'completed' : 'live'),
      teams: teams.map(function (t) {
        return {
          code: t.code || '',
          name: t.name || '',
          score: t.result && t.result.gameWins != null ? Number(t.result.gameWins) : null
        };
      })
    };
  }

  function extractLol(json) {
    var evs = (json && json.data && json.data.events) || [];
    return evs.map(mapLolEvent);
  }

  async function fetchJson(url, opts) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    try {
      var r = await fetch(url, Object.assign({ cache: 'no-store', signal: ctl.signal }, opts || {}));
      if (!r.ok) throw new Error(url.indexOf('lolesports') >= 0 ? 'Riot HTTP ' + r.status : '5EPlay HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchCs2() {
    var j = await fetchJson(CS2_URL);
    if (j && j.success === false) throw new Error(j.message || '5EPlay 返回失败');
    return extractCs2(j);
  }

  async function fetchLol(key) {
    var j = await fetchJson(LOL_URL, { headers: { 'x-api-key': key } });
    if (!j || !j.data) throw new Error('Riot 返回格式异常');
    return extractLol(j);
  }

  // 把实时结果合并进 ENTRIES；只改数据，不碰 DOM。
  // 返回 { changed: [id], statusChanged: bool }
  function mergeCs2(entries, live) {
    var byId = {};
    entries.forEach(function (x) {
      (x.matches || []).forEach(function (m) { byId[m.id] = m; });
    });
    var changed = [], statusChanged = false;
    (live || []).forEach(function (l) {
      var m = byId[l.id];
      if (!m) return;
      var oldStatus = m.status;
      var oldMaps = JSON.stringify(m.maps || []);
      var oldProb = (m.prob1 == null ? '' : m.prob1) + '/' + (m.prob2 == null ? '' : m.prob2);
      var dirty = false;

      if (l.status && l.status !== m.status) { m.status = l.status; dirty = true; }
      if (l.t1 && l.t1.score !== '' && l.t1.score !== (m.t1 && m.t1.score)) { m.t1.score = l.t1.score; dirty = true; }
      if (l.t2 && l.t2.score !== '' && l.t2.score !== (m.t2 && m.t2.score)) { m.t2.score = l.t2.score; dirty = true; }
      if (l.maps && l.maps.length) {
        var newMaps = JSON.stringify(l.maps);
        if (newMaps !== oldMaps) { m.maps = l.maps; dirty = true; }
      }
      if (l.prob1 != null && l.prob2 != null) {
        var newProb = l.prob1 + '/' + l.prob2;
        if (newProb !== oldProb) { m.prob1 = l.prob1; m.prob2 = l.prob2; dirty = true; }
      }
      if (!dirty) return;
      if (oldStatus !== m.status) statusChanged = true;
      changed.push(m.id);
    });
    return { changed: changed, statusChanged: statusChanged };
  }

  function mergeLol(entries, live) {
    var byId = {};
    entries.forEach(function (x) {
      if (x.game === 'lol' && x.kind === 'fixture') byId[x.id] = x;
    });
    var changed = [], statusChanged = false;
    (live || []).forEach(function (l) {
      var x = byId[l.id];
      if (!x) return;
      var oldStatus = x.status;
      var oldScores = (x.teams || []).map(function (t) { return t.score; }).join(':');
      var dirty = false;

      if (l.status && l.status !== x.status) { x.status = l.status; dirty = true; }
      (l.teams || []).forEach(function (t) {
        var target = (x.teams || []).filter(function (y) {
          return (t.code && y.code === t.code) || (t.name && y.name === t.name);
        })[0];
        if (!target) return;
        if (t.score != null && target.score !== t.score) { target.score = t.score; dirty = true; }
      });
      if (!dirty) return;
      if (oldStatus !== x.status) statusChanged = true;
      if (oldScores !== (x.teams || []).map(function (t) { return t.score; }).join(':')) changed.push(x.id);
    });
    return { changed: changed, statusChanged: statusChanged };
  }

  function merge(entries, cs2, lol) {
    var a = mergeCs2(entries, cs2 || []);
    var b = mergeLol(entries, lol || []);
    return {
      changed: a.changed.concat(b.changed),
      statusChanged: a.statusChanged || b.statusChanged
    };
  }

  return {
    fetchCs2: fetchCs2,
    fetchLol: fetchLol,
    extractCs2: extractCs2,
    extractLol: extractLol,
    mapCs2Match: mapCs2Match,
    mapLolEvent: mapLolEvent,
    mergeCs2: mergeCs2,
    mergeLol: mergeLol,
    merge: merge
  };
});

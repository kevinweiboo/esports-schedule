// 实时比分数据层回归：映射与合并
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Live = require('../assets/live.js');

function cs2Raw(over = {}) {
  return {
    mc_info: {
      id: 'csgo_mc_1',
      t1_info: { disp_name: 'NAVI' },
      t2_info: { disp_name: 'G2' }
    },
    state: {
      status: '1',
      t1_score: '1',
      t2_score: '0',
      t1_odds_percent: '63',
      t2_odds_percent: '37',
      bout_states: [
        { map_name: 'Ancient', t1_score: '13', t2_score: '11', result: 't1', status: '2' },
        { map_name: 'Nuke', t1_score: '5', t2_score: '3', result: '', status: '1' }
      ]
    },
    ...over
  };
}

test('mapCs2Match 映射 live 状态、地图与胜率', () => {
  const m = Live.mapCs2Match(cs2Raw());
  assert.equal(m.id, 'cs2m-csgo_mc_1');
  assert.equal(m.status, 'live');
  assert.equal(m.t1.score, '1');
  assert.equal(m.maps.length, 2);
  assert.equal(m.maps[0].name, 'Ancient');
  assert.equal(m.prob1, 63);
  assert.equal(m.prob2, 37);
});

test('extractCs2 过滤掉未开始的对局', () => {
  const json = {
    data: {
      matches: [
        cs2Raw(),
        cs2Raw({ mc_info: { id: 'csgo_mc_2', t1_info: {}, t2_info: {} }, state: { status: '0' } })
      ]
    }
  };
  const live = Live.extractCs2(json);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, 'cs2m-csgo_mc_1');
});

test('mergeCs2 更新状态并报告 statusChanged', () => {
  const entries = [{
    id: 'cs2-tt', kind: 'tournament',
    matches: [{
      id: 'cs2m-csgo_mc_1', status: 'upcoming',
      t1: { score: '0' }, t2: { score: '0' }, maps: [], prob1: null, prob2: null
    }]
  }];
  const live = [Live.mapCs2Match(cs2Raw())];
  const r = Live.mergeCs2(entries, live);
  assert.equal(r.statusChanged, true);
  assert.deepEqual(r.changed, ['cs2m-csgo_mc_1']);
  assert.equal(entries[0].matches[0].status, 'live');
  assert.equal(entries[0].matches[0].t1.score, '1');
  assert.equal(entries[0].matches[0].maps.length, 2);
});

test('mergeCs2 只变比分时 statusChanged 为 false', () => {
  const entries = [{
    id: 'cs2-tt', kind: 'tournament',
    matches: [{
      id: 'cs2m-csgo_mc_1', status: 'live',
      t1: { score: '1' }, t2: { score: '0' }, maps: [], prob1: 63, prob2: 37
    }]
  }];
  const raw = cs2Raw();
  raw.state.t1_score = '2';
  raw.state.t2_score = '1';
  const r = Live.mergeCs2(entries, [Live.mapCs2Match(raw)]);
  assert.equal(r.statusChanged, false);
  assert.equal(r.changed.length, 1);
  assert.equal(entries[0].matches[0].t1.score, '2');
});

test('mapLolEvent 与 mergeLol 按队名/代码更新比分', () => {
  const ev = {
    state: 'inProgress',
    match: {
      id: '123456',
      teams: [
        { code: 'GEN', name: 'Gen.G', result: { gameWins: 1 } },
        { code: 'IG', name: 'Invictus Gaming', result: { gameWins: 0 } }
      ]
    }
  };
  const live = Live.mapLolEvent(ev);
  assert.equal(live.id, 'lol-123456');
  assert.equal(live.status, 'live');

  const entries = [{
    id: 'lol-123456', game: 'lol', kind: 'fixture', status: 'upcoming',
    teams: [
      { name: 'Gen.G', code: 'GEN', score: '' },
      { name: 'Invictus Gaming', code: 'IG', score: '' }
    ]
  }];
  const r = Live.mergeLol(entries, [live]);
  assert.equal(r.statusChanged, true);
  assert.equal(entries[0].status, 'live');
  assert.equal(entries[0].teams[0].score, 1);
  assert.equal(entries[0].teams[1].score, 0);
});

test('未知 id 不会改动任何数据', () => {
  const entries = [{ id: 'lol-1', game: 'lol', kind: 'fixture', status: 'upcoming', teams: [] }];
  const r = Live.mergeLol(entries, [{ id: 'lol-999', status: 'live', teams: [] }]);
  assert.equal(r.changed.length, 0);
  assert.equal(r.statusChanged, false);
  assert.equal(entries[0].status, 'upcoming');
});

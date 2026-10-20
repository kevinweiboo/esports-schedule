// 数据层回归：状态机、时长、待定标记
// 运行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../scripts/normalize.mjs';

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function sample(over = {}) {
  return {
    id: 't1',
    game: 'f1',
    gameLabel: 'F1',
    league: 'Formula 1',
    title: '测试大奖赛',
    startTime: iso(now),
    durationMin: 120,
    status: 'upcoming',
    teams: [],
    ...over
  };
}

test('F1 正赛开始 30 分钟后应判为 live，而不是 completed', () => {
  const [e] = normalize([sample({ startTime: iso(now - 30 * 60000) })]);
  assert.equal(e.status, 'live');
});

test('F1 场次超过开始 + 时长后判为 completed', () => {
  const [e] = normalize([sample({ startTime: iso(now - 3 * 3600000), durationMin: 60 })]);
  assert.equal(e.status, 'completed');
});

test('有结束时间的赛事按区间判断 live / completed', () => {
  const [live] = normalize([sample({
    id: 'a', game: 'cs2', endTime: iso(now + 3600000), startTime: iso(now - 3600000), durationMin: null
  })]);
  assert.equal(live.status, 'live');

  const [done] = normalize([sample({
    id: 'b', game: 'cs2', endTime: iso(now - 60000), startTime: iso(now - 7200000), durationMin: null
  })]);
  assert.equal(done.status, 'completed');
});

test('未到开始时间保持 upcoming', () => {
  const [e] = normalize([sample({ startTime: iso(now + 3600000) })]);
  assert.equal(e.status, 'upcoming');
});

test('双方 TBD 的对局带 tbd 标记，且保留 durationMin/round', () => {
  const [e] = normalize([sample({
    id: 'm1', game: 'cs2', round: 18, durationMin: 120,
    matches: [{
      id: 'mm1', time: iso(now + 3600000), bo: 3, stage: '小组赛',
      t1: { name: 'TBD', logo: '', score: '' },
      t2: { name: 'TBD', logo: '', score: '' },
      status: 'upcoming'
    }]
  })]);
  assert.equal(e.matches[0].tbd, true);
  assert.equal(e.round, 18);
  assert.equal(e.durationMin, 120);
});

test('已知队伍的对局 tbd 为 false', () => {
  const [e] = normalize([sample({
    id: 'm2', game: 'cs2',
    matches: [{
      id: 'mm2', time: iso(now), bo: 3, stage: '小组赛',
      t1: { name: 'NAVI', logo: '', score: '2' },
      t2: { name: 'G2', logo: '', score: '1' },
      status: 'completed'
    }]
  })]);
  assert.equal(e.matches[0].tbd, false);
});

test('地图比分、赛前胜率与数据外链原样透传', () => {
  const [e] = normalize([sample({
    id: 'm3', game: 'cs2',
    matches: [{
      id: 'mm3', time: iso(now), bo: 3, stage: '淘汰赛',
      t1: { name: 'NAVI', logo: '', score: '2' },
      t2: { name: 'G2', logo: '', score: '1' },
      maps: [
        { name: 'Ancient', t1: '13', t2: '10', result: 't1', status: 2 },
        { name: 'Dust2', t1: '13', t2: '8', result: 't1', status: 2 }
      ],
      prob1: 67,
      prob2: 33,
      sourceUrl: 'https://event.5eplay.com/csgo/matches/csgo_mc_1',
      status: 'completed'
    }]
  })]);
  assert.equal(e.matches[0].maps.length, 2);
  assert.deepEqual(e.matches[0].maps[0], { name: 'Ancient', t1: '13', t2: '10', result: 't1', status: 2 });
  assert.equal(e.matches[0].prob1, 67);
  assert.equal(e.matches[0].prob2, 33);
  assert.equal(e.matches[0].sourceUrl, 'https://event.5eplay.com/csgo/matches/csgo_mc_1');
});

test('缺失的胜率不会被 Number("") 变成 0', () => {
  const [e] = normalize([sample({
    id: 'm4', game: 'cs2',
    matches: [{
      id: 'mm4', time: iso(now), bo: 3, stage: '小组赛',
      t1: { name: 'A', logo: '', score: '' },
      t2: { name: 'B', logo: '', score: '' },
      prob1: '',
      prob2: null,
      status: 'upcoming'
    }]
  })]);
  assert.equal(e.matches[0].prob1, null);
  assert.equal(e.matches[0].prob2, null);
  assert.deepEqual(e.matches[0].maps, []);
});

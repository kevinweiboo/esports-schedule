// 赛事范围配置 —— 想调整关注范围，基本只需要改这个文件

// 抓取的时间窗口（相对当前时间）
export const WINDOW = {
  pastDays: 30,   // 保留最近 30 天已结束的赛事（赛事级数据跨周，窗口太小会漏）
  futureDays: 180 // 向前抓取 180 天
};

// ---------- 英雄联盟 ----------
// 当前只要 LPL 和 LCK。
// 想加 S 赛 / MSI / First Stand，往数组里追加 slug 即可：'worlds', 'msi', 'first_stand'
// 可用 slug 可运行 `node scripts/sources/lol.mjs --leagues` 查看
export const LOL_LEAGUES = ['lpl', 'lck'];

// ---------- CS2（数据源：5eplay）----------
// https://event.5eplay.com/csgo/events 的赛事分级码表
// 只保留 Major(1)、S+(7)、S级(2) 三个级别
export const CS_GRADES = ['1', '7', '2'];
export const CS_GRADE_LABEL = { '1': 'Major', '7': 'S+', '2': 'S级' };

// ---------- 瓦洛兰特（数据源：号角）----------
// https://web.haojiao.cc/wiki/wiki_home/t2Ud5pOQlscKLbRC
// 只保留 VCT（冠军巡回赛）下的：CN 联赛、大师赛、全球冠军赛
export const VAL_SERIES_NAME = '冠军巡回赛';
export const VAL_GROUP_PATTERNS = [
  { re: /^CN联赛/, tier: 'regional', label: 'VCT CN' },
  { re: /大师赛/, tier: 'international', label: '大师赛' },
  { re: /全球冠军赛/, tier: 'international', label: '冠军赛' }
];

// ---------- F1 ----------
// 抓取哪个赛季。留空则跟随当前年份。
export const F1_SEASON = '';

// ---------- 数据源凭证 ----------
// 两者都取自对方前端里公开的常量，没有账号成本。
// 如果把仓库设为公开又不想明文放在代码里，可以设环境变量（或仓库 Secrets）覆盖，
// 不设就用下面的默认值。
// 英雄联盟：Riot 的社区公开 key（多年来被第三方工具广泛使用）
export const RIOT_API_KEY = process.env.RIOT_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

// 号角接口签名所需（取自其前端 JS 的公开常量）
export const HAOJIAO_SECRET = process.env.HAOJIAO_SECRET || 'N61P#=Pf$yz=fwFZa)U8';
export const HAOJIAO_VERSION = '1.52.159';
export const HAOJIAO_GAME_ID = 't2Ud5pOQlscKLbRC';

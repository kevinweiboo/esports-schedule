# 综合赛事时间表

一张表看完英雄联盟、瓦洛兰特、CS2、F1 的赛程。**不需要任何 API key / token。**

想分享给别人？见 [DEPLOY.md](DEPLOY.md)（部署成网址 / 打包发人 / 局域网共享）。

## 关注范围

| 项目 | 范围 | 数据源 |
|---|---|---|
| 英雄联盟 | LPL、LCK | Riot esports API（社区公开 key） |
| 瓦洛兰特 | VCT CN 联赛 + 大师赛 + 全球冠军赛 | 号角（web.haojiao.cc） |
| CS2 | 仅 S级 / S+ / Major 三个级别 | 5eplay（event.5eplay.com） |
| F1 | 全赛季各 session（练习 / 排位 / 冲刺 / 正赛） | Jolpica（Ergast 兼容） |

改关注范围只需要动 [`scripts/config.mjs`](scripts/config.mjs)：

- 加 S 赛 / MSI → `LOL_LEAGUES` 里追加 `'worlds'`、`'msi'`
- 改 CS2 级别 → `CS_GRADES`（默认 `'1'`=Major、`'7'`=S+、`'2'`=S级）
- 改瓦洛兰特赛事 → `VAL_SERIES_NAME` / `VAL_GROUP_PATTERNS`

## 使用

**双击 `启动服务.bat`** —— 起服务 + 自动打开浏览器；**关掉网页，服务在 2 秒内自动退出**，不留后台进程。

窗口会显示服务日志，出错不会一闪而过（末尾有 `pause`）。若浏览器没自动弹出，看窗口里打印的地址，手动访问 `http://localhost:8080` 即可。

命令行方式：

```bash
node scripts/serve.mjs              # 启动并自动打开浏览器，网页关闭后自动退出
node scripts/serve.mjs --keep       # 常驻（不自动退出），适合调试 / 定时任务
node scripts/serve.mjs --no-open    # 不自动打开浏览器
node scripts/fetch.mjs              # 只抓取数据，不起服务
```

也可以直接双击 `index.html`（页面通过 `<script src="data/schedule.js">` 读数据，`file://` 下同样能看，只是「更新」按钮不会重新抓取）。

### 服务为什么会自动退出

页面每 5 秒给本地服务发一次心跳（`/api/ping`）。服务发现没有任何网页在心跳，就自己退出：

- 正常关闭标签页 → 页面发 `/api/bye`，**约 2 秒**后退出
- 浏览器崩溃 / 直接断电 → 心跳断掉，**约 15 秒**后退出
- 启动后两分钟内没有任何网页打开 → 也会自动退出
- 开多个标签页时，全部关掉才退出

### 更新按钮

页面右上角的**「更新」**按钮就是刷新入口，不设自动刷新。

- 通过 `serve.mjs` 打开（http）→ 点更新会**真的跑一次抓取**，几秒后自动刷新列表
- 直接双击打开（file）→ 按钮只能重新载入已生成的数据文件；要重新抓取就在项目目录执行 `node scripts/fetch.mjs`

### 可选：定时自动抓取

默认是手动更新。如果想让它自己跑：

- **Windows 计划任务**（每 30 分钟，需电脑开着）：`.\install-task.ps1`
- **GitHub Actions**（`.github/workflows/refresh.yml`，全天有效）：改 cron 后推送即可

## 目录说明

```
index.html              单文件页面（内联 CSS + JS，零构建）
data/schedule.json      抓取结果，供其他程序复用
data/schedule.js        同样数据的 JS 包装，供页面 file:// 直接加载
data/meta.json          更新时间、各数据源状态
scripts/fetch.mjs       主抓取入口
scripts/config.mjs      关注范围配置
scripts/normalize.mjs   统一 schema 与分类
scripts/serve.mjs       零依赖本地服务 + /api/refresh
scripts/sources/        四个数据源模块，每个都能单独运行调试
```

单独调试某个数据源：

```bash
node scripts/sources/lol.mjs             # 英雄联盟
node scripts/sources/lol.mjs --leagues   # 列出全部可用联赛 slug
node scripts/sources/valorant.mjs        # 瓦洛兰特（号角）
node scripts/sources/cs2.mjs             # CS2（5eplay）
node scripts/sources/f1.mjs              # F1（Jolpica）
```

## 两个中文数据源的接口说明

这两个站都是纯前端渲染，接口不在公开文档里，逆向过程记录在此，方便以后排错。

**5eplay**（无需鉴权）

赛事级（起止区间）：
```
POST https://app.5eplay.com/api/csgo/tournament/csgo_event_list_v1
Content-Type: application/json
{"tournaments_options":{"grade":["1","7","2"],"page_token":"","cursor":"",
 "time_value":null,"time_type":null,"player_id":"","team_id":"","tt_series":[],"tt_bonus":[]}}
```
- `grade` 分级码：`1`=Major、`7`=S+、`2`=S级、`3`=A级、`9`=资格赛A级、`8`=表演赛、`4`=B级、`6`=资格赛B级、`5`=C级、`10`=资格赛C级、`0`=其他
- 返回的 `start_time` / `end_time` 是**北京时间**（无时区后缀），需补 `+08:00`

比赛级（具体每场对局，https://event.5eplay.com/csgo/matches 页面用的就是它）：
```
GET https://app.5eplay.com/api/tournament/session_list
    ?game_status=<0|1|2>&game_type=1&grades=1,7,2&page=1&limit=100
```
- `game_status`：`0`=未开始的比赛、`1`=进行中赛事的比赛、`2`=已结束的比赛（含比分）；三种要分别拉取，结果有重叠需按 `mc_info.id` 去重
- `grades` 逗号分隔（如 `1,7,2`）；**按时间倒序**返回，翻到早于窗口起点即可停
- 时间字段 `mc_info.plan_ts` 是**秒级**时间戳
- 每条含 `t1_info` / `t2_info`（队名、logo）、`state.t1_score` / `t2_score`、`format`（BO 数）、`tt_stage_desc`（阶段）、`tt_info`（所属赛事，`id` 形如 `csgo_tt_8266`，可与赛事级数据对上）

**号角**（需签名头）
```
POST https://api.haojiao.cc/wiki/api/v1/tournament/list
x-hj-version: 1.52.159
x-hj-os: web
x-hj-nonce: <10位随机串>
x-hj-timestamp: <毫秒时间戳>
x-hj-sign: SHA1("N61P#=Pf$yz=fwFZa)U8" + nonce + timestamp)
body: {"game_id":"t2Ud5pOQlscKLbRC","platform":"web","page":1,"page_size":200}
```
- `series_info.series_name === "冠军巡回赛"` 即 VCT
- `tournament_group_info.name_main` 里 `CN联赛*` = VCT CN，`大师赛` / `全球冠军赛` 为国际赛
- `start_date` / `end_date` 是毫秒时间戳

## 已知限制

- CS2 已有**具体比赛明细**（时间 / 队伍 / 比分 / BO / 阶段），在赛事卡片上点击展开；瓦洛兰特仍是赛事级区间数据（号角接口没有逐场赛程）
- 5eplay 的逐场比赛只覆盖近期（未开始的对局一般只放出几天内的），远期赛事只有起止区间
- 抓取窗口默认最近 30 天 + 未来 180 天，改 `config.mjs` 的 `WINDOW`
- 「进行中」由起止时间推断，卡片上的比分在点「更新」后刷新

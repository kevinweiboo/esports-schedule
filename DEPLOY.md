# 分享给别人

三种方式，按推荐顺序：

| 方式 | 别人怎么用 | 数据更新 | 代价 |
|---|---|---|---|
| **部署成网址**（GitHub Pages / Vercel） | 打开一个链接 | 服务器每 30 分钟自动更新 | 需要一个 Git 仓库，首次配置 10 分钟 |
| **打包 zip 发人** | 解压后双击 `index.html` | 快照，要更新得重发 | 零配置，立即可用 |
| **局域网共享** | 同一 WiFi 下访问 `http://你的IP:8080` | 实时（你在电脑上点更新） | 你电脑要一直开着 |

---

## 方式一：部署成网址（推荐）

### 第 1 步：在 GitHub 上新建一个空仓库

打开 https://github.com/new ，填仓库名（比如 `esports-schedule`），选 **Public**，**不要**勾选任何初始化选项（不要 README / .gitignore），直接 Create repository。

> 免费版 GitHub Pages 只对 Public 仓库开放。

### 第 2 步：把本地项目推上去

**本地仓库已经建好了**（`git init` + 首次提交已完成，`main` 分支）。你只需要双击项目里的 **`发布到GitHub.bat`**：

1. 弹出窗口按回车 → 浏览器打开 → 输入一次性代码 → 点 Authorize
2. 脚本自动建仓库、推送、开启 Pages
3. 结尾会打印访问地址

想手动做也可以，在项目目录执行（把 `<用户名>` 和 `<仓库名>` 换成你自己的）：

```bash
cd "D:/科研/草稿/赛事网站"

gh auth login -h github.com -p https -w     # 浏览器授权，不需要密码
gh repo create esports-schedule --public --source=. --push
```

或者不用 gh：

```bash
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

> 不需要把 GitHub 账号密码交给任何人。`gh auth login` 走的是浏览器 OAuth，凭证只存在你自己电脑里。

### 第 3 步：开启 GitHub Pages

仓库页面 → **Settings** → 左侧 **Pages** → **Build and deployment**：

- Source 选 **Deploy from a branch**
- Branch 选 **main**，文件夹选 **/ (root)**
- 点 **Save**

等 1～2 分钟，页面顶部会出现访问地址：

```
https://<用户名>.github.io/<仓库名>/
```

这个链接直接发给别人就行，手机电脑都能开。

### 第 4 步：确认定时更新在跑

仓库 → **Actions** 标签，应该能看到 `Refresh schedule` 工作流。

- 默认 **每 30 分钟**跑一次，抓完新数据会自动 commit，Pages 随后自动重新部署
- 也可以点 **Run workflow** 手动触发一次
- 想改频率：编辑 `.github/workflows/refresh.yml` 里的 `cron`

### 可选：换成 Vercel（国内通常更快）

GitHub Pages 在国内访问时快时慢。想更稳可以用 Vercel，它直接吃同一个 GitHub 仓库：

1. 打开 https://vercel.com ，用 GitHub 登录
2. **Add New → Project → Import** 你的仓库
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 都**留空**
4. Deploy

之后每次 Actions 更新数据，Vercel 都会自动重新部署。同理也可用 Cloudflare Pages。

---

## 方式二：打包 zip 发给别人

```bash
cd "D:/科研/草稿/赛事网站"
# 只需要这两个：网页 + 数据
```

把 `index.html` 和 `data/` 两个东西打包成 zip 发过去（**注意 `data` 文件夹要和 `index.html` 放在一起**）。

对方解压后双击 `index.html` 就能看，不需要装任何东西。

- 数据是你打包那一刻的快照
- 对方点「更新」只会重新载入本地文件；要更新数据得你重新抓一次再发一遍

---

## 方式三：局域网共享

适合办公室 / 实验室同一个 WiFi 的场景：

```bash
node scripts/serve.mjs --keep
```

然后查自己电脑的 IP（命令行 `ipconfig`，找 IPv4 地址，比如 `192.168.1.23`），让别人访问：

```
http://192.168.1.23:8080
```

你电脑得一直开着，`--keep` 表示不自动退出。

---

## 部署后的几个注意点

- **静态部署下「更新」按钮会变成「检查更新」**：GitHub Pages / Vercel 上没有后端，页面检测到没有本地服务后会自动切换，并且每 10 分钟自动检查一次数据文件有没有更新。真正的抓取由 GitHub Actions 负责。
- **公开仓库会暴露 `scripts/config.mjs` 里的接口常量**：那是两个站点前端里的公开值（Riot 社区 key、号角签名 secret），不是你的账号密码。如果你介意，在仓库 **Settings → Secrets and variables → Actions** 里新建 `RIOT_API_KEY` 和 `HAOJIAO_SECRET` 两个 Repository secret，然后把 `config.mjs` 里的默认值删掉即可（脚本会优先读环境变量）。
- **GitHub Actions 在美国 IP 上跑**：5eplay、号角偶尔会对境外 IP 返回失败。脚本设计成「某个源失败就保留上次的数据」，所以最坏情况是数据暂时不更新，不会让页面变空。
- **仓库长时间没动静，GitHub 会暂停定时任务**：超过 60 天无任何提交时，Actions 的 schedule 会被自动禁用，届时手动点一次 Run workflow 即可恢复。

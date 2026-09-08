// 零依赖本地静态服务：node scripts/serve.mjs  →  http://localhost:8080
// 除了静态文件，还暴露 POST /api/refresh，供页面上的「更新」按钮真正触发一次抓取。
// 直接双击 index.html 也能用，只是更新按钮会退化为「重新载入本地数据」。

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn, exec, execSync } from 'node:child_process';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);

// 页面每 5 秒发一次心跳；所有页面都关掉后服务自动退出，不留后台进程
// 想要常驻就加 --keep
const AUTO_STOP = !process.argv.includes('--keep') && process.env.KEEP_ALIVE !== '1';
const IDLE_MS = 15000;    // 收到过心跳后，断连多久算退出
const GRACE_MS = 120000;  // 启动后一直没人开网页的宽限时间

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

let refreshing = false;

// ---- 页面心跳：网页开着服务才活着 ----
const clients = new Map();   // clientId -> 最后一次心跳时间
const startedAt = Date.now();
let lastSeenAt = 0;

function shutdown(msg) {
  clearInterval(watchdog);
  console.log('\n' + msg);
  process.exit(0);
}

const watchdog = setInterval(() => {
  if (!AUTO_STOP || refreshing) return;
  const now = Date.now();
  for (const [id, t] of clients) if (now - t > IDLE_MS) clients.delete(id);
  if (clients.size) return;
  const idleFor = now - (lastSeenAt || startedAt);
  if (idleFor > (lastSeenAt ? IDLE_MS : GRACE_MS)) {
    shutdown(lastSeenAt ? '网页已关闭，服务自动退出。' : '两分钟内没有网页打开，服务自动退出。');
  }
}, 3000);

function qid(req) {
  return new URL(req.url, 'http://localhost').searchParams.get('id') || 'anon';
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 页面上的「更新」按钮会打到这里，真正跑一次抓取
function runFetch() {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'fetch.mjs')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) ok(out);
      else fail(new Error((err || out || '').trim().split('\n').slice(-3).join(' ') || `退出码 ${code}`));
    });
  });
}

function totalCount() {
  return readFile(join(ROOT, 'data', 'meta.json'), 'utf8').then((t) => JSON.parse(t).total);
}

async function handler(req, res) {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (p === '/api/refresh' && req.method === 'POST') {
      if (refreshing) {
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '抓取正在进行中' }));
        return;
      }
      refreshing = true;
      try {
        await runFetch();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, total: await totalCount() }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      } finally {
        refreshing = false;
      }
      return;
    }

    // 页面心跳：证明还有网页开着
    if (p === '/api/ping') {
      const id = qid(req);
      clients.set(id, Date.now());
      lastSeenAt = Date.now();
      json(res, 200, { ok: true, clients: clients.size });
      return;
    }

    // 页面关闭时主动告别（sendBeacon），无需等心跳超时
    if (p === '/api/bye') {
      clients.delete(qid(req));
      json(res, 200, { ok: true });
      if (AUTO_STOP && !clients.size && !refreshing) {
        setTimeout(() => {
          if (!clients.size && !refreshing) shutdown('网页已关闭，服务自动退出。');
        }, 1500);
      }
      return;
    }

    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p));
    if (!file.startsWith(ROOT + sep) && file !== ROOT) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

const URL_HOME = `http://localhost:${PORT}`;

// 打开默认浏览器。Windows 上 start / rundll32 有时静默失败，按顺序多试几种
function openBrowser() {
  if (process.argv.includes('--no-open')) return false;
  if (process.platform === 'win32') {
    // 最后兜底：写个临时 VBS，用 WScript.Shell 打开（最贴近双击的行为）
    const vbs = join(tmpdir(), 'esports-open-url.vbs');
    try {
      writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${URL_HOME}"`);
    } catch { /* 写不了就跳过这条 */ }
    const tries = [
      `rundll32.exe url.dll,FileProtocolHandler "${URL_HOME}"`,
      `powershell -NoProfile -Command "Start-Process '${URL_HOME}'"`,
      `explorer.exe "${URL_HOME}"`,
      `cmd /c start "" "${URL_HOME}"`,
      `cscript //nologo "${vbs}"`
    ];
    for (const cmd of tries) {
      try { execSync(cmd, { stdio: 'ignore', timeout: 5000 }); return true; } catch {}
    }
    return false;
  }
  const tries = process.platform === 'darwin'
    ? [`open "${URL_HOME}"`]
    : [`xdg-open "${URL_HOME}"`, `sensible-browser "${URL_HOME}"`];
  for (const cmd of tries) {
    try { execSync(cmd, { stdio: 'ignore', timeout: 5000 }); return true; } catch {}
  }
  return false;
}

const server = createServer(handler);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 端口已被占用 ≈ 服务已经在跑，直接把页面打开就行
    console.log(`端口 ${PORT} 已被占用，服务应该已经在运行。`);
    console.log(`若页面没自动打开，请访问：${URL_HOME}`);
    openBrowser();
    process.exit(0);
  }
  console.error('服务启动失败：', e.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`赛事时间表：${URL_HOME}`);
  console.log(AUTO_STOP ? '网页全部关闭后会自动退出（加 --keep 可常驻）。' : '常驻模式（--keep）。');
  if (openBrowser()) console.log('已尝试打开浏览器。');
  else if (!process.argv.includes('--no-open')) console.log(`浏览器没能自动打开，请手动访问：${URL_HOME}`);
});

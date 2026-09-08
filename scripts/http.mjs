// 带超时与重试的 JSON 请求封装（Node 18+ 原生 fetch，零依赖）

const UA = 'EsportsSchedule/1.0 (personal local dashboard)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { headers = {}, timeout = 20000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// POST JSON
export async function postJson(url, body, { headers = {}, timeout = 25000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          ...headers
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// 时间窗口边界，返回 ISO 字符串
export function windowBounds({ pastDays, futureDays }) {
  const now = Date.now();
  const day = 86400000;
  return {
    from: new Date(now - pastDays * day).toISOString(),
    to: new Date(now + futureDays * day).toISOString()
  };
}

export function iso(dt) {
  return new Date(dt).toISOString();
}

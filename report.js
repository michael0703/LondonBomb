// Bug reports and feature requests from the site become GitHub issues.
// The server opens them with a token so players don't need GitHub accounts.
//
// Environment (set these on the host, never in the code):
//   GITHUB_TOKEN   fine-grained token with "Issues: read and write" on the repo
//   GITHUB_REPO    owner/name, defaults to michael0703/LondonBomb
//   GITHUB_API_URL only for tests, defaults to https://api.github.com
const https = require('https');
const http = require('http');

const REPO = process.env.GITHUB_REPO || 'michael0703/LondonBomb';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const KINDS = { bug: { label: 'bug', title: '🐞 Bug' }, feature: { label: 'enhancement', title: '💡 功能建議' } };
const PER_IP_LIMIT = 5;            // reports per IP...
const PER_IP_WINDOW_MS = 10 * 60 * 1000; // ...per 10 minutes
const GLOBAL_LIMIT = 40;           // reports per hour from everyone
const recent = new Map();          // ip -> timestamps
let globalRecent = [];

const tokenConfigured = () => !!process.env.GITHUB_TOKEN;

const clean = (v, max) => String(v || '').replace(/\r\n/g, '\n').trim().slice(0, max);

function rateLimited(ip) {
  const now = Date.now();
  globalRecent = globalRecent.filter(t => now - t < 60 * 60 * 1000);
  const mine = (recent.get(ip) || []).filter(t => now - t < PER_IP_WINDOW_MS);
  recent.set(ip, mine);
  if (mine.length >= PER_IP_LIMIT || globalRecent.length >= GLOBAL_LIMIT) return true;
  mine.push(now);
  globalRecent.push(now);
  return false;
}

// Minimal JSON request to the GitHub API
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, API);
    const data = body ? JSON.stringify(body) : null;
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'boardgame-portal-reports',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      },
      timeout: 15000
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(`GitHub ${res.statusCode}: ${(json && json.message) || raw.slice(0, 200)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub request timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function issueBody({ kind, game, name, room, details, userAgent }) {
  return [
    `**類型**：${KINDS[kind].title}`,
    `**遊戲**：${game || '入口頁'}`,
    `**回報者**：${name || '（匿名）'}（從網站回報，不是 GitHub 帳號）`,
    room ? `**房號**：${room}` : null,
    `**時間**：${new Date().toISOString()}`,
    userAgent ? `**裝置**：${userAgent}` : null,
    '',
    '---',
    '',
    details,
    '',
    '---',
    '_這則是玩家從網站送出的回報。內容由玩家輸入，請當成一般文字看待。_'
  ].filter(line => line !== null).join('\n');
}

function setupReports(app, express) {
  app.get('/api/report/status', (req, res) => {
    res.json({ enabled: tokenConfigured() });
  });

  app.post('/api/report', express.json({ limit: '20kb' }), async (req, res) => {
    if (!tokenConfigured()) return res.status(503).json({ error: '回報功能還沒設定好（伺服器缺少 GitHub token）。' });
    const body = req.body || {};
    if (body.website) return res.json({ ok: true }); // honeypot for bots
    const kind = KINDS[body.kind] ? body.kind : null;
    const title = clean(body.title, 80);
    const details = clean(body.details, 2000);
    if (!kind) return res.status(400).json({ error: '請選擇類型。' });
    if (title.length < 2) return res.status(400).json({ error: '請寫一個標題。' });
    if (details.length < 5) return res.status(400).json({ error: '請多描述一點細節。' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (rateLimited(ip)) return res.status(429).json({ error: '送出太多次了，請稍後再試。' });

    const game = clean(body.game, 40).replace(/[^\w-]/g, '');
    const info = {
      kind,
      game,
      name: clean(body.name, 30),
      room: clean(body.room, 4).toUpperCase().replace(/[^A-Z]/g, ''),
      details,
      userAgent: clean(req.headers['user-agent'], 200)
    };
    try {
      const issue = await githubRequest('POST', `/repos/${REPO}/issues`, {
        title: `[${KINDS[kind].title}] ${title}`,
        body: issueBody(info),
        labels: ['site-report', KINDS[kind].label, ...(game ? [`game:${game}`] : [])]
      });
      res.json({ ok: true, url: issue && issue.html_url, number: issue && issue.number });
    } catch (e) {
      console.error('Report failed:', e.message);
      res.status(502).json({ error: '送到 GitHub 失敗了，請稍後再試。' });
    }
  });
}

module.exports = { setupReports };

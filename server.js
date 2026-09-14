'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const app  = express();
const PORT = process.env.PORT || 10000;
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* =========================================================
   1) COOKIES  ->  YTDLP_COOKIES_B64  ឬ  YTDLP_COOKIES_FILE
   ========================================================= */
/* =========================================================
   1) COOKIES  ->  YTDLP_COOKIES_B64  ឬ  YTDLP_COOKIES_FILE
   (ស្គាល់ទាំង Netscape និង JSON — បំប្លែងដោយស្វ័យប្រវត្តិ)
   ========================================================= */

// បំប្លែង JSON (Cookie-Editor / EditThisCookie ...) -> Netscape
function toNetscape(jsonText) {
  let arr;
  try { arr = JSON.parse(jsonText); } catch (_) { return null; }
  if (!Array.isArray(arr)) {
    if (arr && Array.isArray(arr.cookies)) arr = arr.cookies;
    else return null;
  }
  const lines = ['# Netscape HTTP Cookie File', '# Converted by PECH server'];
  for (const c of arr) {
    const domain = c.domain || c.host || '';
    const name   = c.name   || '';
    const value  = c.value  || '';
    if (!domain || !name) continue;
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const cpath      = c.path || '/';
    const secure     = c.secure ? 'TRUE' : 'FALSE';
    let exp = Number(c.expirationDate || c.expires || 0);
    if (!Number.isFinite(exp) || exp <= 0) exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    exp = Math.floor(exp);
    lines.push([domain, includeSub, cpath, secure, exp, name, value].join('\t'));
  }
  const out = lines.join('\n') + '\n';
  console.log('🍪 Converted ' + (lines.length - 2) + ' JSON cookies -> Netscape');
  return out;
}

let COOKIE_FILE = null;

(function initCookies() {
  // (A) Render Secret File
  const secret = process.env.YTDLP_COOKIES_FILE;
  if (secret && fs.existsSync(secret)) {
    COOKIE_FILE = secret;
    console.log('🍪 Cookies: loaded from secret file ->', secret);
    return;
  }

  // (B) Env var base64
  const b64 = process.env.YTDLP_COOKIES_B64;
  if (b64 && b64.trim()) {
    try {
      let text = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8');
      text = text.replace(/^\uFEFF/, '');          // លុប BOM
      const trimmed = text.trim();

      let out = text;
      if (trimmed.startsWith('#')) {
        console.log('🍪 Cookies: Netscape format detected');
      } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const conv = toNetscape(trimmed);
        if (conv) out = conv;
        else console.log('🍪 Cookies: JSON parse failed — using raw');
      } else {
        console.log('🍪 Cookies: unknown format — using raw');
      }

      const p = path.join(os.tmpdir(), 'pech-cookies.txt');
      fs.writeFileSync(p, out);
      COOKIE_FILE = p;

      // ជួយ debug៖ បង្ហាញជួរទី១ ៗ ប៉ុណ្ណោះ (មិនលេចខ្លឹមសារ cookie)
      const firstLine = out.split('\n')[0].slice(0, 60);
      const lineCount = out.split('\n').filter(Boolean).length;
      console.log('🍪 Cookie file: "' + firstLine + '" (' + lineCount + ' lines)');
    } catch (e) {
      console.error('🍪 Cookie write failed:', e.message);
    }
  }

  if (!COOKIE_FILE) console.log('🍪 Cookies: NONE (yt-dlp អាចជួប bot check)');
})();

/* =========================================================
   2) yt-dlp version (សម្រាប់ /api/health)
   ========================================================= */
let YTDLP_VERSION = 'unknown';
(function loadVersion() {
  const p = spawn(YTDLP, ['--version']);
  let out = '';
  p.stdout.on('data', d => { out += d.toString(); });
  p.on('close', () => { YTDLP_VERSION = out.trim() || 'unknown'; console.log('🎬 yt-dlp', YTDLP_VERSION); });
  p.on('error', () => { YTDLP_VERSION = 'not-found'; });
})();

/* =========================================================
   3) base args  (✅ array មិនមែន function parameter)
   ========================================================= */
function baseArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-cache-dir',
    '--socket-timeout', '20',
    '--retries', '3',
  ];

  // 🎯 hardcoded: local testing proved mweb works, tv+cookies fails
  args.push('--extractor-args', 'youtube:player_client=mweb');

  // cookies disabled on purpose (they break every client)
  // if (COOKIE_FILE) args.push('--cookies', COOKIE_FILE);

  if (process.env.FFMPEG_LOCATION) args.push('--ffmpeg-location', process.env.FFMPEG_LOCATION);

  return args;
}

/* =========================================================
   4) runYtdlp + serialize (រត់ម្ដងមួយដើម្បីការពារ RAM)
   ========================================================= */
function runYtdlp(extraArgs, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const args  = baseArgs().concat(extraArgs);
    const child = spawn(YTDLP, args, { windowsHide: true });
    let stdout = '', stderr = '', done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error('yt-dlp timeout after ' + timeoutMs + ' ms'));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (done) return; done = true; clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

let _chain = Promise.resolve();
function serialize(task) {
  const run = _chain.then(task, task);
  _chain = run.catch(() => {});
  return run;
}

/* =========================================================
   5) /api/health
   ========================================================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    ytdlp: YTDLP_VERSION,
    cookies: false,
    player_client: 'mweb',

  });
});

/* =========================================================
   6) /api/extract  (ដក link ចេញពី text)
   ========================================================= */
const PLATFORMS = [
  ['youtube',   /(youtube\.com|youtu\.be)/i],
  ['facebook',  /(facebook\.com|fb\.watch)/i],
  ['tiktok',    /tiktok\.com/i],
  ['instagram', /instagram\.com/i],
  ['twitter',   /(twitter\.com|x\.com)/i],
];

function detectPlatform(u) {
  for (const [name, re] of PLATFORMS) if (re.test(u)) return name;
  return 'other';
}

app.post('/api/extract', (req, res) => {
  const text = String((req.body && req.body.text) || '');
  const found = text.match(/https?:\/\/[^\s"'<>)]+/g) || [];
  const seen = new Set();
  const items = [];
  for (let u of found) {
    u = u.replace(/[.,;!?]+$/, '');
    if (seen.has(u)) continue;
    seen.add(u);
    items.push({ url: u, platform: detectPlatform(u) });
  }
  res.json({ count: items.length, items });
});

/* =========================================================
   7) /api/info
   ========================================================= */
app.get('/api/info', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing url' });
  try {
    const r = await serialize(() => runYtdlp(['-J', url], 60000));
    if (r.code !== 0) {
      return res.status(500).json({ error: 'yt-dlp failed', detail: r.stderr.slice(-800) });
    }
    const line = r.stdout.trim().split('\n').filter(Boolean).pop();
    const j = JSON.parse(line);
    res.json({
      title: j.title,
      uploader: j.uploader || j.channel,
      duration: j.duration,
      thumbnail: j.thumbnail,
      webpage_url: j.webpage_url,
      platform: detectPlatform(url),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================
   8) /api/proxy  (stream file ตรง ๆ)
   ========================================================= */
app.get('/api/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'missing url' });
  try {
    const r = await fetch(target, {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept': '*/*' },
    });
    res.status(r.status);
    for (const h of ['content-type', 'content-length', 'content-disposition', 'accept-ranges']) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================
   9) /api/download  (yt-dlp ពិត -> stream មក client)
   ========================================================= */
app.get('/api/download', async (req, res) => {
  const url  = req.query.url;
  const mode = req.query.mode === 'audio' ? 'audio' : 'video';
  let   maxh = parseInt(req.query.maxh, 10);
  if (!Number.isFinite(maxh) || maxh < 144) maxh = 720;

  if (!url) return res.status(400).json({ error: 'missing url' });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pech-'));
  const tpl    = path.join(tmpDir, 'pech-media.%(ext)s');

  const fmt = mode === 'audio'
    ? ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
    : ['-f', `bv*[ext=mp4][height<=${maxh}]+ba[ext=m4a]/b[ext=mp4][height<=${maxh}]/b[ext=mp4]/b`,
       '--merge-output-format', 'mp4'];

  const args = ['--no-simulate', '--print', 'after_move:filepath', '-o', tpl]
    .concat(fmt, [url]);

  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  };
  res.on('close', cleanup);

  let result;
  try {
    result = await serialize(() => runYtdlp(args, 15 * 60 * 1000));
  } catch (e) {
    cleanup();
    return res.status(500).json({ error: 'download failed', detail: e.message });
  }

  if (result.code !== 0) {
    cleanup();
    return res.status(500).json({ error: 'yt-dlp failed', detail: result.stderr.slice(-900) });
  }

  // រក file ដែលទាញរួច
  let filePath = result.stdout.trim().split('\n').filter(Boolean).pop() || '';
  if (!filePath || !fs.existsSync(filePath)) {
    const files = fs.readdirSync(tmpDir).filter(f => !f.endsWith('.part'));
    if (!files.length) {
      cleanup();
      return res.status(500).json({ error: 'file not produced', detail: result.stderr.slice(-500) });
    }
    filePath = path.join(tmpDir, files[0]);
  }

  const fname = path.basename(filePath);
  console.log('⬇️  sending', fname, '(' + fs.statSync(filePath).size + ' bytes)');

  res.download(filePath, fname, err => {
    if (err) console.error('send error:', err.message);
    cleanup();
  });
});

/* =========================================================
   10) root
   ========================================================= */
app.get('/', (req, res) => {
  res.type('text/plain').send('PECH-TOOL API is running. Try /api/health');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('PECH-TOOL API on port ' + PORT);
});

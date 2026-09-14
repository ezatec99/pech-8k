/* =========================================================
   PECH-TOOL API  •  server.js  (Express + CORS + yt-dlp)
   ========================================================= */
'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 10000;

const YTDLP  = process.env.YTDLP_BIN  || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_BIN || '';   // '' = auto

app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* ---------- cookies (ស្រេចចិត្ត — មើលចំណុចខាងក្រោម) ---------- */
let COOKIE_FILE = null;
if (process.env.YTDLP_COOKIES_B64) {
  try {
    COOKIE_FILE = path.join(os.tmpdir(), 'pech-cookies.txt');
    fs.writeFileSync(COOKIE_FILE,
      Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64').toString('utf8'));
    console.log('[boot] cookies loaded');
  } catch (e) { console.error('[boot] cookie fail:', e.message); }
}

/* ---------- helpers ---------- */
function baseArgs() {
  const a = [
    '--no-playlist', '--no-warnings', '--no-cache-dir',
    '--socket-timeout', '20', '--retries', '3',
  ];
  if (COOKIE_FILE) a.push('--cookies', COOKIE_FILE);
  if (FFMPEG)      a.push('--ffmpeg-location', FFMPEG);
  return a;
}

function runYtdlp(extra = [], timeoutMs = 60000) {
  return new Promise((resolve) => {
    const p = spawn(YTDLP, [...baseArgs(), ...extra]);
    let out = '', err = '';
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, stdout: out, stderr: err + '\n' + e.message }); });
    p.on('close', c => { clearTimeout(t); resolve({ code: c, stdout: out, stderr: err }); });
  });
}

/* រត់ทีละដំណើរការ (កាត់បន្ថយ RAM) */
let chain = Promise.resolve();
function serialize(task) {
  const r = chain.then(task, task);
  chain = r.then(() => {}, () => {});
  return r;
}

function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

/* =======================  ENDPOINTS  ======================= */

/* 1) health */
app.get('/api/health', async (req, res) => {
  const v = await runYtdlp(['--version'], 15000);
  res.json({
    status : 'ok',
    time   : new Date().toISOString(),
    ytdlp  : v.code === 0 ? v.stdout.trim() : 'NOT INSTALLED',
    cookies: !!COOKIE_FILE,
  });
});

/* 2) extract links ពី text */
const URL_RE = /https?:\/\/[^\s<>"'\)\]]+/gi;
app.post('/api/extract', (req, res) => {
  const text = String((req.body && (req.body.text || req.body.input || req.body.urls)) || '');
  const found = text.match(URL_RE) || [];
  const links = [...new Set(found.map(u => u.replace(/[.,;]+$/, '')))];
  res.json({ count: links.length, links });
});

/* 3) proxy — សម្រាប់ File ផ្ទាល់ (.mp4/.jpg/...) */
app.get('/api/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'missing url' });
  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Referer': new URL(target).origin,
      },
    });
    if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status });

    const ct  = r.headers.get('content-type') || 'application/octet-stream';
    const len = r.headers.get('content-length');
    const nm  = path.basename(new URL(target).pathname) || 'file';

    res.setHeader('Content-Type', ct);
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Content-Disposition', `attachment; filename="${nm.replace(/["\\]/g, '_')}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* 4) info — ចំណងជើង / រយៈពេល */
app.get('/api/info', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'missing url' });
  const { code, stdout, stderr } = await serialize(() => runYtdlp(['-J', url], 90000));
  if (code !== 0) return res.status(500).json({ error: 'extract failed', detail: stderr.slice(-900) });
  try {
    const j = JSON.parse(stdout);
    res.json({
      ok: true,
      title: j.title,
      uploader: j.uploader || j.channel,
      duration: j.duration,
      thumbnail: j.thumbnail,
      webpage_url: j.webpage_url,
    });
  } catch { res.status(500).json({ error: 'bad json' }); }
});

/* 5) ★ download — ទាញយកពិត ★ */
app.get('/api/download', async (req, res) => {
  const url  = req.query.url;
  const mode = String(req.query.mode || 'video').toLowerCase();
  const maxh = Math.min(Math.max(parseInt(req.query.maxh, 10) || 720, 144), 2160);

  if (!url) return res.status(400).json({ error: 'missing url' });

  const dir = path.join(os.tmpdir(), 'pech-' + crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });

  const args = ['--newline', '-o', path.join(dir, '%(title).100B.%(ext)s'),
                '--print', 'after_move:filepath', '--no-simulate'];

  if (mode === 'audio') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f',
      `bv*[ext=mp4][height<=${maxh}]+ba[ext=m4a]/b[ext=mp4][height<=${maxh}]/b[ext=mp4]/b`);
    args.push('--merge-output-format', 'mp4');
  }
  args.push(url);

  const { code, stdout, stderr } = await serialize(() => runYtdlp(args, 10 * 60 * 1000));

  if (code !== 0) {
    rmDir(dir);
    return res.status(500).json({
      error : 'yt-dlp failed',
      detail: stderr.split('\n').filter(Boolean).slice(-6).join('\n') || 'unknown',
    });
  }

  let filePath = stdout.trim().split('\n').filter(Boolean).pop();
  if (!filePath || !fs.existsSync(filePath)) {
    const files = fs.readdirSync(dir)
      .map(f => path.join(dir, f))
      .filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } })
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    filePath = files[0];
  }
  if (!filePath || !fs.existsSync(filePath)) {
    rmDir(dir);
    return res.status(500).json({ error: 'file not found after download' });
  }

  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);

  res.setHeader('Content-Type', mode === 'audio' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition',
    `attachment; filename="${name.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

  const stream = fs.createReadStream(filePath);
  res.on('close', () => rmDir(dir));
  stream.on('error', () => { rmDir(dir); res.destroy(); });
  stream.pipe(res);
});

/* 6) root */
app.get('/', (req, res) => res.json({ name: 'pech-tool-api', ok: true }));

app.listen(PORT, '0.0.0.0', () => console.log('PECH-TOOL API on port ' + PORT));

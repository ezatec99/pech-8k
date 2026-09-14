const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

// ── Health check (សម្រាប់ cron pinger កុំឱ្យ sleep) ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Extract links ចេញពី text ──
app.post('/api/extract', (req, res) => {
  const { text = '' } = req.body;
  const regex = /(https?:\/\/[^\s"'<>]+)/gi;
  const links = [...new Set(text.match(regex) || [])];
  res.json({ count: links.length, links });
});

// ── Proxy download (សម្រាប់ direct media URL) ──
app.get('/api/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing ?url=' });

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!upstream.ok) throw new Error('Upstream ' + upstream.status);

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cd = upstream.headers.get('content-disposition');
    if (cd) res.setHeader('Content-Disposition', cd);
    else res.setHeader('Content-Disposition', 'attachment; filename="download"');

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Server running on ' + PORT));

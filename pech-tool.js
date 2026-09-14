/* ============ REAL DOWNLOAD ENGINE v2 ============ */
let pechRunning = false;
let pechStop = false;

function setProgress(pct, text) {
  const fill = $('pechProgressFill');
  const txt  = $('pechProgressText');
  if (fill) fill.style.width = (pct == null ? 30 : Math.max(0, Math.min(100, pct))) + '%';
  if (txt)  txt.textContent = text || '';
}
function fmtSize(b) {
  if (!b) return '0 KB';
  return b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
}
function nameFromHeader(h) {
  if (!h) return null;
  let m = /filename\*=UTF-8''([^;]+)/i.exec(h);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
  m = /filename="?([^";]+)"?/i.exec(h);
  return m ? m[1] : null;
}
function fileNameFor(url, type) {
  const map = { 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'image/jpeg': 'jpg', 'image/png': 'png' };
  let base = 'pech-download';
  try { const u = new URL(url); base = u.pathname.split('/').filter(Boolean).pop() || u.hostname; } catch (e) {}
  base = base.replace(/[^\w.\-]+/g, '_').slice(0, 60) || 'pech-download';
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.' + (map[type] || 'mp4');
  return base;
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(href); a.remove(); }, 10000);
}
function qualityParams() {
  const el = $('pechQuality');
  const v  = el ? String(el.value) : '720';
  if (/mp3|audio|សំឡេង/i.test(v)) return { mode: 'audio', maxh: '' };
  const h = parseInt(v, 10);
  return { mode: 'video', maxh: String(isFinite(h) && h > 0 ? h : 720) };
}
async function fetchMedia(url, onProgress) {
  const { mode, maxh } = qualityParams();
  let ep = API_BASE + '/api/download?url=' + encodeURIComponent(url) + '&mode=' + mode;
  if (maxh) ep += '&maxh=' + maxh;

  const resp = await fetch(ep);
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const j = await resp.json(); msg = j.detail || j.error || msg; } catch (e) {}
    throw new Error(msg);
  }
  const type  = resp.headers.get('content-type') || 'application/octet-stream';
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (pechStop) { try { await reader.cancel(); } catch (e) {} throw new Error('បានបញ្ឈប់ដោយអ្នកប្រើ'); }
    chunks.push(value); got += value.length;
    if (onProgress) onProgress(got, total);
  }
  const name = nameFromHeader(resp.headers.get('content-disposition')) || fileNameFor(url, type);
  return { blob: new Blob(chunks, { type }), name };
}
async function downloadOne(url, i, n) {
  logMsg(`⏬ [${i + 1}/${n}] ចាប់ផ្ដើម: ${url}`);
  try {
    const { blob, name } = await fetchMedia(url, (got, total) => {
      const pct = total ? (got / total) * 100 : null;
      setProgress(pct, total ? `${fmtSize(got)} / ${fmtSize(total)}` : `ទាញយក ${fmtSize(got)}`);
    });
    saveBlob(blob, name);
    logMsg(`✅ បានរក្សាទុក: ${name} (${fmtSize(blob.size)})`);
    return true;
  } catch (e) {
    logMsg(`❌ បរាជ័យ: ${e.message}`);
    return false;
  }
}
function rowUrls() {
  const body = $('pechDownloadBody');
  if (!body) return [];
  return Array.from(body.querySelectorAll('tr')).map(tr => {
    const a = tr.querySelector('a[href^="http"]');
    if (a) return a.getAttribute('href');
    const m = tr.textContent.match(/https?:\/\/[^\s|]+/);
    return m ? m[0] : null;
  }).filter(Boolean);
}
async function directDownloadSingle(index) {
  const urls = rowUrls();
  const url  = urls[index];
  if (!url) return logMsg('⚠️ រកមិនឃើញ URL ក្នុងជួរនេះ');
  pechStop = false;
  await downloadOne(url, index, urls.length);
}
async function startAllDownloads() {
  if (pechRunning) return logMsg('⚠️ កំពុងដំណើរការរួចហើយ...');
  const urls = rowUrls();
  if (!urls.length) return logMsg('⚠️ គ្មានអ្វីក្នុងបញ្ជីទាញយក');
  pechRunning = true; pechStop = false;
  logMsg(`🚀 ចាប់ផ្ដើមទាញយក ${urls.length} ធាតុ...`);
  let ok = 0;
  for (let i = 0; i < urls.length; i++) {
    if (pechStop) { logMsg('⛔ បានបញ្ឈប់'); break; }
    if (await downloadOne(urls[i], i, urls.length)) ok++;
  }
  setProgress(100, `រួចរាល់ ${ok}/${urls.length}`);
  logMsg(`🎉 បញ្ចប់! ជោគជ័យ ${ok}/${urls.length}`);
  pechRunning = false;
}
function stopAllDownloads() {
  pechStop = true;
  logMsg('⛔ កំពុងបញ្ឈប់...');
}

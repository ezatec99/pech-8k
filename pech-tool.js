/* ═══════════════════════════════════════════════════════════════
   PECH-TOOL EXTRACTOR-DOWNLOAD · Logic (Blogspot Edition)
   ═══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var API_BASE = 'https://pech-8k.onrender.com';

    /* ── STATE ── */
    var extractedList    = [];
    var downloadList     = [];
    var isDownloading    = false;
    var downloadInterval = null;
    var currentFilter    = 'ALL';

    /* ── HELPERS ── */
    function $(id) { return document.getElementById(id); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ── LIVE CLOCK ── */
    function updateClock() {
        var now = new Date();
        var dEl = $('pechDate');
        var tEl = $('pechTime');

        if (dEl) {
            dEl.textContent = 'DATE: ' + pad(now.getDate()) + ' / ' + pad(now.getMonth() + 1) + ' / ' + now.getFullYear();
        }
        if (tEl) {
            var h = now.getHours();
            var ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12; h = h ? h : 12;
            tEl.textContent = 'TIME: ' + pad(h) + ' : ' + pad(now.getMinutes()) + ' : ' + pad(now.getSeconds()) + ' ' + ampm;
        }
    }

    /* ── LOGGER ── */
    function logMsg(msg) {
        var box = $('pechTerminal');
        if (!box) return;
        var now = new Date();
        var t = '[' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + ']';
        var p = document.createElement('p');
        p.innerHTML = '<span class="time">' + t + '</span> ' + msg;
        box.appendChild(p);
        box.scrollTop = box.scrollHeight;
    }

    /* ── THEME SWITCHER ── */
    function toggleTheme() {
        var root = $('pech-tool');
        if (!root) return;
        var isLight = root.classList.toggle('light-mode');

        var icon = $('pechThemeIcon');
        var text = $('pechThemeText');
        if (icon) icon.textContent = isLight ? '🌙' : '☀️';
        if (text) text.textContent = isLight ? 'Dark Mode' : 'Light Mode';

        try { localStorage.setItem('pech-theme', isLight ? 'light' : 'dark'); } catch (e) {}

        logMsg(isLight ? '☀️ Light Theme applied.' : '🌙 Dark Theme applied.');
    }

    /* ── DETECT PLATFORM ── */
    function detectPlatform(url) {
        var u = String(url).toLowerCase();
        if (u.indexOf('youtube.com') > -1 || u.indexOf('youtu.be') > -1) return 'YouTube';
        if (u.indexOf('facebook.com') > -1 || u.indexOf('fb.watch') > -1 || u.indexOf('fb.com') > -1) return 'Facebook';
        if (u.indexOf('tiktok.com') > -1) return 'TikTok';
        if (u.indexOf('instagram.com') > -1) return 'Instagram';
        if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(u)) return 'Image';
        if (/\.(mp4|mkv|webm|mov|avi|flv|m3u8)(\?.*)?$/i.test(u)) return 'Video';
        return 'Other';
    }

    /* ── CLEAN TRACKING PARAMS ── */
    function cleanUrl(url) {
        var chk = $('pechCleanTracking');
        if (chk && !chk.checked) return url;
        try {
            var parsed = new URL(url);
            ['fbclid', 'igsh', 'utm_source', 'utm_medium', 'utm_campaign', 'si', 'ref', '_r']
                .forEach(function (p) { parsed.searchParams.delete(p); });
            return parsed.toString();
        } catch (e) {
            return String(url).replace(/(\?|&)(fbclid|utm_[^&]+|igsh|si|ref)=[^&]+/g, '');
        }
    }

    function pushExtracted(url) {
        var cleaned = cleanUrl(url);
        var dup = extractedList.some(function (i) { return i.url === cleaned; });
        if (dup) return false;
        var plat = detectPlatform(cleaned);
        extractedList.push({
            url: cleaned,
            platform: plat,
            type: (plat === 'Image' ? 'Image' : (plat === 'Video' ? 'Video' : 'Media'))
        });
        return true;
    }

    /* ── EXTRACT (client-side) ── */
    function extractLinksFromInput() {
        var box = $('pechRawInput');
        if (!box || !box.value.trim()) {
            logMsg('⚠️ Input area is empty! Please paste text or links first.');
            return;
        }
        var matches = box.value.match(/(https?:\/\/[^\s"'<>]+)/gi) || [];
        if (!matches.length) {
            logMsg('⚠️ No valid URL found in input.');
            return;
        }
        var added = 0;
        matches.forEach(function (u) { if (pushExtracted(u)) added++; });
        renderExtractorTable(currentFilter);
        logMsg('✅ Extracted ' + added + ' new links successfully!');
    }

    /* ── EXTRACT (via Render server) ── */
    function extractViaServer() {
        var box = $('pechRawInput');
        if (!box || !box.value.trim()) {
            logMsg('⚠️ Input area is empty!');
            return;
        }
        logMsg('🌐 Sending text to server for extraction...');

        fetch(API_BASE + '/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: box.value })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var links = (data && data.links) || [];
            var added = 0;
            links.forEach(function (item) {
                var url = (typeof item === 'string') ? item : (item.url || '');
                if (url && pushExtracted(url)) added++;
            });
            renderExtractorTable(currentFilter);
            logMsg('✅ Server returned ' + links.length + ' links · ' + added + ' new added.');
        })
        .catch(function (err) {
            logMsg('❌ Server extract failed: ' + err.message);
        });
    }

    /* ── PASTE FROM CLIPBOARD ── */
    function pasteFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            logMsg('⚠️ Clipboard not supported. Please press Ctrl+V inside the box.');
            return;
        }
        navigator.clipboard.readText().then(function (text) {
            var box = $('pechRawInput');
            if (box) box.value = text;
            extractLinksFromInput();
        }).catch(function () {
            logMsg('⚠️ Clipboard access denied. Please press Ctrl+V inside the box.');
        });
    }

    /* ── RENDER : EXTRACTOR TABLE ── */
    function renderExtractorTable(filter) {
        filter = filter || 'ALL';
        var tbody = $('pechExtractorBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        var count = 0;
        extractedList.forEach(function (item) {
            if (filter !== 'ALL' && item.platform.toLowerCase() !== filter.toLowerCase()) return;
            count++;
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + count + '</td>' +
                '<td><span class="badge-plat plat-' + esc(item.platform.toLowerCase()) + '">' + esc(item.platform) + '</span></td>' +
                '<td title="' + esc(item.url) + '"><a href="' + esc(item.url) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">' + esc(item.url) + '</a></td>' +
                '<td>' + esc(item.type) + '</td>';
            tbody.appendChild(tr);
        });

        var cEl = $('pechExtractorCount');
        if (cEl) cEl.textContent = extractedList.length + ' items';
    }

    function clearExtractorTable() {
        extractedList = [];
        var box = $('pechRawInput');
        if (box) box.value = '';
        renderExtractorTable('ALL');
        logMsg('🗑️ Link Extractor Table cleared.');
    }

    function copyExtractedLinks() {
        if (!extractedList.length) { logMsg('⚠️ Extractor table is empty!'); return; }
        var text = extractedList.map(function (i) { return i.url; }).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            logMsg('📑 Copied ' + extractedList.length + ' links to clipboard!');
        } else {
            logMsg('⚠️ Clipboard write not supported.');
        }
    }

    /* ── LOAD → DOWNLOAD TABLE ── */
    function loadToDownloadList() {
        if (!extractedList.length) {
            logMsg('⚠️ Extractor table is empty! Extract links first.');
            return;
        }
        var loaded = 0;
        extractedList.forEach(function (item) {
            if (!downloadList.some(function (d) { return d.url === item.url; })) {
                downloadList.push({ url: item.url, platform: item.platform, status: 'Ready' });
                loaded++;
            }
        });
        renderDownloadTable();
        updateStats();
        logMsg('➡️ Loaded ' + loaded + ' links into Download Table.');
    }

    function pasteDirectToDownload() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            logMsg('⚠️ Clipboard not supported.');
            return;
        }
        navigator.clipboard.readText().then(function (text) {
            var matches = String(text).match(/(https?:\/\/[^\s"'<>]+)/gi) || [];
            var count = 0;
            matches.forEach(function (raw) {
                var cleaned = cleanUrl(raw);
                if (!downloadList.some(function (d) { return d.url === cleaned; })) {
                    downloadList.push({ url: cleaned, platform: detectPlatform(cleaned), status: 'Ready' });
                    count++;
                }
            });
            renderDownloadTable();
            updateStats();
            logMsg('📋 Pasted ' + count + ' items directly to download list.');
        }).catch(function () {
            logMsg('⚠️ Clipboard access failed.');
        });
    }

    function renderDownloadTable() {
        var tbody = $('pechDownloadBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        downloadList.forEach(function (item, index) {
            var color = item.status === 'Completed' ? '#10b981'
                      : (item.status === 'Downloading' ? '#38bdf8' : '#f59e0b');
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + (index + 1) + '</td>' +
                '<td><span class="badge-plat plat-' + esc(item.platform.toLowerCase()) + '">' + esc(item.platform) + '</span></td>' +
                '<td title="' + esc(item.url) + '">' + esc(item.url) + '</td>' +
                '<td><button type="button" class="btn btn-green" style="padding:3px 8px;font-size:0.75rem;" onclick="PECH.directDownloadSingle(' + index + ')">⬇️ Open</button></td>' +
                '<td><span style="color:' + color + ';font-weight:bold;">' + esc(item.status) + '</span></td>';
            tbody.appendChild(tr);
        });

        var cEl = $('pechDownloadCount');
        if (cEl) cEl.textContent = downloadList.length + ' items';
    }

    function clearDownloadTable() {
        downloadList = [];
        renderDownloadTable();
        updateStats();
        logMsg('🗑️ Download Table cleared.');
    }

    function updateStats() {
        var counts = { ALL: downloadList.length, YouTube: 0, Facebook: 0, TikTok: 0, Instagram: 0 };
        downloadList.forEach(function (item) {
            if (counts[item.platform] !== undefined) counts[item.platform]++;
        });
        var map = {
            pechStatAll: '🌐 All: ' + counts.ALL,
            pechStatYt:  'YouTube: ' + counts.YouTube,
            pechStatFb:  'Facebook: ' + counts.Facebook,
            pechStatTt:  'TikTok: ' + counts.TikTok,
            pechStatIg:  'Instagram: ' + counts.Instagram
        };
        Object.keys(map).forEach(function (id) {
            var el = $(id);
            if (el) el.textContent = map[id];
        });
    }

    function filterByPlatform(plat, btn) {
        currentFilter = plat;
        var bar = $('pechFilterBar');
        if (bar) {
            var btns = bar.querySelectorAll('.filter-btn');
            for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
        }
        if (btn && btn.classList) btn.classList.add('active');
        renderExtractorTable(plat);
        logMsg('🔍 Filtered Extractor Table by: ' + plat);
    }

    /* ── EXPORT ── */
    function downloadBlob(content, filename, mimeType) {
        var blob = new Blob([content], { type: mimeType });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    function exportTableToTxt(type) {
        var list = (type === 'extractor') ? extractedList : downloadList;
        if (!list.length) { logMsg('⚠️ Nothing to export!'); return; }
        downloadBlob(list.map(function (i) { return i.url; }).join('\n'), type + '_links.txt', 'text/plain;charset=utf-8');
        logMsg('💾 Exported ' + list.length + ' links to TXT.');
    }

    function exportTableToCsv(type) {
        var list = (type === 'extractor') ? extractedList : downloadList;
        if (!list.length) { logMsg('⚠️ Nothing to export!'); return; }
        var csv = 'Index,Platform,URL\n';
        list.forEach(function (item, i) {
            csv += (i + 1) + ',"' + item.platform + '","' + item.url + '"\n';
        });
        downloadBlob(csv, type + '_links.csv', 'text/csv;charset=utf-8');
        logMsg('📊 Exported ' + list.length + ' links to CSV.');
    }

    /* ── DOWNLOAD ACTIONS ── */
    function directDownloadSingle(index) {
        var item = downloadList[index];
        if (!item) return;

        if (/\.(mp4|mkv|webm|mov|avi|flv|mp3|m4a|jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(item.url)) {
            item.status = 'Downloading';
            renderDownloadTable();
            window.open(API_BASE + '/api/proxy?url=' + encodeURIComponent(item.url), '_blank');
            logMsg('⬇️ Downloading via proxy: ' + item.url);
            setTimeout(function () {
                item.status = 'Completed';
                renderDownloadTable();
            }, 900);
        } else {
            window.open(item.url, '_blank');
            logMsg('🌐 Opening in new tab: ' + item.url);
        }
    }

    function startAllDownloads() {
        if (!downloadList.length) {
            logMsg('⚠️ Download list is empty! Add links before starting.');
            return;
        }
        if (isDownloading) return;

        isDownloading = true;
        var total = downloadList.length;
        var currentIndex = 0;
        logMsg('🚀 Starting download queue for ' + total + ' items...');

        downloadInterval = setInterval(function () {
            if (!isDownloading || currentIndex >= total) {
                clearInterval(downloadInterval);
                isDownloading = false;
                var f = $('pechProgressFill');
                var t = $('pechProgressText');
                if (f) f.style.width = '100%';
                if (t) t.textContent = '100% Completed';
                logMsg('🎉 All items in download queue processed!');
                return;
            }

            downloadList[currentIndex].status = 'Completed';
            var pct = Math.round(((currentIndex + 1) / total) * 100);
            var fill = $('pechProgressFill');
            var txt = $('pechProgressText');
            if (fill) fill.style.width = pct + '%';
            if (txt) txt.textContent = pct + '% Completed';

            logMsg('⏬ [' + pct + '%] Processed: ' + downloadList[currentIndex].url);
            renderDownloadTable();
            currentIndex++;
        }, 600);
    }

    function stopAllDownloads() {
        if (isDownloading || downloadInterval) {
            clearInterval(downloadInterval);
            downloadInterval = null;
            isDownloading = false;
            logMsg('⏹️ Download queue stopped by user.');
        }
    }

    /* ── SERVER HEALTH PING ── */
    function pingServer() {
        logMsg('📡 Connecting to server ' + API_BASE + ' ...');
        fetch(API_BASE + '/api/health')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                logMsg('✅ Server online — status: ' + (d.status || 'ok'));
            })
            .catch(function () {
                logMsg('⚠️ Server offline / sleeping (Render free tier needs ~50s to wake).');
            });
    }

    /* ── INIT ── */
    function init() {
        var root = $('pech-tool');
        if (!root) return;

        /* restore theme */
        try {
            if (localStorage.getItem('pech-theme') === 'light') {
                root.classList.add('light-mode');
                var ic = $('pechThemeIcon'), tx = $('pechThemeText');
                if (ic) ic.textContent = '🌙';
                if (tx) tx.textContent = 'Dark Mode';
            }
        } catch (e) {}

        updateClock();
        setInterval(updateClock, 1000);

        renderExtractorTable('ALL');
        renderDownloadTable();
        updateStats();

        logMsg('🌟 PECH-TOOL EXTRACTOR-DOWNLOAD (Blogspot Edition) ready.');
        pingServer();
    }

    /* ── EXPOSE PUBLIC API ── */
    window.PECH = {
        toggleTheme: toggleTheme,
        filterByPlatform: filterByPlatform,
        extractLinksFromInput: extractLinksFromInput,
        extractViaServer: extractViaServer,
        pasteFromClipboard: pasteFromClipboard,
        copyExtractedLinks: copyExtractedLinks,
        exportTableToTxt: exportTableToTxt,
        exportTableToCsv: exportTableToCsv,
        clearExtractorTable: clearExtractorTable,
        loadToDownloadList: loadToDownloadList,
        pasteDirectToDownload: pasteDirectToDownload,
        clearDownloadTable: clearDownloadTable,
        startAllDownloads: startAllDownloads,
        stopAllDownloads: stopAllDownloads,
        directDownloadSingle: directDownloadSingle,
        pingServer: pingServer
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

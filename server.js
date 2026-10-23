'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { exec } = require('child_process');
const { BrowserManager, LoginRequiredError } = require('./src/browser');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

const app = express();
const manager = new BrowserManager();
const jobs = new Map();
const thumbCache = new Map();
const imageCache = new Map();

const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let vpnCache = null;
let vpnCacheAt = 0;

async function getVpnInfo() {
  if (vpnCache && Date.now() - vpnCacheAt < 60_000) return vpnCache;
  try {
    const response = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    vpnCache = {
      ip: data.ip || null,
      country: data.country || null,
      city: data.city || null,
      org: data.org || null,
    };
  } catch {
    vpnCache = { ip: null, country: null, city: null, org: null };
  }
  vpnCacheAt = Date.now();
  return vpnCache;
}

function sanitizeFileName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

function sanitizeFolderName(value) {
  return sanitizeFileName(value, 'profile').replace(/^\.+/, '') || 'profile';
}

async function runProfileDownload(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    job.phase = 'collecting';
    const data = await manager.getProfileAll(job.username, { maxPosts: job.maxPosts });
    job.total = data.items.length;
    job.profile = data.profile;
    if (!job.total) {
      job.phase = 'done';
      return;
    }

    const directory = path.join(DOWNLOADS_DIR, sanitizeFolderName(job.username));
    fs.mkdirSync(directory, { recursive: true });
    job.directory = directory;
    job.phase = 'downloading';

    for (const [index, item] of data.items.entries()) {
      job.current = item.code;
      try {
        let media = item.media || [];
        if (!media.length) {
          const post = await manager.getPost(item.code);
          media = (post.item && post.item.media) || [];
          if (!item.username && post.item) item.username = post.item.username;
        }
        if (!media.length) throw new Error('медиа не найдено');
        for (const [mediaIndex, entry] of media.entries()) {
          const extension = entry.type === 'video' ? 'mp4' : 'jpg';
          const filename = `${String(index + 1).padStart(3, '0')}_${item.code}_${mediaIndex + 1}.${extension}`;
          await manager.downloadToFile(entry.url, path.join(directory, filename));
          job.files += 1;
        }
        job.done += 1;
      } catch (error) {
        job.failed += 1;
        if (job.errors.length < 25) job.errors.push(`${item.code}: ${error.message}`);
      }
    }
    job.phase = 'done';
  } catch (error) {
    job.phase = 'error';
    job.error = error.message;
  }
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof LoginRequiredError || error.code === 'login_required') {
        return res.status(401).json({ error: error.message, login_required: true });
      }
      const statusCode = error.statusCode || 500;
      console.error('[api]', req.method, req.originalUrl, '-', error.message);
      return res.status(statusCode).json({ error: error.message || 'Внутренняя ошибка' });
    }
  };
}

app.get(
  '/api/status',
  wrap(async (req, res) => {
    const status = await manager.status();
    const vpn = await getVpnInfo();
    res.json({ ...status, vpn, viewer: manager.viewer || null });
  })
);

app.post(
  '/api/login',
  wrap(async (req, res) => {
    res.json(await manager.startLogin());
  })
);

app.post(
  '/api/login/cancel',
  wrap(async (req, res) => {
    await manager.cancelLogin();
    res.json({ ok: true });  })
);

app.post(
  '/api/logout',
  wrap(async (req, res) => {
    await manager.logout();
    res.json({ ok: true });
  })
);

app.get(
  '/api/feed',
  wrap(async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 24, 60));
    const force = req.query.refresh === '1';
    const source = req.query.source === 'explore' ? 'explore' : 'feed';
    const data = source === 'explore'
      ? await manager.getExplore({ limit, force })
      : await manager.getFeed({ limit, force });
    res.json({ ...data, sourceName: source });
  })
);

app.get(
  '/api/profile/:username',
  wrap(async (req, res) => {
    res.json(await manager.getProfile(req.params.username));
  })
);

app.get(
  '/api/post/:code',
  wrap(async (req, res) => {
    res.json(await manager.getPost(req.params.code));
  })
);

app.get(
  '/api/download',
  wrap(async (req, res) => {
    const url = String(req.query.url || '');
    const code = String(req.query.code || 'instagram');
    const filename = sanitizeFileName(req.query.filename, `${code}.jpg`);
    await manager.download(url, filename, res);
  })
);

app.get(
  '/api/image',
  wrap(async (req, res) => {
    const url = String(req.query.url || '');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Object.assign(new Error('Некорректная ссылка'), { statusCode: 400 });
    }
    if (parsed.protocol !== 'https:' || !MEDIA_HOST.test(parsed.hostname)) {
      throw Object.assign(new Error('Можно проксировать только медиа Instagram'), { statusCode: 400 });
    }

    const cached = imageCache.get(url);
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) {
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(cached.buffer);
    }

    const upstream = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        referer: 'https://www.instagram.com/',
        accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error(`Instagram вернул ${upstream.status}`), { statusCode: 502 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    imageCache.set(url, { buffer, type, at: Date.now() });
    if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buffer);
  })
);

app.get(
  '/api/video',
  wrap(async (req, res) => {
    const url = String(req.query.url || '');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Object.assign(new Error('Некорректная ссылка'), { statusCode: 400 });
    }
    if (parsed.protocol !== 'https:' || !MEDIA_HOST.test(parsed.hostname)) {
      throw Object.assign(new Error('Можно проксировать только медиа Instagram'), { statusCode: 400 });
    }

    const range = req.headers.range;
    const upstream = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        referer: 'https://www.instagram.com/',
        accept: 'video/*,*/*;q=0.8',
        ...(range ? { range } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(300000),
    });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error(`Instagram вернул ${upstream.status}`), { statusCode: 502 });
    }
    res.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    Readable.fromWeb(upstream.body).pipe(res);
  })
);

app.get(
  '/api/thumb',
  wrap(async (req, res) => {
    const code = String(req.query.code || '');
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) {
      throw Object.assign(new Error('Некорректный код поста'), { statusCode: 400 });
    }
    const cached = thumbCache.get(code);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(cached.buffer);
    }

    const upstream = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        referer: 'https://www.instagram.com/',
        accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error(`Instagram вернул ${upstream.status}`), { statusCode: 502 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    thumbCache.set(code, { buffer, type, at: Date.now() });
    if (thumbCache.size > 200) thumbCache.delete(thumbCache.keys().next().value);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buffer);
  })
);

app.post(
  '/api/profile/:username/download',
  wrap(async (req, res) => {
    const username = String(req.params.username || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9._]{1,40}$/.test(username)) {
      throw Object.assign(new Error('Некорректный никнейм'), { statusCode: 400 });
    }
    const maxPosts = Math.max(1, Math.min(Number(req.body && req.body.maxPosts) || 200, 500));
    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      username,
      phase: 'starting',
      total: 0,
      done: 0,
      failed: 0,
      files: 0,
      current: null,
      directory: null,
      errors: [],
      maxPosts,
      startedAt: Date.now(),
    };
    jobs.set(jobId, job);
    runProfileDownload(jobId).catch(() => {});
    res.status(202).json({ jobId, username, maxPosts });
  })
);

app.get(
  '/api/downloads/:jobId',
  wrap(async (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) throw Object.assign(new Error('Задача не найдена'), { statusCode: 404 });
    res.json(job);
  })
);

app.post(
  '/api/downloads/:jobId/open',
  wrap(async (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || !job.directory || !fs.existsSync(job.directory)) {
      throw Object.assign(new Error('Папка загрузки ещё не готова'), { statusCode: 404 });
    }
    if (process.platform === 'win32') exec(`explorer.exe "${job.directory}"`);
    res.json({ ok: true, directory: job.directory });
  })
);

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Insta Browser Client: http://${HOST}:${PORT}`);
  console.log('Включите VPN, откройте страницу и нажмите «Войти в Instagram».');
  if (process.env.NO_OPEN !== '1' && process.platform === 'win32') {
    exec(`start "" http://${HOST}:${PORT}`, () => {});
  }
});

async function shutdown() {
  console.log('\nОстанавливаю браузер и сервер...');
  server.close();
  await manager.shutdown();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

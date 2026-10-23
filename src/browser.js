'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { chromium } = require('playwright-core');
const { collectMedia, collectProfile } = require('./extract');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
const SESSION_MARKER = path.join(DATA_DIR, 'session-ok');
const CHANNEL = process.env.CHROME_CHANNEL || 'chrome';
const HEADLESS = process.env.HEADLESS !== '0';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const INSTAGRAM_HOME = 'https://www.instagram.com/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class LoginRequiredError extends Error {
  constructor(message = 'Нужно войти в Instagram') {
    super(message);
    this.code = 'login_required';
  }
}

function findViewer(payloads) {
  let found = null;
  const seen = new WeakSet();
  const consider = (user) => {
    if (found || !user || typeof user !== 'object') return;
    if (typeof user.username !== 'string' || !user.username) return;
    found = {
      username: user.username,
      pk: user.pk || user.id || null,
      profilePic: user.profile_pic_url || user.profile_pic_url_hd || null,
    };
  };
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    for (const key of Object.keys(value)) {
      if (key === 'xdt_viewer' || key === 'viewer' || key === 'viewer_user') {
        const node = value[key];
        if (node && node.user) consider(node.user);
        else consider(node);
      }
      walk(value[key]);
    }
  };
  for (const payload of payloads) walk(payload);
  return found;
}

class BrowserManager {
  constructor() {
    this.context = null;
    this.page = null;
    this.contextHeadless = null;
    this.loggedIn = null;
    this.queue = Promise.resolve();
    this.loginInProgress = false;
    this.feedCache = { value: null };
    this.exploreCache = { value: null };
    this.viewer = null;
  }

  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  async launch({ headless, offscreen = false }) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=Translate,OptimizationHints',
      '--lang=en-US',
    ];
    if (offscreen && !headless) args.push('--window-position=-2400,-2400');
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: CHANNEL,
      headless,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      userAgent: USER_AGENT,
      args,
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    this.context = context;
    this.contextHeadless = headless;
    context.on('close', () => {
      if (this.context === context) {
        this.context = null;
        this.page = null;
      }
    });
    return context;
  }

  async closeContext() {
    if (!this.context) return;
    const context = this.context;
    this.context = null;
    this.page = null;
    await context.close().catch(() => {});
  }

  async hasSession(context) {
    try {
      const cookies = await context.cookies('https://www.instagram.com');
      return cookies.some((cookie) => cookie.name === 'sessionid');
    } catch {
      return false;
    }
  }

  async getPage() {
    if (this.page && !this.page.isClosed()) return this.page;
    this.page = await this.context.newPage();
    return this.page;
  }

  async ensureLoggedInContext() {
    if (this.context) return this.context;
    if (!fs.existsSync(SESSION_MARKER)) {
      this.loggedIn = false;
      throw new LoginRequiredError('Войдите в Instagram, чтобы загрузить ленту');
    }
    const context = await this.launch({ headless: HEADLESS });
    if (!(await this.hasSession(context))) {
      await this.closeContext();
      fs.rmSync(SESSION_MARKER, { force: true });
      this.loggedIn = false;
      throw new LoginRequiredError('Сессия Instagram истекла. Войдите заново');
    }
    this.loggedIn = true;
    return context;
  }

  async relaunchHeaded() {
    await this.closeContext();
    await this.launch({ headless: false, offscreen: true });
    this.loggedIn = true;
  }

  async status() {
    if (this.loginInProgress) {
      return { loggedIn: false, loginInProgress: true, headless: HEADLESS };
    }
    if (this.loggedIn === true) {
      return { loggedIn: true, loginInProgress: false, headless: HEADLESS };
    }
    if (!fs.existsSync(SESSION_MARKER)) {
      this.loggedIn = false;
      return { loggedIn: false, loginInProgress: false, headless: HEADLESS };
    }
    try {
      await this.serialize(() => this.ensureLoggedInContext());
      return { loggedIn: true, loginInProgress: false, headless: HEADLESS };
    } catch {
      return { loggedIn: false, loginInProgress: false, headless: HEADLESS };
    }
  }

  async startLogin() {
    if (this.loginInProgress) return { started: true, alreadyRunning: true };
    this.loginInProgress = true;
    this.loggedIn = false;
    this.viewer = null;
    await this.serialize(async () => {
      await this.closeContext();
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const context = await this.launch({ headless: false });
      const page = context.pages()[0] || (await context.newPage());
      this.page = page;
      await page.goto(INSTAGRAM_HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    });
    this.watchLogin().catch(() => {});
    return { started: true };
  }

  async watchLogin() {
    const deadline = Date.now() + 5 * 60 * 1000;
    try {
      while (Date.now() < deadline && this.loginInProgress) {
        await sleep(2000);
        const context = this.context;
        if (!context) {
          this.loginInProgress = false;
          return;
        }
        if (await this.hasSession(context)) {
          await sleep(1500);
          await this.closeContext();
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(SESSION_MARKER, new Date().toISOString(), 'utf8');
          this.loggedIn = true;
          this.loginInProgress = false;
          return;
        }
      }
    } finally {
      this.loginInProgress = false;
    }
  }

  async cancelLogin() {
    this.loginInProgress = false;
    await this.closeContext();
  }

  async logout() {
    this.loginInProgress = false;
    await this.closeContext().catch(() => {});
    fs.rmSync(SESSION_MARKER, { force: true });
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch {
      // Chromium may still hold some files; the session marker is already gone.
    }
    this.loggedIn = false;
    this.page = null;
    this.viewer = null;
  }

  assertPageReady(page) {
    const url = page.url();
    if (url.includes('/accounts/login')) {
      throw new LoginRequiredError('Instagram просит войти заново');
    }
    if (url.includes('/challenge')) {
      throw new Error('Instagram показывает проверку безопасности (challenge). Войдите заново в окне входа.');
    }
  }

  async capture(page, action, { waitMs = 9000, scrolls = 0 } = {}) {
    const payloads = [];
    const pending = [];
    const handler = (response) => {
      const url = response.url();
      // Instagram serves GraphQL as /api/graphql (no trailing slash) and often
      // labels the body as text/javascript, so match by URL and just try JSON.
      const isApi = /\/api\/v1\//.test(url) || /\/graphql(\/|\?|$)/.test(url) || /\/api\/graphql/.test(url);
      if (!isApi) return;
      if (response.status() !== 200) return;
      if (payloads.length > 80) return;
      pending.push(
        response
          .json()
          .then((data) => payloads.push(data))
          .catch(() => {})
      );
    };

    // Картинки и шрифты для парсинга JSON не нужны: обложки берём из srcset,
    // а страница без них грузится в разы быстрее.
    const routeHandler = (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media') return route.abort();
      return route.continue();
    };

    await page.route('**/*', routeHandler);
    page.on('response', handler);
    try {
      await action(page);
      await page.waitForTimeout(waitMs);
      for (let index = 0; index < scrolls; index += 1) {
        await page.mouse.wheel(0, 2400).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } finally {
      page.off('response', handler);
      await page.unroute('**/*', routeHandler).catch(() => {});
      await Promise.allSettled(pending);
    }

    // Instagram также кладёт начальные данные страницы в HTML как JSON-скрипты
    // (RelayPrefetchedStreamCache) — без этого лента и профили остаются пустыми.
    const embedded = await page
      .evaluate(() => {
        const collected = [];
        for (const script of document.querySelectorAll('script[type="application/json"]')) {
          const text = script.textContent || '';
          if (text.length < 60) continue;
          if (!text.includes('image_versions2') && !text.includes('video_versions') && !text.includes('xdt_api__v1__feed')) continue;
          collected.push(text);
        }
        return collected;
      })
      .catch(() => []);

    for (const text of embedded) {
      try {
        payloads.push(JSON.parse(text));
      } catch {
        // Не JSON — пропускаем.
      }
    }

    return payloads;
  }

  async withHeadedFallback(run) {
    try {
      return await run();
    } catch (error) {
      if (
        error.code === 'login_required' &&
        this.contextHeadless === true &&
        error.automationFallbackTried !== true &&
        fs.existsSync(SESSION_MARKER)
      ) {
        const retryError = error;
        retryError.automationFallbackTried = true;
        await this.relaunchHeaded();
        return run();
      }
      throw error;
    }
  }

  async scrapeGrid(pageUrl, { limit = 24, force = false, cacheHolder } = {}) {
    if (!force && cacheHolder.value && Date.now() - cacheHolder.value.at < 25_000) {
      return { ...cacheHolder.value.data, cached: true, fetchedAt: cacheHolder.value.at, viewer: this.viewer };
    }
    const isExplore = pageUrl.includes('/explore');
    return this.serialize(async () => {
      const run = async () => {
        await this.ensureLoggedInContext();
        const page = await this.getPage();
        const payloads = await this.capture(
          page,
          (target) => target.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }),
          { waitMs: isExplore ? 5000 : 3500, scrolls: isExplore ? 1 : 0 }
        );
        this.assertPageReady(page);
        let items = collectMedia(payloads);
        let source = items.length ? 'api' : 'dom';

        const viewer = findViewer(payloads);
        if (viewer) this.viewer = viewer;

        // На страницах вроде Explore часть плиток приходит только разметкой.
        // Добираем их из DOM, а у JSON-постов при необходимости уточняем обложку.
        const domItems = await this.extractFeedFromDom(page);
        if (domItems.length) {
          const byCode = new Map(items.map((item) => [item.code, item]));
          for (const domItem of domItems) {
            if (!byCode.has(domItem.code)) {
              byCode.set(domItem.code, domItem);
              source = items.length ? 'api+dom' : 'dom';
            } else if (!byCode.get(domItem.code).thumbnail && domItem.thumbnail) {
              byCode.get(domItem.code).thumbnail = domItem.thumbnail;
            }
          }
          items = [...byCode.values()];
        } else if (!items.length) {
          items = await this.extractFeedFromDom(page);
        }
        const data = { items: items.slice(0, limit), total: items.length, source };
        const fetchedAt = Date.now();
        cacheHolder.value = { data, at: fetchedAt };
        return { ...data, cached: false, fetchedAt, viewer: this.viewer };
      };
      return this.withHeadedFallback(run);
    });
  }

  async getFeed({ limit = 24, force = false } = {}) {
    return this.scrapeGrid(INSTAGRAM_HOME, { limit, force, cacheHolder: this.feedCache });
  }

  async getExplore({ limit = 30, force = false } = {}) {
    return this.scrapeGrid('https://www.instagram.com/explore/', {
      limit,
      force,
      cacheHolder: this.exploreCache,
    });
  }

  async pageHasNoPosts(page) {
    return page
      .evaluate(() => /(?:^|\s)0\s+(posts|публикац)/i.test(document.body.innerText))
      .catch(() => false);
  }

  async getProfile(username) {
    const clean = String(username || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9._]{1,40}$/.test(clean)) {
      throw Object.assign(new Error('Некорректный никнейм'), { statusCode: 400 });
    }
    return this.serialize(async () => {
      const run = async () => {
        await this.ensureLoggedInContext();
        const page = await this.getPage();
        const url = `https://www.instagram.com/${encodeURIComponent(clean)}/`;
        const payloads = await this.capture(page, (target) => target.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }), {
          waitMs: 6000,
          scrolls: 1,
        });
        this.assertPageReady(page);
        let items = collectMedia(payloads);
        const ownItems = items.filter((item) => (item.username || '').toLowerCase() === clean.toLowerCase());
        items = ownItems;
        let source = items.length ? 'api' : 'dom';
        if (!items.length) {
          // Не подставляем чужие посты из ленты, если у профиля 0 публикаций.
          const emptyAccount = await this.pageHasNoPosts(page);
          if (!emptyAccount) {
            items = await this.extractFeedFromDom(page);
            source = 'dom';
          }
        }
        const profile = collectProfile(payloads, clean) || { username: clean, fullName: '', profilePic: null, bio: '', followerCount: 0, followingCount: 0, postCount: 0 };
        const notFound = await page.evaluate(() => document.body.innerText.includes("Sorry, this page isn't available."));
        if (!items.length && notFound) {
          throw Object.assign(new Error(`Профиль @${clean} не найден`), { statusCode: 404 });
        }
        return { profile, items, total: items.length, source };
      };
      return this.withHeadedFallback(run);
    });
  }

  async getProfileAll(username, { maxPosts = 200 } = {}) {
    const clean = String(username || '').replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9._]{1,40}$/.test(clean)) {
      throw Object.assign(new Error('Некорректный никнейм'), { statusCode: 400 });
    }
    return this.serialize(async () => {
      const run = async () => {
        await this.ensureLoggedInContext();
        const page = await this.getPage();
        const payloads = [];
        let pending = [];
        const handler = (response) => {
          const url = response.url();
          const isApi = /\/api\/v1\//.test(url) || /\/graphql(\/|\?|$)/.test(url) || /\/api\/graphql/.test(url);
          if (!isApi || response.status() !== 200) return;
          pending.push(response.json().then((data) => payloads.push(data)).catch(() => {}));
        };

        page.on('response', handler);
        try {
          await page.goto(`https://www.instagram.com/${encodeURIComponent(clean)}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 90000,
          });
          await page.waitForTimeout(6000);
          this.assertPageReady(page);

          let stagnantRounds = 0;
          let known = 0;
          for (let round = 0; round < 40; round += 1) {
            const itemsNow = collectMedia(payloads);
            const ownNow = itemsNow.filter((item) => (item.username || '').toLowerCase() === clean.toLowerCase());
            const count = ownNow.length || itemsNow.length;
            if (count >= maxPosts) break;
            if (count === known) stagnantRounds += 1;
            else stagnantRounds = 0;
            known = count;
            if (stagnantRounds >= 3) break;

            await page.mouse.wheel(0, 2600).catch(() => {});
            await page.waitForTimeout(2200);
            await Promise.allSettled(pending);
            pending = [];
          }
        } finally {
          page.off('response', handler);
          await Promise.allSettled(pending);
        }

        const payloadsItems = collectMedia(payloads);
        const ownItems = payloadsItems.filter((item) => (item.username || '').toLowerCase() === clean.toLowerCase());
        let items = ownItems;
        let source = items.length ? 'api' : 'dom';

        if (!items.length && (await this.pageHasNoPosts(page))) {
          const profile = collectProfile(payloads, clean) || {
            username: clean,
            fullName: '',
            profilePic: null,
            bio: '',
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
          };
          return { profile, items: [], total: 0, source: 'empty' };
        }

        const domItems = await this.extractFeedFromDom(page);
        if (domItems.length) {
          const byCode = new Map(items.map((item) => [item.code, item]));
          for (const domItem of domItems) {
            if (!byCode.has(domItem.code)) {
              byCode.set(domItem.code, domItem);
              source = items.length ? 'api+dom' : 'dom';
            } else if (!byCode.get(domItem.code).thumbnail && domItem.thumbnail) {
              byCode.get(domItem.code).thumbnail = domItem.thumbnail;
            }
          }
          items = [...byCode.values()];
        }

        const profile = collectProfile(payloads, clean) || {
          username: clean,
          fullName: '',
          profilePic: null,
          bio: '',
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
        };
        return { profile, items: items.slice(0, maxPosts), total: items.length, source };
      };
      return this.withHeadedFallback(run);
    });
  }

  assertMediaUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Object.assign(new Error('Некорректная ссылка'), { statusCode: 400 });
    }
    const host = parsed.hostname;
    const allowedHost = /(^|\.)(cdninstagram\.com|fbcdn\.net|instagram\.com)$/.test(host);
    if (parsed.protocol !== 'https:' || !allowedHost) {
      throw Object.assign(new Error('Можно скачивать только медиа Instagram'), { statusCode: 400 });
    }
    return parsed;
  }

  async mediaHeaders() {
    const headers = {
      'user-agent': USER_AGENT,
      referer: 'https://www.instagram.com/',
      accept: '*/*',
    };
    const cookies = await this.cookieHeader();
    if (cookies) headers.cookie = cookies;
    return headers;
  }

  async downloadToFile(url, filePath) {
    this.assertMediaUrl(url);
    const headers = await this.mediaHeaders();
    const upstream = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error(`Instagram CDN вернул ${upstream.status}`), { statusCode: 502 });
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await pipeline(Readable.fromWeb(upstream.body), fs.createWriteStream(filePath));
    return filePath;
  }

  async getPost(code) {
    const clean = String(code || '').trim();
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(clean)) {
      throw Object.assign(new Error('Некорректный код поста'), { statusCode: 400 });
    }
    return this.serialize(async () => {
      const run = async () => {
        await this.ensureLoggedInContext();
        const page = await this.getPage();
        const url = `https://www.instagram.com/p/${encodeURIComponent(clean)}/`;
        const payloads = await this.capture(page, (target) => target.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }), {
          waitMs: 5000,
          scrolls: 0,
        });
        this.assertPageReady(page);
        const items = collectMedia(payloads);
        let item = items.find((entry) => entry.code === clean) || items[0] || null;
        if (!item || !item.media.length) {
          item = await this.extractPostFromDom(page, clean, item);
        }
        if (!item || !item.media.length) {
          throw Object.assign(new Error('Не удалось получить медиа поста'), { statusCode: 404 });
        }
        return { item };
      };
      return this.withHeadedFallback(run);
    });
  }

  async extractFeedFromDom(page) {
    const cards = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const links = document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        const image = link.querySelector('img');
        let thumbnail = null;
        if (image) {
          thumbnail = image.currentSrc || image.getAttribute('src') || image.src || '';
          const srcset = image.getAttribute('srcset') || '';
          let bestWidth = 0;
          for (const part of srcset.split(',')) {
            const [url, widthText] = part.trim().split(/\s+/);
            const width = parseInt(widthText, 10) || 0;
            if (url && width > bestWidth) {
              thumbnail = url;
              bestWidth = width;
            }
          }
          if (!thumbnail || thumbnail.startsWith('data:')) thumbnail = null;
        }
        if (!thumbnail) {
          const video = link.querySelector('video');
          if (video) thumbnail = video.getAttribute('poster') || video.poster || null;
        }
        if (!thumbnail) {
          const background = link.querySelector('[style*="background-image"]');
          if (background) {
            const match = (background.getAttribute('style') || '').match(/url\(["']?([^"')]+)/);
            if (match) thumbnail = match[1];
          }
        }
        out.push({ code: match[1], thumbnail });
      }
      return out;
    });
    return cards.map((card) => ({
      code: card.code,
      pk: card.code,
      mediaType: 1,
      username: null,
      userPic: null,
      caption: '',
      likeCount: 0,
      commentCount: 0,
      takenAt: 0,
      thumbnail: card.thumbnail,
      media: [],
    }));
  }

  async extractPostFromDom(page, code, partial) {
    const data = await page.evaluate((postCode) => {
      const media = [];
      const seen = new Set();
      const push = (item) => {
        if (!item.url || seen.has(item.url)) return;
        seen.add(item.url);
        media.push(item);
      };
      const article = document.querySelector('article') || document.body;
      for (const image of article.querySelectorAll('img')) {
        const srcset = image.getAttribute('srcset') || '';
        let best = image.currentSrc || image.src;
        let bestWidth = image.naturalWidth || image.width || 0;
        for (const part of srcset.split(',')) {
          const [url, widthText] = part.trim().split(/\s+/);
          const width = parseInt(widthText, 10) || 0;
          if (url && width > bestWidth) {
            best = url;
            bestWidth = width;
          }
        }
        if (best) push({ type: 'image', url: best, width: bestWidth, height: 0 });
      }
      for (const video of article.querySelectorAll('video')) {
        const source = video.currentSrc || video.src || video.querySelector('source')?.src;
        if (source) push({ type: 'video', url: source, width: video.videoWidth || 0, height: video.videoHeight || 0 });
      }
      const ogImage = document.querySelector('meta[property="og:image"]')?.content;
      if (ogImage) push({ type: 'image', url: ogImage, width: 0, height: 0 });
      const description = document.querySelector('meta[property="og:description"]')?.content || '';
      const title = document.querySelector('meta[property="og:title"]')?.content || '';
      const usernameMatch = title.match(/^(.+?)\s+on Instagram/);
      return { media, description, username: usernameMatch ? usernameMatch[1] : null, code: postCode };
    }, code);

    const base = partial || {};
    return {
      code,
      pk: base.pk || code,
      mediaType: data.media.some((entry) => entry.type === 'video') ? 2 : data.media.length > 1 ? 8 : 1,
      username: base.username || data.username,
      userPic: base.userPic || null,
      caption: base.caption || data.description,
      likeCount: base.likeCount || 0,
      commentCount: base.commentCount || 0,
      takenAt: base.takenAt || 0,
      thumbnail: base.thumbnail || (data.media.find((entry) => entry.type === 'image') || data.media[0] || {}).url || null,
      media: base.media && base.media.length ? base.media : data.media,
    };
  }

  async cookieHeader() {
    if (!this.context) return '';
    try {
      const cookies = await this.context.cookies('https://www.instagram.com');
      return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    } catch {
      return '';
    }
  }

  async download(url, filename, response) {
    this.assertMediaUrl(url);
    const headers = await this.mediaHeaders();
    const upstream = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(180000) });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error(`Instagram CDN вернул ${upstream.status}`), { statusCode: 502 });
    }

    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const length = upstream.headers.get('content-length');
    if (length) response.setHeader('Content-Length', length);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    Readable.fromWeb(upstream.body).pipe(response);
  }

  async shutdown() {
    this.loginInProgress = false;
    await this.closeContext().catch(() => {});
  }
}

module.exports = { BrowserManager, LoginRequiredError, HEADLESS };

'use strict';

const el = {
  sidebar: document.querySelector('.sidebar'),
  sideLoginBtn: document.getElementById('side-login-btn'),
  sideLogoutBtn: document.getElementById('side-logout-btn'),
  sideProfileBtn: document.getElementById('side-profile-btn'),
  sideAvatar: document.getElementById('side-avatar'),
  layout: document.querySelector('.layout'),
  feedView: document.querySelector('.layout'),
  profileView: document.getElementById('profile-view'),
  posts: document.getElementById('posts'),
  stories: document.getElementById('stories'),
  feedEmpty: document.getElementById('feed-empty'),
  feedEmptyTitle: document.getElementById('feed-empty-title'),
  feedEmptyText: document.getElementById('feed-empty-text'),
  emptyExploreBtn: document.getElementById('empty-explore-btn'),
  feedLoading: document.getElementById('feed-loading'),
  updatedText: document.getElementById('updated-text'),
  refreshBtn: document.getElementById('refresh-btn'),
  segButtons: [...document.querySelectorAll('.seg-btn')],
  sideButtons: [...document.querySelectorAll('.side-btn')],
  railAccountName: document.getElementById('rail-account-name'),
  railAccountSub: document.getElementById('rail-account-sub'),
  railAvatar: document.getElementById('rail-avatar'),
  railAccount: document.getElementById('rail-account'),
  railLoginBtn: document.getElementById('rail-login-btn'),
  railLogoutBtn: document.getElementById('rail-logout-btn'),
  vpnInfo: document.getElementById('vpn-info'),
  suggestions: document.getElementById('suggestions'),
  suggestionsHint: document.getElementById('suggestions-hint'),
  openDownloadsBtn: document.getElementById('open-downloads-btn'),
  profileForm: document.getElementById('profile-form'),
  profileInput: document.getElementById('profile-input'),
  profileHeader: document.getElementById('profile-header'),
  profileActions: document.getElementById('profile-actions'),
  downloadProfileBtn: document.getElementById('download-profile-btn'),
  openDownloadsProfileBtn: document.getElementById('open-downloads-profile-btn'),
  profileOpenInstagramBtn: document.getElementById('profile-open-instagram-btn'),
  downloadStatus: document.getElementById('download-status'),
  profileGrid: document.getElementById('profile-grid'),
  profileEmpty: document.getElementById('profile-empty'),
  profileLoading: document.getElementById('profile-loading'),
  overlay: document.getElementById('login-overlay'),
  overlayLoginBtn: document.getElementById('overlay-login-btn'),
  loginWaiting: document.getElementById('login-waiting'),
  loginCancelBtn: document.getElementById('login-cancel-btn'),
  modal: document.getElementById('post-modal'),
  modalMedia: document.getElementById('modal-media'),
  modalHead: document.getElementById('modal-head'),
  modalCaption: document.getElementById('modal-caption'),
  modalStats: document.getElementById('modal-stats'),
  modalThumbs: document.getElementById('modal-thumbs'),
  modalDownloadBtn: document.getElementById('modal-download-btn'),
  modalProfileBtn: document.getElementById('modal-profile-btn'),
  modalCopyBtn: document.getElementById('modal-copy-btn'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalPrevPost: document.getElementById('modal-prev-post'),
  modalNextPost: document.getElementById('modal-next-post'),
  toasts: document.getElementById('toasts'),
};

const state = {
  status: null,
  viewer: null,
  view: 'feed',
  feedSource: localStorage.getItem('feedSource') === 'feed' ? 'feed' : 'explore',
  feed: [],
  lastUpdated: null,
  loadingFeed: false,
  currentPost: null,
  currentMediaIndex: 0,
  feedIndex: -1,
  loginPoll: null,
  currentProfile: null,
  downloadJobId: null,
  downloadTimer: null,
  lastDownloadJobId: null,
  lastDownloadDirectory: null,
};

const AUTO_REFRESH_MS = 45000;
let lastAutoRefreshAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error((data && data.error) || `Ошибка ${response.status}`);
    error.status = response.status;
    error.loginRequired = Boolean(data && data.login_required);
    throw error;
  }
  return data;
}

function toast(message, type = 'info', timeout = 4200) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 0.2s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU');
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timeAgo(timestamp) {
  const seconds = Number(timestamp) || 0;
  if (!seconds) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} д`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} нед`;
  return `${Math.floor(diff / 2592000)} мес`;
}

function imageSrc(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('/api/') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function avatarNode({ src, username, className = 'avatar', size } = {}) {
  if (src) {
    const image = document.createElement('img');
    image.className = className;
    image.src = imageSrc(src);
    image.alt = username || '';
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.replaceWith(avatarFallback(username, className));
    });
    return image;
  }
  return avatarFallback(username, className);
}

function avatarFallback(username, className = 'avatar') {
  const node = document.createElement('div');
  node.className = `${className} avatar--fallback`;
  node.textContent = (username || 'IG').trim().charAt(0).toUpperCase() || 'I';
  return node;
}

function iconButton(name, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  button.title = title;
  button.innerHTML = postIcons[name] || '';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

const postIcons = {
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>',
  profile:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-3.7 3.6-5.5 7-5.5s6.1 1.8 7 5.5"/></svg>',
  comments:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a7.5 7.5 0 0 1-11 6.6L5 20l1.4-3.7A7.5 7.5 0 1 1 20 12Z"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.5-7.5-10A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9c0 5.5-7.5 10-7.5 10Z"/></svg>',
};

/* ---------------- Session ---------------- */

function renderStatus(status) {
  state.status = status;
  const loggedIn = Boolean(status.loggedIn);
  if (status.viewer && status.viewer.username) state.viewer = status.viewer;

  el.sideLoginBtn.hidden = loggedIn;
  el.sideLogoutBtn.hidden = !loggedIn;
  el.railLoginBtn.hidden = loggedIn;
  el.railLogoutBtn.hidden = !loggedIn;
  renderViewer();

  const vpn = status.vpn || {};
  if (vpn.ip) {
    el.vpnInfo.textContent = `${vpn.country || '??'}${vpn.city ? `, ${vpn.city}` : ''} · ${vpn.ip}${vpn.org ? `\n${vpn.org}` : ''}`;
    el.vpnInfo.title = vpn.org || '';
  } else {
    el.vpnInfo.textContent = 'не определён';
  }
}

function renderViewer() {
  const viewer = state.viewer;
  const loggedIn = state.status && state.status.loggedIn;

  if (viewer && viewer.username && loggedIn) {
    el.sideProfileBtn.hidden = false;
    el.sideAvatar.innerHTML = '';
    if (viewer.profilePic) {
      const image = document.createElement('img');
      image.src = imageSrc(viewer.profilePic);
      image.alt = viewer.username;
      el.sideAvatar.appendChild(image);
    } else {
      el.sideAvatar.textContent = viewer.username.charAt(0).toUpperCase();
    }

    el.railAvatar.innerHTML = '';
    if (viewer.profilePic) {
      const image = document.createElement('img');
      image.src = imageSrc(viewer.profilePic);
      image.alt = viewer.username;
      el.railAvatar.appendChild(image);
    } else {
      el.railAvatar.textContent = viewer.username.charAt(0).toUpperCase();
    }
    el.railAccountName.textContent = `@${viewer.username}`;
    el.railAccountSub.textContent = 'Мой профиль';
  } else {
    el.sideProfileBtn.hidden = true;
    el.railAvatar.innerHTML = '';
    el.railAvatar.textContent = loggedIn ? 'IG' : '?';
    el.railAccountName.textContent = loggedIn ? 'Instagram аккаунт' : 'Гость';
    el.railAccountSub.textContent = loggedIn ? 'Сессия активна' : 'Войдите в Instagram';
  }
}

async function loadStatus() {
  try {
    const status = await api('/api/status');
    renderStatus(status);
    if (status.loggedIn) {
      hideLoginOverlay();
      if (!state.feed.length) loadFeed({ force: false });
    } else if (status.loginInProgress) {
      setLoginWaiting(true);
    } else {
      showLoginOverlay();
    }
  } catch (error) {
    el.railAccountSub.textContent = 'Сервер не отвечает';
    toast(error.message, 'error');
  }
}

function showLoginOverlay(message) {
  el.overlay.hidden = false;
  el.overlayLoginBtn.hidden = false;
  el.loginWaiting.hidden = true;
  if (message) toast(message, 'error');
}

function hideLoginOverlay() {
  el.overlay.hidden = true;
}

function setLoginWaiting(waiting) {
  el.overlay.hidden = false;
  el.loginWaiting.hidden = !waiting;
  el.overlayLoginBtn.hidden = waiting;
}

async function startLogin() {
  el.overlayLoginBtn.disabled = true;
  try {
    await api('/api/login', { method: 'POST' });
    setLoginWaiting(true);
    if (state.loginPoll) clearInterval(state.loginPoll);
    state.loginPoll = setInterval(async () => {
      try {
        const status = await api('/api/status');
        renderStatus(status);
        if (status.loggedIn) {
          clearInterval(state.loginPoll);
          state.loginPoll = null;
          setLoginWaiting(false);
          hideLoginOverlay();
          toast('Вход выполнен, загружаю ленту', 'ok');
          loadFeed({ force: true });
        } else if (!status.loginInProgress) {
          clearInterval(state.loginPoll);
          state.loginPoll = null;
          setLoginWaiting(false);
        }
      } catch {
        // Игнорируем временные ошибки опроса.
      }
    }, 2000);
  } catch (error) {
    toast(error.message, 'error');
    setLoginWaiting(false);
    el.overlay.hidden = false;
  } finally {
    el.overlayLoginBtn.disabled = false;
  }
}

async function cancelLogin() {
  try {
    await api('/api/login/cancel', { method: 'POST' });
  } catch {
    // Не критично.
  }
  if (state.loginPoll) clearInterval(state.loginPoll);
  state.loginPoll = null;
  setLoginWaiting(false);
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // Продолжаем локальный выход.
  }
  state.feed = [];
  state.lastUpdated = null;
  state.currentProfile = null;
  state.viewer = null;
  localStorage.removeItem('insta-feed-cache:feed');
  localStorage.removeItem('insta-feed-cache:explore');
  el.posts.innerHTML = '';
  el.stories.innerHTML = '';
  el.profileGrid.innerHTML = '';
  el.profileHeader.hidden = true;
  el.profileActions.hidden = true;
  el.profileOpenInstagramBtn.hidden = true;
  el.profileEmpty.hidden = false;
  closeModal();
  renderStatus({ loggedIn: false, loginInProgress: false, vpn: state.status && state.status.vpn });
  switchView('feed');
  showLoginOverlay();
  toast('Вы вышли из аккаунта', 'ok');
}

/* ---------------- Views & navigation ---------------- */

function setActiveNav(action) {
  el.sideButtons.forEach((button) => {
    const isNav = button.dataset.action === 'home' || button.dataset.action === 'explore' || button.dataset.action === 'profile';
    button.classList.toggle('is-active', button.dataset.action === action && isNav);
  });
}

function switchView(view) {
  state.view = view;
  el.layout.hidden = view !== 'feed';
  el.profileView.hidden = view !== 'profile';
  if (view === 'feed') {
    setActiveNav(state.feedSource === 'explore' ? 'explore' : 'home');
    updateFeedHeader();
  } else {
    setActiveNav('profile');
  }
}

function sourceLabel() {
  return state.feedSource === 'explore' ? 'Рекомендации' : 'Подписки';
}

function setFeedSource(source, { reload = true } = {}) {
  if (source !== 'feed' && source !== 'explore') return;
  state.feedSource = source;
  localStorage.setItem('feedSource', source);
  el.segButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.source === source));
  if (state.view === 'feed') setActiveNav(source === 'explore' ? 'explore' : 'home');
  if (!reload) return;
  state.feed = [];
  state.lastUpdated = null;
  el.posts.innerHTML = '';
  el.stories.innerHTML = '';
  hydrateFeedCache();
  updateFeedHeader();
  renderSuggestions();
  loadFeed({ force: false, reason: 'switch' });
}

/* ---------------- Feed ---------------- */

function updateFeedHeader() {
  if (state.view !== 'feed') return;
  if (!state.lastUpdated) {
    el.updatedText.textContent = 'загрузка…';
  } else {
    el.updatedText.textContent = `обновлено в ${formatTime(state.lastUpdated)}`;
  }
}

function setRefreshBusy(busy) {
  el.refreshBtn.disabled = busy;
  el.refreshBtn.textContent = busy ? 'Обновляю…' : 'Обновить';
}

async function loadFeed({ silent = false, force = true, reason = 'manual' } = {}) {
  if (state.loadingFeed) {
    if (reason === 'manual') toast('Лента уже обновляется…');
    return;
  }
  state.loadingFeed = true;
  const showSkeletons = !silent || state.feed.length === 0;
  if (showSkeletons) {
    el.feedEmpty.hidden = true;
    el.feedLoading.hidden = false;
    renderFeedSkeletons();
  }
  setRefreshBusy(true);
  if (!state.lastUpdated) el.updatedText.textContent = 'загрузка…';

  const previousCodes = new Set(state.feed.map((item) => item.code));
  try {
    const data = await api(`/api/feed?limit=48&source=${state.feedSource}${force ? '&refresh=1' : ''}`);
    const items = data.items || [];
    if (data.viewer && data.viewer.username) {
      state.viewer = data.viewer;
      renderViewer();
    }
    const freshCount = items.filter((item) => !previousCodes.has(item.code)).length;
    state.feed = items;
    state.lastUpdated = new Date(data.fetchedAt || Date.now());
    renderFeed();
    updateFeedHeader();
    saveFeedCache();

    if (reason === 'manual') {
      toast(items.length ? `Обновлено: ${items.length} постов` : 'Постов нет', 'ok', 2200);
    } else if (reason === 'auto' && previousCodes.size && freshCount > 0) {
      toast(`Новых постов: ${freshCount}`, 'ok', 3000);
    }
  } catch (error) {
    if (error.loginRequired) {
      showLoginOverlay(error.message);
      renderStatus({ loggedIn: false, loginInProgress: false, vpn: state.status && state.status.vpn });
    } else if (!silent) {
      toast(error.message, 'error', 6000);
    }
    if (!state.feed.length) updateFeedEmpty();
  } finally {
    state.loadingFeed = false;
    lastAutoRefreshAt = Date.now();
    setRefreshBusy(false);
    el.feedLoading.hidden = true;
    el.feedLoading.innerHTML = '';
  }
}

function updateFeedEmpty() {
  const isEmpty = state.feed.length === 0;
  el.feedEmpty.hidden = !isEmpty;
  if (!isEmpty) return;
  if (state.feedSource === 'feed') {
    el.feedEmptyTitle.textContent = 'В ленте подписок пусто';
    el.feedEmptyText.textContent =
      'Аккаунт, в который вы вошли, ни на кого не подписан — Instagram отдаёт только suggested-посты. Откройте «Рекомендации»: там контент есть всегда.';
    el.emptyExploreBtn.hidden = false;
  } else {
    el.feedEmptyTitle.textContent = 'Не удалось загрузить рекомендации';
    el.feedEmptyText.textContent = 'Проверьте VPN и нажмите «Обновить».';
    el.emptyExploreBtn.hidden = true;
  }
}

function feedCacheKey(source = state.feedSource) {
  return `insta-feed-cache:${source}`;
}

function hydrateFeedCache() {
  try {
    const raw = localStorage.getItem(feedCacheKey());
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items) || !data.items.length) return false;
    state.feed = data.items;
    state.lastUpdated = data.fetchedAt ? new Date(data.fetchedAt) : null;
    renderFeed();
    updateFeedHeader();
    return true;
  } catch {
    return false;
  }
}

function saveFeedCache() {
  try {
    localStorage.setItem(
      feedCacheKey(),
      JSON.stringify({
        items: state.feed.slice(0, 48),
        fetchedAt: state.lastUpdated ? state.lastUpdated.getTime() : Date.now(),
      })
    );
  } catch {
    // Кэш не влез в localStorage — не критично.
  }
}

function renderFeedSkeletons() {
  el.feedLoading.innerHTML = '';
  for (let index = 0; index < 3; index += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-post';
    skeleton.innerHTML =
      '<div class="skeleton-post-head"><span class="skeleton-circle"></span><span class="skeleton-lines"><i></i><i></i></span></div><div class="skeleton-image"></div>';
    el.feedLoading.appendChild(skeleton);
  }
}

function renderFeed() {
  renderStories();
  renderPosts();
  renderSuggestions();
  updateFeedEmpty();
}

function renderStories() {
  el.stories.innerHTML = '';
  const seen = new Set();
  const authors = [];
  for (const item of state.feed) {
    if (!item.username || seen.has(item.username)) continue;
    seen.add(item.username);
    authors.push({ username: item.username, avatar: item.userPic });
    if (authors.length >= 12) break;
  }
  for (const author of authors) {
    const story = document.createElement('button');
    story.type = 'button';
    story.className = 'story';
    story.title = `@${author.username}`;
    const ring = document.createElement('span');
    ring.className = 'story-ring';
    ring.appendChild(avatarNode({ src: author.avatar, username: author.username, className: 'story-avatar' }));
    const name = document.createElement('span');
    name.className = 'story-name';
    name.textContent = author.username;
    story.append(ring, name);
    story.addEventListener('click', () => openProfile(author.username));
    el.stories.appendChild(story);
  }
}

function createPost(item) {
  const post = document.createElement('article');
  post.className = 'post';

  const head = document.createElement('header');
  head.className = 'post-head';
  const avatar = avatarNode({ src: item.userPic, username: item.username });
  avatar.addEventListener('click', () => openProfile(item.username));
  head.appendChild(avatar);
  const userBlock = document.createElement('div');
  userBlock.className = 'post-user';
  const username = document.createElement('button');
  username.type = 'button';
  username.className = 'post-username';
  username.textContent = item.username || 'instagram';
  username.addEventListener('click', () => openProfile(item.username));
  const time = document.createElement('span');
  time.className = 'post-time';
  time.textContent = timeAgo(item.takenAt);
  userBlock.append(username, time);
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'post-menu';
  menu.title = 'Ещё';
  menu.textContent = '⋯';
  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    showPostMenu(menu, item);
  });
  head.append(userBlock, menu);

  const media = document.createElement('div');
  media.className = 'post-media';
  let clickTimer = null;
  const cover = item.media && item.media.length && item.media[0].type === 'image'
    ? item.media[0].url
    : item.thumbnail;
  const image = document.createElement('img');
  image.src = cover ? imageSrc(cover) : `/api/thumb?code=${encodeURIComponent(item.code)}`;
  image.alt = item.caption ? item.caption.slice(0, 80) : `Пост @${item.username || 'instagram'}`;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    const placeholder = document.createElement('div');
    placeholder.className = 'post-placeholder';
    placeholder.textContent = '◍';
    image.replaceWith(placeholder);
  });
  media.appendChild(image);
  if (item.media && item.media.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'post-badge';
    badge.textContent = `1/${item.media.length}`;
    media.appendChild(badge);
  }
  if (item.mediaType === 2) {
    const play = document.createElement('div');
    play.className = 'post-play';
    play.innerHTML = '<span>▶</span>';
    media.appendChild(play);
  }
  media.addEventListener('click', () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      openPost(item.code, item);
    }, 220);
  });
  media.addEventListener('dblclick', (event) => {
    event.preventDefault();
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    showHeartBurst(media);
  });

  const actions = document.createElement('div');
  actions.className = 'post-actions';
  actions.append(
    iconButton('download', 'Скачать', () => downloadItem(item)),
    iconButton('profile', 'Открыть профиль', () => openProfile(item.username)),
    iconButton('comments', 'Открыть пост', () => openPost(item.code, item)),
    iconButton('external', 'Открыть в Instagram', () => {
      window.open(`https://www.instagram.com/p/${item.code}/`, '_blank', 'noopener');
    })
  );
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  actions.appendChild(spacer);

  const likes = document.createElement('div');
  likes.className = 'post-likes';
  likes.textContent = item.likeCount ? `${formatNumber(item.likeCount)} отметок «Нравится»` : '';

  const caption = document.createElement('div');
  caption.className = 'post-caption';
  if (item.caption) {
    const author = document.createElement('button');
    author.type = 'button';
    author.className = 'post-caption-author';
    author.textContent = item.username || 'instagram';
    author.addEventListener('click', () => openProfile(item.username));
    const text = document.createElement('span');
    text.textContent = item.caption;
    caption.append(author, text);
  }

  const comments = document.createElement('button');
  comments.type = 'button';
  comments.className = 'post-comments';
  if (item.commentCount) {
    comments.textContent = `Посмотреть все ${formatNumber(item.commentCount)} комментариев`;
    comments.addEventListener('click', () => openPost(item.code, item));
  } else {
    comments.hidden = true;
  }

  post.append(head, media, actions);
  if (likes.textContent) post.appendChild(likes);
  if (caption.textContent) post.appendChild(caption);
  if (!comments.hidden) post.appendChild(comments);
  return post;
}

function showHeartBurst(container) {
  const burst = document.createElement('div');
  burst.className = 'heart-burst';
  const heart = document.createElement('span');
  heart.textContent = '♥';
  burst.appendChild(heart);
  container.appendChild(burst);
  setTimeout(() => burst.remove(), 950);
}

function renderPosts() {
  el.posts.innerHTML = '';
  for (const item of state.feed) el.posts.appendChild(createPost(item));
}

function renderSuggestions() {
  el.suggestions.innerHTML = '';
  const seen = new Set();
  const authors = [];
  for (const item of state.feed) {
    if (!item.username || seen.has(item.username)) continue;
    seen.add(item.username);
    authors.push({ username: item.username, avatar: item.userPic, likes: item.likeCount });
    if (authors.length >= 6) break;
  }

  if (!authors.length) {
    el.suggestionsHint.textContent = 'появятся после загрузки ленты';
    return;
  }
  el.suggestionsHint.textContent = '';
  for (const author of authors) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'suggestion';
    row.appendChild(avatarNode({ src: author.avatar, username: author.username }));
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'suggestion-name';
    name.textContent = author.username;
    const sub = document.createElement('div');
    sub.className = 'suggestion-sub';
    sub.textContent = author.likes ? `${formatNumber(author.likes)} лайков` : 'профиль';
    info.append(name, sub);
    const action = document.createElement('span');
    action.className = 'suggestion-action';
    action.textContent = 'Открыть';
    row.append(info, action);
    row.addEventListener('click', () => openProfile(author.username));
    el.suggestions.appendChild(row);
  }
}

function showPostMenu(anchor, item) {
  closePostMenu();
  const menu = document.createElement('div');
  menu.className = 'post-menu-popup';
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = 'Скачать пост';
  download.addEventListener('click', () => {
    closePostMenu();
    downloadItem(item);
  });
  const profile = document.createElement('button');
  profile.type = 'button';
  profile.textContent = 'Открыть профиль';
  profile.addEventListener('click', () => {
    closePostMenu();
    openProfile(item.username);
  });
  menu.append(download, profile);
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  setTimeout(() => document.addEventListener('click', closePostMenu, { once: true }), 0);
}

function closePostMenu() {
  document.querySelectorAll('.post-menu-popup').forEach((node) => node.remove());
}

/* ---------------- Post modal ---------------- */

function modalMediaSource(item) {
  return item.media && item.media[state.currentMediaIndex] ? item.media[state.currentMediaIndex] : null;
}

function renderModalMedia() {
  const item = state.currentPost;
  if (!item) return;
  el.modalMedia.innerHTML = '';
  const media = modalMediaSource(item);

  if (!media) {
    const placeholder = document.createElement('div');
    placeholder.className = 'post-placeholder';
    placeholder.textContent = 'Нет медиа';
    el.modalMedia.appendChild(placeholder);
  } else if (media.type === 'video') {
    const video = document.createElement('video');
    video.src = `/api/video?url=${encodeURIComponent(media.url)}`;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    if (item.thumbnail) video.poster = imageSrc(item.thumbnail);
    el.modalMedia.appendChild(video);
  } else {
    const image = document.createElement('img');
    image.src = imageSrc(media.url);
    image.alt = item.caption ? item.caption.slice(0, 80) : '';
    el.modalMedia.appendChild(image);
  }

  if (item.media && item.media.length > 1) {
    const left = document.createElement('button');
    left.type = 'button';
    left.className = 'modal-nav modal-nav--left';
    left.textContent = '‹';
    left.addEventListener('click', () => shiftMedia(-1));
    const right = document.createElement('button');
    right.type = 'button';
    right.className = 'modal-nav modal-nav--right';
    right.textContent = '›';
    right.addEventListener('click', () => shiftMedia(1));
    el.modalMedia.append(left, right);
  }

  el.modalThumbs.innerHTML = '';
  if (item.media && item.media.length > 1) {
    item.media.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `modal-thumb ${index === state.currentMediaIndex ? 'is-active' : ''}`;
      if (entry.type === 'image') {
        const preview = document.createElement('img');
        preview.src = imageSrc(entry.url);
        preview.alt = '';
        button.appendChild(preview);
      } else {
        button.textContent = '▶';
      }
      button.addEventListener('click', () => {
        state.currentMediaIndex = index;
        renderModalMedia();
      });
      el.modalThumbs.appendChild(button);
    });
  }
}

function renderModal() {
  const item = state.currentPost;
  if (!item) return;

  el.modalHead.innerHTML = '';
  el.modalHead.appendChild(avatarNode({ src: item.userPic, username: item.username, className: 'avatar' }));
  const info = document.createElement('div');
  const username = document.createElement('button');
  username.type = 'button';
  username.className = 'post-username';
  username.textContent = item.username || 'instagram';
  username.addEventListener('click', () => {
    closeModal();
    openProfile(item.username);
  });
  const time = document.createElement('div');
  time.className = 'post-time';
  time.textContent = timeAgo(item.takenAt);
  info.append(username, time);
  el.modalHead.appendChild(info);

  el.modalCaption.innerHTML = '';
  if (item.caption) {
    const author = document.createElement('button');
    author.type = 'button';
    author.className = 'modal-caption-author';
    author.textContent = item.username || 'instagram';
    author.addEventListener('click', () => {
      closeModal();
      openProfile(item.username);
    });
    const text = document.createElement('span');
    text.textContent = item.caption;
    el.modalCaption.append(author, text);
  }

  const stats = [];
  if (item.likeCount) stats.push(`${formatNumber(item.likeCount)} отметок «Нравится»`);
  if (item.commentCount) stats.push(`${formatNumber(item.commentCount)} комментариев`);
  stats.push(item.media && item.media.length > 1 ? `${item.media.length} файла` : '1 файл');
  el.modalStats.textContent = stats.join(' · ');

  el.modalDownloadBtn.disabled = !(item.media && item.media.length);
  renderModalMedia();
}

async function openPost(code, preview) {
  state.feedIndex = state.view === 'feed' ? state.feed.findIndex((item) => item.code === code) : -1;
  try {
    const data = await api(`/api/post/${encodeURIComponent(code)}`);
    state.currentPost = data.item;
    state.currentMediaIndex = 0;
    renderModal();
    el.modal.hidden = false;
    updatePostNav();
  } catch (error) {
    if (error.loginRequired) showLoginOverlay(error.message);
    else toast(error.message, 'error', 6000);
  }
}

function shiftMedia(delta) {
  const media = state.currentPost && state.currentPost.media;
  if (!media || media.length < 2) return;
  state.currentMediaIndex = (state.currentMediaIndex + delta + media.length) % media.length;
  renderModalMedia();
}

function updatePostNav() {
  const canNavigate = state.view === 'feed' && state.feedIndex >= 0 && state.feed.length > 1;
  el.modalPrevPost.hidden = !canNavigate || state.feedIndex <= 0;
  el.modalNextPost.hidden = !canNavigate || state.feedIndex >= state.feed.length - 1;
}

function navigatePost(delta) {
  if (!state.feed.length) return;
  let index = state.feedIndex + delta;
  if (index < 0) index = 0;
  if (index >= state.feed.length) index = state.feed.length - 1;
  if (index === state.feedIndex) return;
  const item = state.feed[index];
  openPost(item.code, item);
}

function closeModal() {
  el.modal.hidden = true;
  el.modalMedia.innerHTML = '';
  el.modalThumbs.innerHTML = '';
  state.currentPost = null;
  state.feedIndex = -1;
  updatePostNav();
}

/* ---------------- Downloads ---------------- */

async function downloadMedia(media, item, index) {
  const extension = media.type === 'video' ? 'mp4' : 'jpg';
  const author = item.username || 'instagram';
  const filename = `${author}_${item.code}_${index + 1}.${extension}`;
  const url = `/api/download?url=${encodeURIComponent(media.url)}&filename=${encodeURIComponent(filename)}&code=${encodeURIComponent(item.code)}`;
  const response = await fetch(url);
  if (!response.ok) {
    let message = `Не удалось скачать файл (${response.status})`;
    try {
      const data = await response.json();
      if (data && data.error) message = data.error;
    } catch {
      // Ответ не JSON.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

async function downloadItem(item) {
  try {
    let media = item.media || [];
    if (!media.length) {
      const data = await api(`/api/post/${encodeURIComponent(item.code)}`);
      media = (data.item && data.item.media) || [];
    }
    if (!media.length) {
      toast('У этого поста нет медиа', 'error');
      return;
    }
    toast(`Скачиваю ${media.length} файл(а)…`);
    for (const [index, entry] of media.entries()) {
      await downloadMedia(entry, item, index);
      await wait(350);
    }
    toast('Скачивание завершено', 'ok');
  } catch (error) {
    toast(error.message, 'error', 6000);
  }
}

/* ---------------- Profile ---------------- */

async function openProfile(username) {
  if (!username) return;
  switchView('profile');
  el.profileInput.value = username;
  await loadProfile(username);
}

async function loadProfile(username) {
  const clean = String(username || '').replace(/^@/, '').trim();
  if (!clean) return;
  el.profileEmpty.hidden = true;
  el.profileHeader.hidden = true;
  el.profileActions.hidden = true;
  el.profileGrid.innerHTML = '';
  el.profileLoading.hidden = false;
  el.profileLoading.innerHTML = '';
  for (let index = 0; index < 6; index += 1) {
    const tile = document.createElement('div');
    tile.className = 'skeleton';
    el.profileLoading.appendChild(tile);
  }

  try {
    const data = await api(`/api/profile/${encodeURIComponent(clean)}`);
    const profile = data.profile || { username: clean };
    const items = data.items || [];
    state.currentProfile = { username: profile.username || clean, items };
    const isOwnProfile =
      state.viewer &&
      state.viewer.username &&
      (profile.username || clean).toLowerCase() === state.viewer.username.toLowerCase();
    const avatarSource = profile.profilePic || (isOwnProfile ? state.viewer.profilePic : null);

    el.profileHeader.innerHTML = '';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'profile-avatar-wrap';
    avatarWrap.appendChild(
      avatarSource
        ? avatarNode({ src: avatarSource, username: profile.username, className: 'profile-avatar' })
        : Object.assign(avatarFallback(profile.username, 'profile-avatar'), { className: 'profile-avatar profile-avatar--fallback' })
    );

    const info = document.createElement('div');
    info.className = 'profile-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'profile-title-row';
    const title = document.createElement('h2');
    title.className = 'profile-username';
    title.textContent = profile.username || clean;
    titleRow.appendChild(title);
    info.appendChild(titleRow);

    const stats = document.createElement('div');
    stats.className = 'profile-stats';
    stats.innerHTML = `<span><b>${formatNumber(profile.postCount || items.length)}</b> публикаций</span><span><b>${formatNumber(profile.followerCount || 0)}</b> подписчиков</span><span><b>${formatNumber(profile.followingCount || 0)}</b> подписок</span>`;
    info.appendChild(stats);

    if (profile.fullName) {
      const name = document.createElement('div');
      name.className = 'profile-name';
      name.textContent = profile.fullName;
      info.appendChild(name);
    }
    if (profile.bio) {
      const bio = document.createElement('div');
      bio.className = 'profile-bio';
      bio.textContent = profile.bio;
      info.appendChild(bio);
    }

    el.profileHeader.append(avatarWrap, info);
    el.profileHeader.hidden = false;
    el.profileActions.hidden = false;
    el.downloadProfileBtn.disabled = false;
    el.profileOpenInstagramBtn.hidden = false;
    el.downloadStatus.hidden = true;
    el.downloadStatus.textContent = '';
    el.downloadStatus.className = 'download-status';
    el.openDownloadsProfileBtn.hidden = true;

    el.profileGrid.innerHTML = '';
    for (const item of items) el.profileGrid.appendChild(createProfileTile(item));
    if (!items.length) {
      el.profileEmpty.hidden = false;
      el.profileEmpty.querySelector('p').textContent = `У @${profile.username || clean} не нашлось постов.`;
    }
  } catch (error) {
    if (error.loginRequired) showLoginOverlay(error.message);
    else toast(error.message, 'error', 6000);
    el.profileEmpty.hidden = false;
    el.profileEmpty.querySelector('p').textContent = error.message;
    el.profileOpenInstagramBtn.hidden = true;
    state.currentProfile = null;
  } finally {
    el.profileLoading.hidden = true;
    el.profileLoading.innerHTML = '';
  }
}

function createProfileTile(item) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'profile-tile';
  tile.title = item.caption ? item.caption.slice(0, 60) : `@${item.username || ''}`;
  if (item.thumbnail) {
    const image = document.createElement('img');
    image.src = imageSrc(item.thumbnail);
    image.loading = 'lazy';
    image.alt = '';
    tile.appendChild(image);
  } else {
    const image = document.createElement('img');
    image.src = `/api/thumb?code=${encodeURIComponent(item.code)}`;
    image.loading = 'lazy';
    image.alt = '';
    image.addEventListener('error', () => {
      image.replaceWith(
        Object.assign(document.createElement('div'), { className: 'profile-tile-empty', textContent: '◍' })
      );
    });
    tile.appendChild(image);
  }
  const overlay = document.createElement('div');
  overlay.className = 'profile-tile-overlay';
  overlay.innerHTML = `<span>♥ ${formatNumber(item.likeCount || 0)}</span><span>💬 ${formatNumber(item.commentCount || 0)}</span>`;
  tile.appendChild(overlay);
  tile.addEventListener('click', () => openPost(item.code, item));
  return tile;
}

/* ---------------- Profile batch download ---------------- */

function updateDownloadStatus(job) {
  el.downloadStatus.hidden = false;
  el.downloadStatus.className = 'download-status';
  if (job.phase === 'starting' || job.phase === 'collecting') {
    el.downloadStatus.textContent = 'Собираю все посты профиля…';
  } else if (job.phase === 'downloading') {
    el.downloadStatus.textContent = `Скачиваю: ${job.done} из ${job.total}${job.failed ? `, ошибок ${job.failed}` : ''}`;
  } else if (job.phase === 'done') {
    el.downloadStatus.textContent = `Готово: ${job.files} файлов, постов ${job.done} из ${job.total}${job.failed ? `, ошибок ${job.failed}` : ''}`;
    el.downloadStatus.classList.add('is-ok');
    state.lastDownloadDirectory = job.directory || null;
  } else if (job.phase === 'error') {
    el.downloadStatus.textContent = job.error || 'Ошибка скачивания';
    el.downloadStatus.classList.add('is-error');
  }
}

async function startProfileDownload() {
  if (!state.currentProfile || state.downloadJobId) return;
  el.downloadProfileBtn.disabled = true;
  el.openDownloadsProfileBtn.hidden = true;
  el.downloadStatus.hidden = false;
  el.downloadStatus.className = 'download-status';
  el.downloadStatus.textContent = 'Собираю все посты профиля…';
  try {
    const data = await api(`/api/profile/${encodeURIComponent(state.currentProfile.username)}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPosts: 200 }),
    });
    state.downloadJobId = data.jobId;
    state.lastDownloadJobId = data.jobId;
    if (state.downloadTimer) clearInterval(state.downloadTimer);
    state.downloadTimer = setInterval(async () => {
      try {
        const job = await api(`/api/downloads/${encodeURIComponent(data.jobId)}`);
        updateDownloadStatus(job);
        if (job.phase === 'done' || job.phase === 'error') {
          clearInterval(state.downloadTimer);
          state.downloadTimer = null;
          state.downloadJobId = null;
          el.downloadProfileBtn.disabled = false;
          if (job.phase === 'done') {
            el.openDownloadsProfileBtn.hidden = !job.directory;
            el.openDownloadsBtn.hidden = !job.directory;
            toast(`Скачано ${job.files} файлов из ${job.done} постов`, 'ok', 4000);
          } else {
            toast(`Ошибка: ${job.error}`, 'error', 5000);
          }
        }
      } catch {
        // Временная ошибка опроса — попробуем на следующем тике.
      }
    }, 1500);
  } catch (error) {
    el.downloadProfileBtn.disabled = false;
    el.downloadStatus.className = 'download-status is-error';
    el.downloadStatus.textContent = error.message;
    toast(error.message, 'error', 6000);
  }
}

async function openLatestDownloads() {
  if (!state.lastDownloadJobId) {
    toast('Сначала скачайте профиль', 'error');
    return;
  }
  try {
    const data = await api(`/api/downloads/${encodeURIComponent(state.lastDownloadJobId)}/open`, { method: 'POST' });
    toast(`Папка: ${data.directory}`, 'ok', 4000);
  } catch (error) {
    toast(error.message, 'error', 5000);
  }
}

/* ---------------- Auto refresh ---------------- */

function startAutoRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    if (!state.status || !state.status.loggedIn) return;
    if (state.view !== 'feed') return;
    loadFeed({ silent: true, force: true, reason: 'auto' });
  }, AUTO_REFRESH_MS);

  const refreshOnReturn = () => {
    if (document.hidden) return;
    if (!state.status || !state.status.loggedIn) return;
    if (state.view !== 'feed') return;
    if (Date.now() - lastAutoRefreshAt < 15000) return;
    loadFeed({ silent: true, force: true, reason: 'auto' });
  };

  window.addEventListener('focus', refreshOnReturn);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnReturn();
  });
}

/* ---------------- Events ---------------- */

el.sideButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'home') {
      switchView('feed');
    } else if (action === 'explore') {
      switchView('feed');
      setFeedSource('explore');
    } else if (action === 'profile') {
      switchView('profile');
    } else if (action === 'my-profile') {
      if (state.viewer && state.viewer.username) openProfile(state.viewer.username);
      else switchView('profile');
    } else if (action === 'refresh') {
      if (state.view === 'feed') loadFeed({ force: true, reason: 'manual' });
      else if (state.currentProfile) loadProfile(state.currentProfile.username);
    } else if (action === 'login') {
      startLogin();
    } else if (action === 'logout') {
      logout();
    }
  });
});

el.segButtons.forEach((button) => {
  button.addEventListener('click', () => setFeedSource(button.dataset.source));
});

el.refreshBtn.addEventListener('click', () => {
  if (state.view === 'feed') loadFeed({ force: true, reason: 'manual' });
  else if (state.currentProfile) loadProfile(state.currentProfile.username);
});

el.openDownloadsBtn.addEventListener('click', openLatestDownloads);
el.openDownloadsProfileBtn.addEventListener('click', openLatestDownloads);
el.railLoginBtn.addEventListener('click', () => {
  el.overlay.hidden = false;
  setLoginWaiting(false);
});
el.railLogoutBtn.addEventListener('click', logout);
el.overlayLoginBtn.addEventListener('click', startLogin);
el.loginCancelBtn.addEventListener('click', cancelLogin);
el.emptyExploreBtn.addEventListener('click', () => setFeedSource('explore'));
el.downloadProfileBtn.addEventListener('click', startProfileDownload);

el.profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = el.profileInput.value.trim().replace(/^@/, '');
  if (username) loadProfile(username);
});

el.modalCloseBtn.addEventListener('click', closeModal);
el.modal.addEventListener('click', (event) => {
  if (event.target.dataset.close === 'true') closeModal();
});
document.addEventListener('keydown', (event) => {
  if (el.modal.hidden) return;
  if (event.key === 'Escape') {
    closeModal();
    return;
  }
  if (!state.currentPost) return;
  if (event.key === 'ArrowLeft') {
    if (state.currentPost.media && state.currentPost.media.length > 1) shiftMedia(-1);
    else navigatePost(-1);
  } else if (event.key === 'ArrowRight') {
    if (state.currentPost.media && state.currentPost.media.length > 1) shiftMedia(1);
    else navigatePost(1);
  } else if (event.key === 'ArrowUp') {
    navigatePost(-1);
  } else if (event.key === 'ArrowDown') {
    navigatePost(1);
  }
});
el.modalDownloadBtn.addEventListener('click', () => {
  if (state.currentPost) downloadItem(state.currentPost);
});
el.modalProfileBtn.addEventListener('click', () => {
  if (state.currentPost) {
    const username = state.currentPost.username;
    closeModal();
    openProfile(username);
  }
});

el.modalCopyBtn.addEventListener('click', async () => {
  if (!state.currentPost) return;
  const url = `https://www.instagram.com/p/${state.currentPost.code}/`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована', 'ok', 2200);
  } catch {
    toast(url, 'info', 5000);
  }
});

el.modalPrevPost.addEventListener('click', () => navigatePost(-1));
el.modalNextPost.addEventListener('click', () => navigatePost(1));

el.profileOpenInstagramBtn.addEventListener('click', () => {
  const username = state.currentProfile && state.currentProfile.username;
  if (username) window.open(`https://www.instagram.com/${encodeURIComponent(username)}/`, '_blank', 'noopener');
});

el.railAccount.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  if (state.viewer && state.viewer.username) openProfile(state.viewer.username);
  else switchView('profile');
});

/* ---------------- Init ---------------- */

el.segButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.source === state.feedSource));
hydrateFeedCache();
switchView('feed');
loadStatus();
startAutoRefresh();

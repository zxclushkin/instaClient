'use strict';

const CAROUSEL_KEYS = new Set(['carousel_media', 'edge_sidecar_to_children']);

function mediaUrl(candidate) {
  if (!candidate) return null;
  return candidate.url || candidate.src || candidate.src_signed || null;
}

function pushUnique(list, item) {
  if (!item || !item.url) return;
  if (list.some((existing) => existing.url === item.url)) return;
  list.push(item);
}

function collectImages(node) {
  const images = [];

  for (const key of ['image_versions2', 'image_versions', 'image_candidates']) {
    const versions = node[key];
    const candidates = versions && (versions.candidates || (Array.isArray(versions) ? versions : null));
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      const url = mediaUrl(candidate);
      if (!url) continue;
      pushUnique(images, {
        type: 'image',
        url,
        width: Number(candidate.width) || 0,
        height: Number(candidate.height) || 0,
      });
    }
  }

  for (const url of [node.display_url, node.thumbnail_url, node.thumbnail_src, node.display_src]) {
    if (typeof url === 'string' && url.startsWith('http')) {
      pushUnique(images, { type: 'image', url, width: 0, height: 0 });
    }
  }

  images.sort((a, b) => b.width * b.height - a.width * a.height);
  return images;
}

function collectVideos(node) {
  const videos = [];

  for (const key of ['video_versions', 'video_resources', 'video_candidates']) {
    const source = node[key];
    const candidates = source && (Array.isArray(source) ? source : source.candidates || source.versions);
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      const url = mediaUrl(candidate);
      if (!url) continue;
      pushUnique(videos, {
        type: 'video',
        url,
        width: Number(candidate.width) || 0,
        height: Number(candidate.height) || 0,
      });
    }
  }

  for (const url of [node.video_url, node.playback_url]) {
    if (typeof url === 'string' && url.startsWith('http')) {
      pushUnique(videos, { type: 'video', url, width: 0, height: 0 });
    }
  }

  videos.sort((a, b) => b.width * b.height - a.width * a.height);
  return videos;
}

function numberFrom(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value === 'object' && typeof value.count === 'number') return value.count;
  }
  return 0;
}

function captionFrom(node) {
  if (node.caption && typeof node.caption === 'object') return node.caption.text || '';
  if (typeof node.caption === 'string') return node.caption;
  if (typeof node.caption_text === 'string') return node.caption_text;
  const edges = node.edge_media_to_caption && node.edge_media_to_caption.edges;
  if (Array.isArray(edges) && edges.length) return edges[0]?.node?.text || '';
  return '';
}

function normalizeNode(node) {
  if (!node || typeof node !== 'object') return null;

  const code = node.code || node.shortcode;
  if (typeof code !== 'string' || !code) return null;

  const images = collectImages(node);
  const videos = collectVideos(node);
  const carousel = Array.isArray(node.carousel_media)
    ? node.carousel_media
    : (node.edge_sidecar_to_children?.edges || []).map((edge) => edge?.node).filter(Boolean);

  const media = [];
  if (carousel.length) {
    for (const child of carousel) {
      const childVideos = collectVideos(child);
      const childImages = collectImages(child);
      if (childVideos.length) pushUnique(media, childVideos[0]);
      else if (childImages.length) pushUnique(media, childImages[0]);
    }
  }
  if (!media.length) {
    if (videos.length) media.push(videos[0]);
    else if (images.length) media.push(images[0]);
  }

  const thumbnail =
    (images[0] && images[0].url) ||
    (typeof node.thumbnail_url === 'string' && node.thumbnail_url) ||
    (typeof node.thumbnail_src === 'string' && node.thumbnail_src) ||
    (typeof node.display_url === 'string' && node.display_url) ||
    (media[0] && media[0].type === 'image' ? media[0].url : null);

  if (!media.length && !thumbnail) return null;

  const user = node.user || node.owner || {};
  const mediaType = carousel.length ? 8 : videos.length ? 2 : 1;

  return {
    code,
    pk: String(node.pk ?? node.id ?? code),
    mediaType,
    username: user.username || node.username || null,
    userPic: user.profile_pic_url || user.profile_pic_url_hd || null,
    caption: captionFrom(node),
    likeCount: numberFrom(node.like_count, node.edge_liked_by, node.edge_media_preview_like, node.likes),
    commentCount: numberFrom(node.comment_count, node.edge_media_to_comment, node.comments),
    takenAt: Number(node.taken_at || node.taken_at_timestamp || 0),
    thumbnail,
    media,
  };
}

function collectMedia(payloads) {
  const items = [];
  const seenCodes = new Set();
  const visited = new WeakSet();

  const walk = (value, isCarouselChild = false) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, isCarouselChild);
      return;
    }

    if (!isCarouselChild) {
      const item = normalizeNode(value);
      if (item && !seenCodes.has(item.code)) {
        seenCodes.add(item.code);
        items.push(item);
      }
    }

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (!child || typeof child !== 'object') continue;
      walk(child, isCarouselChild || CAROUSEL_KEYS.has(key));
    }
  };

  for (const payload of payloads) walk(payload);
  items.sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0));
  return items;
}

function collectProfile(payloads, username) {
  const target = String(username || '').toLowerCase();
  let profile = null;
  const visited = new WeakSet();

  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }

    if (!profile && typeof value.username === 'string' && value.username.toLowerCase() === target) {
      profile = {
        username: value.username,
        fullName: value.full_name || value.fullName || '',
        profilePic: value.profile_pic_url || value.profile_pic_url_hd || null,
        bio: value.biography || value.bio || '',
        followerCount: numberFrom(value.follower_count, value.edge_followed_by),
        followingCount: numberFrom(value.following_count, value.edge_follow),
        postCount: numberFrom(value.media_count, value.edge_owner_to_timeline_media),
      };
    }

    for (const key of Object.keys(value)) walk(value[key]);
  };

  for (const payload of payloads) walk(payload);
  return profile;
}

module.exports = {
  collectImages,
  collectVideos,
  normalizeNode,
  collectMedia,
  collectProfile,
};

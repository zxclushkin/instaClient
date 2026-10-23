'use strict';

const assert = require('assert');
const { collectMedia, collectProfile, normalizeNode } = require('../src/extract');

const payloads = [
  {
    data: {
      xdt_api__v1__feed__timeline__connection: {
        edges: [
          {
            node: {
              media: {
                code: 'AAA111',
                pk: 1234567890123,
                media_type: 1,
                caption: { text: 'first post' },
                user: { username: 'alice', profile_pic_url: 'https://cdn.example/pic.jpg' },
                like_count: 15,
                comment_count: 3,
                taken_at: 1700000000,
                image_versions2: {
                  candidates: [
                    { url: 'https://cdn.example/small.jpg', width: 320, height: 320 },
                    { url: 'https://cdn.example/big.jpg', width: 1080, height: 1080 },
                  ],
                },
              },
            },
          },
          {
            node: {
              media: {
                code: 'BBB222',
                pk: 1234567890124,
                media_type: 2,
                caption: { text: 'video post' },
                user: { username: 'bob' },
                like_count: 40,
                video_versions: [
                  { url: 'https://cdn.example/lo.mp4', width: 480, height: 854 },
                  { url: 'https://cdn.example/hi.mp4', width: 1080, height: 1920 },
                ],
                image_versions2: { candidates: [{ url: 'https://cdn.example/cover.jpg', width: 1080, height: 1920 }] },
              },
            },
          },
          {
            node: {
              media: {
                code: 'CCC333',
                pk: 1234567890125,
                media_type: 8,
                user: { username: 'carol' },
                like_count: 7,
                carousel_media: [
                  {
                    media_type: 1,
                    image_versions2: { candidates: [{ url: 'https://cdn.example/c1.jpg', width: 1080, height: 1080 }] },
                  },
                  {
                    media_type: 2,
                    video_versions: [{ url: 'https://cdn.example/c2.mp4', width: 720, height: 1280 }],
                    image_versions2: { candidates: [{ url: 'https://cdn.example/c2.jpg', width: 720, height: 1280 }] },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
];

const items = collectMedia(payloads);
assert.strictEqual(items.length, 3, `expected 3 posts, got ${items.length}`);

const photo = items.find((item) => item.code === 'AAA111');
assert.ok(photo, 'photo post is collected');
assert.strictEqual(photo.thumbnail, 'https://cdn.example/big.jpg', 'largest image is the thumbnail');
assert.strictEqual(photo.username, 'alice');
assert.strictEqual(photo.likeCount, 15);
assert.strictEqual(photo.mediaType, 1);
assert.strictEqual(photo.pk, '1234567890123', 'pk is a string');

const video = items.find((item) => item.code === 'BBB222');
assert.ok(video, 'video post is collected');
assert.strictEqual(video.mediaType, 2);
assert.strictEqual(video.media.length, 1, 'video post has one media item');
assert.strictEqual(video.media[0].type, 'video');
assert.strictEqual(video.media[0].url, 'https://cdn.example/hi.mp4', 'largest video is picked');
assert.strictEqual(video.thumbnail, 'https://cdn.example/cover.jpg');

const carousel = items.find((item) => item.code === 'CCC333');
assert.ok(carousel, 'carousel post is collected');
assert.strictEqual(carousel.mediaType, 8);
assert.strictEqual(carousel.media.length, 2, 'carousel keeps both files');
assert.deepStrictEqual(carousel.media.map((entry) => entry.type), ['image', 'video']);

const directNode = normalizeNode({
  code: 'DDD444',
  pk: 123,
  media_type: 1,
  display_url: 'https://cdn.example/direct.jpg',
  owner: { username: 'dave' },
  edge_media_to_caption: { edges: [{ node: { text: 'edge caption' } }] },
  edge_liked_by: { count: 12 },
});
assert.strictEqual(directNode.caption, 'edge caption');
assert.strictEqual(directNode.likeCount, 12);
assert.strictEqual(directNode.media.length, 1);

const profile = collectProfile(payloads, 'alice');
assert.ok(profile, 'profile is found');

const nested = collectMedia([{ data: { user: { media: { code: 'EEE555', media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example/e.jpg', width: 100, height: 100 }] }, user: { username: 'eve' } } } } }]);
assert.strictEqual(nested.length, 1, 'deeply nested media is found');

console.log('extract tests passed:', items.length, 'posts,', carousel.media.length, 'carousel files');

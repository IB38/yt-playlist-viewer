import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistId, sortVideos, loadPlaylist } from '../src/youtube.js';

test('accepts playlist IDs and YouTube URLs, rejects foreign URLs and video-only URLs', () => {
  const id = 'PL_test-playlist_123';
  for (const value of [id, `https://www.youtube.com/playlist?list=${id}`, `youtube.com/watch?v=abc&list=${id}`, `https://music.youtube.com/playlist?list=${id}`, `https://youtu.be/abc?list=${id}`]) assert.equal(parsePlaylistId(value), id);
  for (const value of ['', 'abc', 'https://example.com/?list=PL_test-playlist_123', 'https://youtube.com/watch?v=abc', 'https://youtube.com.evil.test/?list=PL_test-playlist_123']) assert.throws(() => parsePlaylistId(value));
});

test('sorts titles, exact large view counts and upload dates; missing values stay last', () => {
  const videos = [
    { position: 0, title: 'Zebra', viewCount: null, publishedAt: null },
    { position: 1, title: 'Alpha 10', viewCount: 9007199254740993n, publishedAt: '2020-01-01' },
    { position: 2, title: 'Alpha 2', viewCount: 9007199254740992n, publishedAt: '2024-01-01' },
  ];
  const order = (key, dir) => sortVideos(videos, key, dir).map(v => v.position);
  assert.deepEqual(order('title', 'asc'), [2, 1, 0]);
  assert.deepEqual(order('title', 'desc'), [0, 1, 2]);
  assert.deepEqual(order('viewCount', 'desc'), [1, 2, 0]);
  assert.deepEqual(order('viewCount', 'asc'), [2, 1, 0]);
  assert.deepEqual(order('publishedAt', 'desc'), [2, 1, 0]);
  assert.deepEqual(order('publishedAt', 'asc'), [1, 2, 0]);
  assert.deepEqual(videos.map(v => v.position), [0, 1, 2]);
});

test('paginates all entries, batches details, preserves duplicates and unavailable videos', async () => {
  const calls = [];
  const entries = Array.from({ length: 52 }, (_, i) => ({ contentDetails: { videoId: `video${i}` }, snippet: { title: `Fallback ${i}`, publishedAt: '2026-01-01' } }));
  entries.push(entries[0]);
  const fetchImpl = async url => {
    calls.push(url);
    assert.equal(url.searchParams.get('key'), 'test-key');
    let body;
    if (url.pathname.endsWith('/playlists')) body = { items: [{ snippet: { title: 'My playlist', channelTitle: 'Owner' } }] };
    if (url.pathname.endsWith('/playlistItems')) body = url.searchParams.has('pageToken') ? { items: entries.slice(50) } : { items: entries.slice(0, 50), nextPageToken: 'next' };
    if (url.pathname.endsWith('/videos')) {
      const ids = url.searchParams.get('id').split(',');
      assert.ok(ids.length <= 50);
      body = { items: ids.filter(id => id !== 'video1').map(id => ({ id, snippet: { title: id, publishedAt: '2020-01-01', channelTitle: 'Author' }, statistics: { viewCount: '12345' } })) };
    }
    return { ok: true, json: async () => body };
  };
  const data = await loadPlaylist('PL_test-playlist_123', 'test-key', { fetchImpl });
  assert.equal(data.title, 'My playlist');
  assert.equal(data.videos.length, 53);
  assert.equal(data.videos[0].publishedAt, '2020-01-01');
  assert.equal(data.videos[0].viewCount, 12345n);
  assert.equal(data.videos[1].unavailable, true);
  assert.equal(data.videos[1].publishedAt, null);
  assert.equal(data.videos[1].viewCount, null);
  assert.equal(data.videos[52].id, 'video0');
  assert.equal(calls.length, 5);
});

test('reports quota, access, missing playlists, network errors and cancellation', async () => {
  for (const [status, reason, expected] of [[403, 'quotaExceeded', /quota/], [403, 'forbidden', /denied access/], [404, 'playlistNotFound', /not found/], [400, 'keyInvalid', /configured API key/]]) {
    await assert.rejects(loadPlaylist('x', 'k', { fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: { errors: [{ reason }] } }) }) }), expected);
  }
  await assert.rejects(loadPlaylist('x', 'k', { fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) }), /not found/);
  await assert.rejects(loadPlaylist('x', 'k', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /internet connection/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadPlaylist('x', 'k', { signal: controller.signal, fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } }), { name: 'AbortError' });
});

test('handles an empty playlist without requesting video details', async () => {
  let calls = 0;
  const data = await loadPlaylist('x', 'k', { fetchImpl: async () => ({ ok: true, json: async () => ++calls === 1 ? { items: [{ snippet: { title: 'Empty', channelTitle: 'Owner' } }] } : { items: [] } }) });
  assert.deepEqual(data.videos, []);
  assert.equal(calls, 2);
});

function cachedPlaylistFixture() {
  const batches = [];
  const videoCache = new Map();
  let fail = false;
  const fetchImpl = async url => {
    let body;
    if (url.pathname.endsWith('/playlists')) body = { items: [{ snippet: { title: 'Playlist', channelTitle: 'Owner' } }] };
    if (url.pathname.endsWith('/playlistItems')) {
      const ids = url.searchParams.get('playlistId') === 'first' ? ['shared', 'unavailable', 'shared'] : ['shared', 'new'];
      body = { items: ids.map(videoId => ({ contentDetails: { videoId }, snippet: { title: 'Fallback' } })) };
    }
    if (url.pathname.endsWith('/videos')) {
      const ids = url.searchParams.get('id').split(',');
      batches.push(ids);
      if (fail) throw new TypeError('Network failure');
      body = { items: ids.filter(id => id !== 'unavailable').map(id => ({ id, snippet: { title: id, publishedAt: '2025-01-01T23:45:12Z' }, statistics: { viewCount: '123' } })) };
    }
    return { ok: true, json: async () => body };
  };
  return { batches, videoCache, fetchImpl, setFail: value => { fail = value; } };
}

test('reuses cached videos across playlists while preserving playlist-specific links and duplicates', async () => {
  const fixture = cachedPlaylistFixture();
  await loadPlaylist('first', 'key', fixture);
  const repeated = await loadPlaylist('first', 'key', fixture);
  assert.deepEqual(fixture.batches, [['shared', 'unavailable']]);
  assert.equal(repeated.videos.length, 3);
  assert.equal(repeated.videos[1].unavailable, true);
  const overlap = await loadPlaylist('second', 'key', fixture);
  assert.deepEqual(fixture.batches, [['shared', 'unavailable'], ['new']]);
  assert.equal(overlap.videos[0].url, 'https://www.youtube.com/watch?v=shared&list=second');
  assert.equal(overlap.videos[0].viewCount, 123n);
  assert.equal(overlap.videos[0].publishedAt, '2025-01-01T23:45:12Z');
});

test('refetches expired video details and unavailable entries', async () => {
  const fixture = cachedPlaylistFixture();
  await loadPlaylist('first', 'key', fixture);
  for (const entry of fixture.videoCache.values()) entry.expiresAt = Date.now() - 1;
  await loadPlaylist('first', 'key', fixture);
  assert.deepEqual(fixture.batches, [['shared', 'unavailable'], ['shared', 'unavailable']]);
  assert.ok(fixture.videoCache.get('shared').expiresAt > Date.now());
});

test('failed and canceled video requests do not poison the cache', async () => {
  const fixture = cachedPlaylistFixture();
  fixture.setFail(true);
  await assert.rejects(loadPlaylist('first', 'key', fixture), /internet connection/);
  assert.equal(fixture.videoCache.size, 0);
  fixture.setFail(false);
  const controller = new AbortController();
  await assert.rejects(loadPlaylist('first', 'key', {
    ...fixture, signal: controller.signal,
    fetchImpl: async url => {
      const response = await fixture.fetchImpl(url);
      if (url.pathname.endsWith('/videos')) controller.abort();
      return response;
    },
  }), { name: 'AbortError' });
  assert.equal(fixture.videoCache.size, 0);
  await loadPlaylist('first', 'key', fixture);
  assert.equal(fixture.videoCache.size, 2);
  assert.equal(fixture.batches.length, 3);
});

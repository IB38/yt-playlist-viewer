export function parsePlaylistId(input) {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{10,150}$/.test(value)) return value;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch { throw new Error('Enter a valid YouTube playlist URL or playlist ID.'); }
  if (!['https:', 'http:'].includes(url.protocol) ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
    throw new Error('Use a youtube.com playlist URL or a playlist ID.');
  }
  const id = url.searchParams.get('list');
  if (!id || !/^[A-Za-z0-9_-]{10,150}$/.test(id)) {
    throw new Error('This URL does not contain a playlist ID. Copy a link with a “list=” parameter.');
  }
  return id;
}

export function sortVideos(videos, key, direction = 'asc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...videos].sort((a, b) => {
    const x = a[key], y = b[key];
    // Unknown values always go last, in either direction.
    if (x == null && y == null) return a.position - b.position;
    if (x == null) return 1;
    if (y == null) return -1;
    const order = key === 'title' ? x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
      : key === 'publishedAt' ? Date.parse(x) - Date.parse(y)
      : x < y ? -1 : x > y ? 1 : 0;
    return order * sign || a.position - b.position;
  });
}

function apiError(status, body) {
  const reason = body?.error?.errors?.[0]?.reason;
  if (['quotaExceeded', 'dailyLimitExceeded'].includes(reason)) return 'The site’s YouTube API quota has been reached. Please try again after the quota resets.';
  if (status === 404 || reason === 'playlistNotFound') return 'Playlist not found. Check the link and make sure the playlist is public or unlisted.';
  if (status === 403) return 'YouTube denied access. The playlist may be private, or the site’s API key restrictions or API settings need updating.';
  if (status === 400) return 'YouTube could not accept this request. Check the playlist ID and the configured API key.';
  return 'YouTube is temporarily unavailable. Please try again.';
}

export async function loadPlaylist(id, apiKey, { signal, onProgress = () => {}, fetchImpl = fetch } = {}) {
  async function request(endpoint, params) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    url.search = new URLSearchParams({ ...params, key: apiKey });
    let response;
    try { response = await fetchImpl(url, { signal, referrerPolicy: 'strict-origin-when-cross-origin' }); }
    catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      throw new Error('Could not connect to YouTube. Check your internet connection and try again.');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error('YouTube returned an unexpected response. Please try again.'); }
    if (!response.ok) throw new Error(apiError(response.status, body));
    return body;
  }
  onProgress('Finding your playlist…');
  const metadata = await request('playlists', { part: 'snippet', id });
  const playlist = metadata.items?.[0];
  if (!playlist) throw new Error('Playlist not found. Check the link and make sure the playlist is public or unlisted.');
  const entries = [];
  let pageToken = '';
  do {
    const page = await request('playlistItems', { part: 'snippet,contentDetails', playlistId: id, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    entries.push(...(page.items || []));
    onProgress(`Found ${entries.length.toLocaleString()} playlist entries…`);
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  const ids = [...new Set(entries.map(item => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId).filter(Boolean))];
  const details = new Map();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const page = await request('videos', { part: 'snippet,statistics', id: ids.slice(offset, offset + 50).join(',') });
    for (const video of page.items || []) details.set(video.id, video);
    onProgress(`Loading video details · ${Math.min(offset + 50, ids.length).toLocaleString()} of ${ids.length.toLocaleString()}`);
  }
  return {
    id, title: playlist.snippet.title, owner: playlist.snippet.channelTitle,
    videos: entries.map((item, position) => {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      const video = details.get(videoId);
      const count = video?.statistics?.viewCount;
      return {
        id: videoId, position,
        title: video?.snippet?.title || item.snippet?.title || 'Unavailable video',
        channel: video?.snippet?.channelTitle || '',
        url: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(id)}` : null,
        viewCount: count != null && /^\d+$/.test(String(count)) ? BigInt(count) : null,
        publishedAt: video?.snippet?.publishedAt || null,
        thumbnail: video?.snippet?.thumbnails?.medium?.url || null,
        unavailable: !video,
      };
    }),
  };
}

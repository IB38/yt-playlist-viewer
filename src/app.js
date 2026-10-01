import { config } from '../config.js';
import { loadPlaylist, parsePlaylistId, sortVideos } from './youtube.js';
import { openStorage } from './storage.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const formatDate = value => value ? date.format(new Date(value)) : '—';
const localDateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
});
let playlist = null;
let direction = 'asc';
let controller = null;
let lastSuccessfulId = null;
let userStarted = false;
const storageReady = openStorage();
let storage;

$('setup-notice').hidden = Boolean(config.youtubeApiKey.trim());

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderVideos() {
  if (!playlist) return;
  const query = $('search').value.trim().toLocaleLowerCase();
  const videos = sortVideos(playlist.videos.filter(video => video.title.toLocaleLowerCase().includes(query)), $('sort').value, direction);
  const fragment = document.createDocumentFragment();
  for (const video of videos) {
    let videoUrl = video.url;
    if (videoUrl && storage?.settings.dropPlaylist) {
      const url = new URL(videoUrl);
      url.searchParams.delete('list');
      videoUrl = url.href;
    }
    const row = element('tr');
    row.append(element('td', 'row-number', String(video.position + 1).padStart(2, '0')));
    const cell = element('td');
    const content = element('div', 'video-cell');
    const thumb = element('div', 'thumbnail', '▶');
    if (video.thumbnail) {
      const img = element('img');
      img.src = video.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), { once: true });
      thumb.append(img);
    }
    const info = element('div', 'video-info');
    const title = element(videoUrl ? 'a' : 'span', 'video-title', video.title);
    if (videoUrl) { title.href = videoUrl; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
    info.append(title);
    if (video.unavailable) info.append(element('span', 'unavailable', 'Unavailable · private or deleted'));
    else info.append(element('span', 'channel', video.channel));
    if (videoUrl) {
      const link = element('a', 'video-url', videoUrl);
      link.href = videoUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      info.append(link);
    }
    content.append(thumb, info); cell.append(content); row.append(cell);
    row.append(element('td', 'view-count', video.viewCount == null ? '—' : number.format(video.viewCount)));
    const dateCell = element('td', 'upload-date');
    const time = element('time', '', formatDate(video.publishedAt));
    if (video.publishedAt) {
      time.dateTime = video.publishedAt;
      time.title = localDateTime.format(new Date(video.publishedAt));
      time.setAttribute('aria-label', time.title);
    }
    dateCell.append(time); row.append(dateCell); fragment.append(row);
  }
  $('video-rows').replaceChildren(fragment);
  $('no-results').hidden = videos.length > 0;
  $('no-results').textContent = playlist.videos.length ? 'No videos match your search.' : 'This playlist has no videos to display.';
  $('visible-count').textContent = `${number.format(videos.length)} of ${number.format(playlist.videos.length)} videos`;
  $('direction').textContent = direction === 'asc' ? '↑' : '↓';
  const directionLabel = `Switch to ${direction === 'asc' ? 'descending' : 'ascending'} order`;
  $('direction').setAttribute('aria-label', directionLabel);
  $('direction').title = directionLabel;
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const active = th.dataset.sort === $('sort').value;
    th.setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('span').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
  });
}

function showPlaylist(data, demo = false, preserveView = false) {
  playlist = data;
  $('welcome').hidden = true;
  $('results').hidden = false;
  $('playlist-label').textContent = demo ? 'DEMO PLAYLIST · SAMPLE DATA' : 'PLAYLIST OVERVIEW';
  $('playlist-title').textContent = data.title;
  $('playlist-owner').textContent = demo ? 'A preview of what your playlist could look like. All statistics are illustrative.' : `Curated by ${data.owner}`;
  $('playlist-link').hidden = demo;
  $('freshness').hidden = demo;
  $('last-updated').textContent = data.updatedAt ? `Last updated: ${localDateTime.format(new Date(data.updatedAt))} · Oldest data shown` : '';
  $('playlist-link').href = `https://www.youtube.com/playlist?list=${encodeURIComponent(data.id)}`;
  $('video-count').textContent = number.format(data.videos.length);
  const known = data.videos.filter(video => video.viewCount != null);
  $('total-views').textContent = known.length ? number.format(known.reduce((sum, video) => sum + video.viewCount, 0n)) : '—';
  const dates = data.videos.map(video => video.publishedAt).filter(Boolean).sort();
  $('latest-upload').textContent = formatDate(dates.at(-1));
  $('latest-upload').title = dates.length ? localDateTime.format(new Date(dates.at(-1))) : '';
  const missing = data.videos.filter(video => video.unavailable).length;
  const unknown = data.videos.length - known.length;
  $('unavailable-note').hidden = !missing && !unknown;
  $('unavailable-note').textContent = `${missing ? `${missing} unavailable video${missing === 1 ? '' : 's'} retained in the list. ` : ''}${unknown ? 'Unknown view counts are excluded from the total. ' : ''}Unknown values sort last. Totals count each playlist entry.`;
  if (!preserveView) {
    $('search').value = '';
    $('sort').value = 'position';
    direction = 'asc';
  }
  renderVideos();
}

function setBusy(busy) {
  $('load-button').disabled = busy;
  $('load-button').textContent = busy ? 'Loading…' : 'Explore playlist →';
  $('cancel-button').hidden = !busy;
  $('demo-button').disabled = busy;
  $('refresh-button').disabled = busy;
  $('results').setAttribute('aria-busy', String(busy));
}

async function explore(value, force = false) {
  if (controller) return;
  userStarted = true;
  $('error').hidden = true;
  $('status').hidden = true;
  let id;
  try {
    id = parsePlaylistId(value);
  } catch (error) { $('error').textContent = error.message; $('error').hidden = false; return; }
  controller = new AbortController();
  setBusy(true);
  let showedSaved = false;
  try {
    storage = await storageReady;
    controller.signal.throwIfAborted();
    const data = await loadPlaylist(id, config.youtubeApiKey.trim(), {
      signal: controller.signal,
      videoCache: storage.videos, playlistCache: storage.playlists, force,
      onCached: data => {
        showPlaylist(data, false, playlist?.id === id);
        showedSaved = true;
      },
      onProgress: message => { $('status').hidden = false; $('status').textContent = message; },
    });
    showPlaylist(data, false, playlist?.id === id);
    lastSuccessfulId = id;
    if (storage.settings.remember) storage.settings.lastPlaylistId = id;
    await storage.save();
    updateStorageNotice();
    $('status').hidden = false;
    $('status').textContent = `Loaded ${number.format(data.videos.length)} videos.`;
  } catch (error) {
    if (controller.signal.aborted) { $('status').hidden = false; $('status').textContent = showedSaved ? 'Refresh canceled. Showing saved data.' : 'Loading canceled.'; }
    else { $('status').hidden = true; $('error').textContent = `${showedSaved ? 'Could not refresh. Showing saved data. ' : ''}${error.message}`; $('error').hidden = false; }
  } finally { controller = null; setBusy(false); }
}
$('playlist-form').addEventListener('submit', event => {
  event.preventDefault();
  explore($('playlist-input').value);
});
$('refresh-button').addEventListener('click', () => { if (playlist && playlist.id !== 'demo') explore(playlist.id, true); });
function updateStorageNotice() { $('storage-notice').hidden = storage?.persistent !== false; }
$('settings-button').addEventListener('click', () => $('settings-dialog').showModal());
$('remember-playlist').disabled = true;
$('drop-playlist').disabled = true;
$('drop-playlist').addEventListener('change', async () => {
  storage.settings.dropPlaylist = $('drop-playlist').checked;
  renderVideos();
  await storage.save();
  updateStorageNotice();
});
$('remember-playlist').addEventListener('change', async () => {
  storage.settings.remember = $('remember-playlist').checked;
  storage.settings.lastPlaylistId = storage.settings.remember ? lastSuccessfulId : null;
  await storage.save();
  updateStorageNotice();
});
$('cancel-button').addEventListener('click', () => controller?.abort());
$('search').addEventListener('input', renderVideos);
$('sort').addEventListener('change', () => { direction = ['viewCount', 'publishedAt'].includes($('sort').value) ? 'desc' : 'asc'; renderVideos(); });
$('direction').addEventListener('click', () => { direction = direction === 'asc' ? 'desc' : 'asc'; renderVideos(); });
document.querySelectorAll('th[data-sort] button').forEach(button => button.addEventListener('click', () => {
  const key = button.parentElement.dataset.sort;
  if ($('sort').value === key) direction = direction === 'asc' ? 'desc' : 'asc';
  else { $('sort').value = key; direction = key === 'title' ? 'asc' : 'desc'; }
  renderVideos();
}));
$('demo-button').addEventListener('click', () => {
  userStarted = true;
  $('error').hidden = true; $('status').hidden = true;
  const samples = [
    ['The art of paying attention', 'The Curious Mind', 1284530n, '2025-08-14'],
    ['Why good design feels invisible', 'Design Notes', 892104n, '2025-11-03'],
    ['A small guide to big ideas', 'The Curious Mind', 2418900n, '2024-06-22'],
    ['Finding creativity in everyday places', 'Studio Sessions', 346781n, '2026-01-18'],
    ['How we learn something new', 'Open Questions', 1705622n, '2025-03-09'],
    ['Make time for what matters', 'Slow Sundays', 623450n, '2026-02-01'],
  ];
  showPlaylist({ id: 'demo', title: 'A little curiosity goes a long way', owner: 'Playlist Lens', videos: samples.map(([title, channel, viewCount, publishedAt], position) => ({ title, channel, viewCount, publishedAt, position, url: null, thumbnail: null, unavailable: false })) }, true);
});
storageReady.then(value => {
  storage = value;
  $('remember-playlist').checked = storage.settings.remember;
  $('remember-playlist').disabled = false;
  $('drop-playlist').checked = storage.settings.dropPlaylist;
  $('drop-playlist').disabled = false;
  renderVideos();
  updateStorageNotice();
  if (!userStarted && storage.settings.remember && storage.settings.lastPlaylistId) {
    $('playlist-input').value = storage.settings.lastPlaylistId;
    explore(storage.settings.lastPlaylistId);
  }
});

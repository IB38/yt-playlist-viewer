const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeSettings(value = {}) {
  return {
    remember: value.remember === true,
    lastPlaylistId: value.remember === true && typeof value.lastPlaylistId === 'string' ? value.lastPlaylistId : null,
    dropPlaylist: value.dropPlaylist === true,
    sortKey: value.remember === true && ['position', 'title', 'viewCount', 'publishedAt'].includes(value.sortKey) ? value.sortKey : 'position',
    sortDirection: value.remember === true && value.sortDirection === 'desc' ? 'desc' : 'asc',
  };
}

// Database names are scoped to this app, since GitHub Pages projects share an origin.
export async function openStorage(indexedDB, databaseName = 'playlist-lens-v1') {
  const state = { videos: new Map(), playlists: new Map(), settings: normalizeSettings() };
  let db;
  let persistent = true;
  let queue = Promise.resolve();
  function transact(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      action(tx.objectStore('records'));
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage transaction failed'));
    });
  }
  try {
    indexedDB ??= globalThis.indexedDB;
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('Storage unavailable')); }, 3000);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
      request.onerror = request.onblocked = () => { clearTimeout(timer); reject(request.error || new Error('Storage blocked')); };
    });
    db.onversionchange = () => { db.close(); persistent = false; };
    await transact('readwrite', store => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const { key, value } = cursor;
        if (key === 'settings') {
          state.settings = normalizeSettings(value);
        } else if (!Number.isFinite(value.savedAt) || value.savedAt < Date.now() - RETENTION_MS) cursor.delete();
        else if (key.startsWith('video:')) state.videos.set(key.slice(6), value);
        else if (key.startsWith('playlist:')) state.playlists.set(key.slice(9), value);
        cursor.continue();
      };
    });
  } catch { persistent = false; db?.close(); }

  return {
    ...state,
    get persistent() { return persistent; },
    close() { db?.close(); persistent = false; },
    save() {
      // Serialize writes so disabling remembrance cannot be undone by an older save.
      queue = queue.then(async () => {
        if (!persistent) return;
        try {
          await transact('readwrite', store => {
            for (const [id, entry] of state.videos) {
              if (entry.savedAt < Date.now() - RETENTION_MS) { state.videos.delete(id); store.delete(`video:${id}`); }
              else store.put(entry, `video:${id}`);
            }
            for (const [id, entry] of state.playlists) {
              if (entry.savedAt < Date.now() - RETENTION_MS) { state.playlists.delete(id); store.delete(`playlist:${id}`); }
              else store.put(entry, `playlist:${id}`);
            }
            store.put(state.settings, 'settings');
          });
        } catch { persistent = false; db?.close(); }
      });
      return queue;
    },
  };
}

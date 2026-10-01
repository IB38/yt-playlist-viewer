# Playlist Lens

A responsive, single-page YouTube playlist explorer for GitHub Pages. Plain HTML, CSS, and JavaScript; no runtime dependencies or backend.

## Run locally

Requires Node.js 22 or later. No package installation is needed.

```sh
npm run dev
```

Open http://127.0.0.1:5173. Use **Try a demo** for an explicitly labeled preview without an API key. Demo titles and statistics are fictional; real playlist links appear when loading from YouTube.

## Configure the shared YouTube API key

1. Create a Google Cloud project and enable **YouTube Data API v3**.
2. Create an API key under **APIs & Services → Credentials**.
3. Under API restrictions, restrict the key to **YouTube Data API v3**.
4. Under application restrictions, choose **Websites (HTTP referrers)** and allow your deployed origin, for example `https://YOUR_USERNAME.github.io/*`. Add your custom domain if applicable. For local development, allow `http://127.0.0.1:5173/*` (or use a separate development key).
5. Set `youtubeApiKey` in `config.js` for local use, or set the GitHub repository Actions **variable** `YOUTUBE_API_KEY` for deployment.

This is a browser application: the shared key is visible to visitors and consumes a shared quota. A build variable or GitHub secret cannot hide a key embedded in a static site. Restrict the key, monitor quota, and rotate it if needed. The app never stores API keys in browser storage. Playlist data, video details, and the optional remembered playlist selection are saved locally in IndexedDB. Requests go directly to Google; the stylesheet also loads Google Fonts with system font fallbacks.

Documentation: [YouTube API setup](https://developers.google.com/youtube/v3/getting-started), [API key restrictions](https://cloud.google.com/docs/authentication/api-keys#api_key_restrictions).

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository with a `main` or `master` branch.
2. In **Settings → Secrets and variables → Actions → Variables**, add `YOUTUBE_API_KEY` with the restricted shared API key.
3. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
4. Push to `main` or `master`, or manually run **Deploy to GitHub Pages** from the Actions tab.

The included workflow runs tests, builds `dist/`, and publishes it. All assets use relative URLs, so repository subpaths and custom domains work. If your default branch is neither `main` nor `master`, update the workflow trigger.

Alternatively, configure `config.js` and publish the repository root through Pages' **Deploy from a branch** option. The root is already a complete static site. No routing rewrite is required.

```sh
npm test
npm run build
```

`npm run build` copies deployable assets to `dist/`. If the `YOUTUBE_API_KEY` environment variable is set, it overrides `config.js` in the build output only.

## Behavior

- Accepts a playlist ID or a YouTube URL containing a `list` parameter, including mobile, music, and watch links.
- Loads the playlist name and every available page of playlist entries, then fetches video metadata in batches of 50 unique video IDs.
- Persists playlist names and membership for 1 hour and video details (including unavailable results) by video ID for 24 hours in IndexedDB. Overlapping playlists reuse video details. Fresh saved results need no API requests; expired results appear immediately while the app refreshes them. Failed refreshes retain the saved view. Refresh now bypasses both caches. Last updated reports the oldest data in the displayed result.
- The gear button opens Settings. Remember last playlist defaults to off; enabling it saves the last successfully loaded playlist and automatically reopens it on future visits. Disabling it removes the saved selection without deleting the cache. Demo data is never remembered or cached.
- Cache records older than 7 days are removed when storage opens or saves. Storage is browser/device-specific and may be evicted by the browser. Storage failures fall back to memory and show a notice in Settings. API keys are never persisted. Failed or canceled API requests are not cached.
- Lists each video's title, clickable URL, exact view count, and upload/publication date in UTC.
- Hover over an upload date to see the full publication date and time in your browser's local timezone, including the timezone name.
- Sorts by title, view count, or date in either direction, or restores playlist order. Title search works locally without API requests.
- Preserves repeated entries and marks private/deleted entries when YouTube returns them. Unknown values sort last. The total sums video view counts per playlist entry, not views attributable to the playlist.
- Uses the video's `snippet.publishedAt`, not the date it was added to the playlist. YouTube's public publication timestamp may differ from the original upload time for formerly private videos.
- Supports canceling a load and explains invalid input, missing configuration, inaccessible playlists, quota errors, and network failures. A failed load keeps the previous successful result visible.
- Supports playlists accessible with an API key (public and accessible unlisted playlists). Private playlists require OAuth and are outside this app's scope. Some special/generated YouTube lists are not exposed through the API.

API references: [playlists.list](https://developers.google.com/youtube/v3/docs/playlists/list), [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list), [videos.list](https://developers.google.com/youtube/v3/docs/videos/list).

Tests use mocked YouTube responses to cover URL validation, sorting, pagination, batching, duplicates, unavailable entries, empty playlists, errors, and cancellation. A live API check requires your configured key.

For real IndexedDB integration checks, run the local server and open `/test/storage-browser.html`. This uses an isolated temporary database to verify persistence, BigInt serialization, cleanup, and the remembered selection. Test pages are excluded from the production build.

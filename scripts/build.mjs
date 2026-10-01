import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist/src', { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', 'config.js', 'src/app.js', 'src/youtube.js', 'src/storage.js']) {
  await copyFile(file, `dist/${file}`);
}
if (process.env.YOUTUBE_API_KEY?.trim()) {
  await writeFile('dist/config.js', `export const config = ${JSON.stringify({ youtubeApiKey: process.env.YOUTUBE_API_KEY.trim() })};\n`);
}
await writeFile('dist/.nojekyll', '');
console.log('Built static site in dist/');

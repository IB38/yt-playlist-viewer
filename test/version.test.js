import test from 'node:test';
import assert from 'node:assert/strict';
import { getVersion, injectVersion } from '../scripts/version.mjs';

const hash = '1234567890abcdef1234567890abcdef12345678';
const git = (branch, status) => args => args[0] === 'rev-parse' ? hash : args[0] === 'branch' ? branch : status;

test('deployment metadata takes priority over the local checkout', () => {
  assert.equal(getVersion({ env: { VERSION_BRANCH: 'master', VERSION_COMMIT: hash }, git: () => { throw new Error('Must not call Git'); } }), 'master@1234567');
});

test('local versions distinguish clean, dirty, and detached checkouts', () => {
  assert.equal(getVersion({ env: {}, git: git('feature/version', '') }), 'feature/version@1234567');
  assert.equal(getVersion({ env: {}, git: git('master', ' M index.html') }), 'master@1234567-dirty');
  assert.equal(getVersion({ env: {}, git: git('master', '?? new-file') }), 'master@1234567-dirty');
  assert.equal(getVersion({ env: {}, git: git('', '') }), 'detached@1234567');
});

test('missing Git metadata falls back to Development', () => {
  assert.equal(getVersion({ env: {}, git: () => { throw new Error('Not a repository'); } }), 'Development');
});

test('version insertion escapes branch names and leaves the rest of the page intact', () => {
  const html = '<footer>Playlist Lens · <span id="site-version">Development</span></footer>';
  assert.equal(injectVersion(html, 'feature/<test>&$&@1234567'), '<footer>Playlist Lens · <span id="site-version">feature/&lt;test&gt;&amp;$&amp;@1234567</span></footer>');
});

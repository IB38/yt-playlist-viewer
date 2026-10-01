import { execFileSync } from 'node:child_process';

function readGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

export function getVersion({ env = process.env, git = readGit } = {}) {
  const branch = env.VERSION_BRANCH?.trim();
  const commit = env.VERSION_COMMIT?.trim();
  if (branch && /^[a-f\d]{7,64}$/i.test(commit || '')) return `${branch}@${commit.slice(0, 7)}`;
  try {
    const hash = git(['rev-parse', 'HEAD']);
    const ref = git(['branch', '--show-current']) || 'detached';
    const dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
    return `${ref}@${hash.slice(0, 7)}${dirty ? '-dirty' : ''}`;
  } catch { return 'Development'; }
}

export function injectVersion(html, version) {
  const escaped = version.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return html.replace('<span id="site-version">Development</span>', () => `<span id="site-version">${escaped}</span>`);
}

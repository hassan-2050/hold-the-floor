// Publish the web replay page (dist/web, from `npm run build:web`) to the
// repository's gh-pages branch, which GitHub Pages serves.
//   npm run deploy:web
// Pushes to the `origin` remote with your normal git credentials, replacing
// the previous gh-pages commit (the branch holds only the built page).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist', 'web');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/web is missing: run npm run build:web first');

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const origin = git(['remote', 'get-url', 'origin'], root);
const sha = git(['rev-parse', '--short', 'HEAD'], root);
const [name, email] = git(['log', '-1', '--format=%an%n%ae'], root).split('\n');

const tmp = mkdtempSync(join(tmpdir(), 'htf-pages-'));
try {
  cpSync(dist, tmp, { recursive: true });
  git(['init', '-q', '-b', 'gh-pages'], tmp);
  git(['add', '-A'], tmp);
  git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `Web replay page from ${sha}`], tmp);
  execFileSync('git', ['push', '--force', '--quiet', origin, 'gh-pages'], { cwd: tmp, stdio: 'inherit' });
  console.log(`Published dist/web (from ${sha}) to the gh-pages branch of ${origin}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

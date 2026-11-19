import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexPath = resolve('dist/index.html');
assert(existsSync(indexPath), '找不到 dist/index.html；請先執行 npm run build');
const html = readFileSync(indexPath, 'utf8');
assert(!html.includes('/src/main.tsx'), '建置結果仍引用開發期 src/main.tsx');

const expectedBase = process.env.VITE_BASE_PATH || (() => {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  return owner && repo && repo.toLowerCase() !== `${owner.toLowerCase()}.github.io` ? `/${repo}/` : '/';
})();
const assetUrls = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map(match => match[1]);
assert(assetUrls.length > 0, 'index.html 未產生 CSS 或 JavaScript 資產連結');
for (const assetUrl of assetUrls) {
  assert(assetUrl.startsWith(expectedBase), `資產路徑 ${assetUrl} 未使用預期 GitHub Pages base ${expectedBase}`);
}
console.log(`PASS: dist/index.html 已產生，資產使用 GitHub Pages base ${expectedBase}`);

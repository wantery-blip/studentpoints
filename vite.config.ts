import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 專案網站會部署在 /<repository>/；username.github.io 則在根目錄。
// GitHub Actions 會提供 GITHUB_REPOSITORY，因此不必將帳號或倉庫名稱寫死在程式中。
function githubPagesBase(repository = process.env.GITHUB_REPOSITORY) {
  const [owner, repo] = (repository || '').split('/');
  if (!owner || !repo || repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) return '/';
  return `/${repo}/`;
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || githubPagesBase(),
  plugins: [react()]
});

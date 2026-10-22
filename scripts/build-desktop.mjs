import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('build/desktop', { recursive: true });
for (const file of ['index.html', 'app.css', 'theme.css', 'lan.html', 'lan.css', 'markdown.css']) {
  await copyFile(`desktop/${file}`, `build/desktop/${file}`);
}
await mkdir('build/desktop/vendor', { recursive: true });
await copyFile(
  new URL(import.meta.resolve('markdown-it/browser')),
  'build/desktop/vendor/markdown-it.js',
);
await copyFile(
  new URL('./LICENSE', import.meta.resolve('markdown-it/package.json')),
  'build/desktop/vendor/markdown-it.LICENSE',
);

import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('build/desktop', { recursive: true });
for (const file of ['index.html', 'app.css', 'theme.css', 'lan.html', 'lan.css']) {
  await copyFile(`desktop/${file}`, `build/desktop/${file}`);
}

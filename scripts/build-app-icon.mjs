import sharp from 'sharp';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('Skipping the macOS iconset outside macOS.');
} else {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const iconset = join(root, 'build/dungeon-master.iconset');
  const icns = join(root, 'build/dungeon-master.icns');
  const svg = await readFile(join(root, 'desktop/assets/app-icon.svg'));
  const sizes = [16, 32, 64, 128, 256, 512];
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  for (const size of sizes) {
    await sharp(svg)
      .resize(size)
      .png()
      .toFile(join(iconset, `icon_${size}x${size}.png`));
    await sharp(svg)
      .resize(size * 2)
      .png()
      .toFile(join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
  console.log(`Built ${icns}`);
}

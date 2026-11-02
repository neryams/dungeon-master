import sharp from 'sharp';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function pngToIco(pngBuffer) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, pngBuffer]);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildDir = join(root, 'build');
const svg = await readFile(join(root, 'desktop/assets/app-icon.svg'));
await mkdir(buildDir, { recursive: true });
const png256 = await sharp(svg).resize(256, 256).png().toBuffer();
const pngPath = join(buildDir, 'dungeon-master.png');
const icoPath = join(buildDir, 'dungeon-master.ico');
await writeFile(pngPath, png256);
await writeFile(icoPath, pngToIco(png256));

if (process.platform !== 'darwin') {
  console.log(`Built ${icoPath} and ${pngPath} (skipping macOS iconset outside macOS).`);
} else {
  const iconset = join(root, 'build/dungeon-master.iconset');
  const icns = join(root, 'build/dungeon-master.icns');
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

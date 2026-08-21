import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

// Minimal PNG encoder (RGB, no interlace) — enough for e2e fixtures with
// exact dimensions, so the bubble layout can be asserted against metadata.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

// Solid-color PNG of the given size.
export function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.alloc(1 + width * 3); // filter byte + RGB pixels
  row.fill(0x7f, 1);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Attach an image through the editor and send it with a caption.
export async function sendImage(
  page: Page,
  png: Buffer,
  caption?: string,
): Promise<void> {
  await page.getByTestId('image-input').setInputFiles({
    name: 'pic.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByTestId('image-editor')).toBeVisible();
  if (caption) await page.getByTestId('image-caption').fill(caption);
  await page.getByTestId('image-send').click();
  await expect(page.getByTestId('image-editor')).toHaveCount(0);
}

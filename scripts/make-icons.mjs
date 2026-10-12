// Generates icons/icon{16,32,48,128}.png with no dependencies (zlib + hand-written PNG encoder).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Shapes in unit coordinates (0..1). Returns [r,g,b,a] for a sample point.
function sample(x, y) {
  if (!inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) return [0, 0, 0, 0];
  const t = y; // vertical gradient violet
  let c = [124 + (91 - 124) * t, 58 + (33 - 58) * t, 237 + (182 - 237) * t, 255];
  // back tab (translucent white)
  if (inRoundRect(x, y, 0.30, 0.20, 0.82, 0.62, 0.07)) c = [c[0] * 0.45 + 255 * 0.55, c[1] * 0.45 + 255 * 0.55, c[2] * 0.45 + 255 * 0.55, 255];
  // front tab: header tab + body
  const front = inRoundRect(x, y, 0.18, 0.40, 0.70, 0.82, 0.07) || inRoundRect(x, y, 0.18, 0.32, 0.42, 0.46, 0.05);
  if (front) c = [255, 255, 255, 255];
  // accent line inside front tab
  if (inRoundRect(x, y, 0.27, 0.56, 0.58, 0.62, 0.03) || inRoundRect(x, y, 0.27, 0.67, 0.50, 0.73, 0.03)) c = [124, 58, 237, 255];
  return c;
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
      acc = [acc[0] + s[0] * s[3], acc[1] + s[1] * s[3], acc[2] + s[2] * s[3], acc[3] + s[3]];
    }
    const a = acc[3] / (ss * ss), i = (py * size + px) * 4;
    buf[i] = a ? acc[0] / acc[3] : 0; buf[i + 1] = a ? acc[1] / acc[3] : 0; buf[i + 2] = a ? acc[2] / acc[3] : 0; buf[i + 3] = a;
  }
  writeFileSync(`icons/icon${size}.png`, png(size, buf));
}
console.log('icons written');

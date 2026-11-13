// Draws the plugin icon (512x512 PNG) without any image library: a rounded square with a speech bubble
// holding a check mark ("explained and verified"). Run: node scripts/make-icon.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const px = new Uint8Array(SIZE * SIZE * 4);

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inTriangle = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (px1, py1, px2, py2, px3, py3) => (px1 - px3) * (py2 - py3) - (px2 - px3) * (py1 - py3);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const nearSegment = (x, y, [ax, ay], [bx, by], width) => {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return (x - (ax + t * (bx - ax))) ** 2 + (y - (ay + t * (by - ay))) ** 2 <= (width / 2) ** 2;
};

const BG = [37, 99, 235]; // blue
const BUBBLE = [255, 255, 255];
const CHECK = [22, 163, 74]; // green

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let color = null;
    if (inRoundRect(x, y, 0, 0, SIZE - 1, SIZE - 1, 96)) color = BG;
    const bubble = inRoundRect(x, y, 96, 112, 416, 352, 56) || inTriangle(x, y, [160, 340], [250, 340], [140, 420]);
    if (bubble) color = BUBBLE;
    if (bubble && (nearSegment(x, y, [176, 236], [236, 296], 36) || nearSegment(x, y, [236, 296], [344, 176], 36))) color = CHECK;
    const i = (y * SIZE + x) * 4;
    if (color) {
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

// PNG encoding: signature, IHDR, IDAT (filter 0 per row), IEND.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "icon.png");
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);

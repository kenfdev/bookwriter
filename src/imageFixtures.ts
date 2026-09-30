import { deflateSync } from "node:zlib";

/** Picture fixtures for the PDF tests: small PNGs and JPEGs built byte by byte. */

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Build a PNG. `rows` are unfiltered scanlines; `filter` applies PNG filter 0 (none) or 1 (sub). */
export function makePng(options: {
  width: number;
  height: number;
  colorType: number;
  depth?: number;
  rows: number[][];
  palette?: number[];
  trns?: number[];
  filter?: 0 | 1;
  bytesPerPixel?: number;
}): Buffer {
  const depth = options.depth ?? 8;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width, 0);
  header.writeUInt32BE(options.height, 4);
  header[8] = depth;
  header[9] = options.colorType;
  const raw: number[] = [];
  for (const row of options.rows) {
    raw.push(options.filter ?? 0);
    if (options.filter === 1) {
      const bpp = options.bytesPerPixel ?? 1;
      row.forEach((value, i) => raw.push((value - (i >= bpp ? row[i - bpp] : 0) + 256) & 0xff));
    } else raw.push(...row);
  }
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header)];
  if (options.palette) parts.push(chunk("PLTE", Buffer.from(options.palette)));
  if (options.trns) parts.push(chunk("tRNS", Buffer.from(options.trns)));
  parts.push(chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** A JPEG with real headers (Exif orientation, SOF0) and a stand-in scan; enough for the PDF writer, which never decodes it. */
export function makeJpeg(width: number, height: number, components = 3, orientation = 1): Buffer {
  const segment = (marker: number, body: number[]) => Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const sof = [8, height >> 8, height & 255, width >> 8, width & 255, components];
  for (let c = 1; c <= components; c++) sof.push(c, 0x11, 0);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe1, exif), segment(0xc0, sof), Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
}

/** Undo ASCII85 (test helper). */
export function unascii85(text: string): Uint8Array {
  const body = text.replace(/\s/g, "").replace(/~>$/, "");
  const out: number[] = [];
  let group: number[] = [];
  const emit = (digits: number[], keep: number) => {
    const padded = [...digits];
    while (padded.length < 5) padded.push(84);
    let value = 0;
    for (const d of padded) value = value * 85 + d;
    const bytes = [(value / 2 ** 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, keep));
  };
  for (const ch of body) {
    if (ch === "z") {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      emit(group, 4);
      group = [];
    }
  }
  if (group.length > 1) emit(group, group.length - 1);
  return Uint8Array.from(out);
}

/** A PNG from a ready-made header and already-filtered scanline data. */
export function makePngRaw(header: Buffer, filtered: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

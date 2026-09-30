/**
 * Picture decoding for the PDF export.
 *
 * Every stream is returned as ASCII85 text, so the finished PDF stays plain ASCII
 * and can still be saved through the ordinary text writer. JPEG data goes into the
 * PDF untouched (DCTDecode). PNG data is passed through untouched when the PDF can
 * read it as it is; otherwise it is decoded here and stored as Flate-compressed
 * samples, with any transparency in a separate soft mask. Compression and
 * decompression use the web streams API, which both Node and the Tauri webview have.
 */

export type PdfImage = {
  /** Pixel size of the stored data, before any orientation is applied. */
  width: number;
  height: number;
  /** EXIF orientation 1..8 (JPEG only; 1 otherwise). */
  orientation: number;
  /** PDF colour space object text, e.g. `/DeviceRGB`. */
  colorSpace: string;
  bpc: number;
  /** Stream filters, outermost first; the first is always ASCII85Decode. */
  filters: string[];
  /** Extra dictionary entries: /DecodeParms, /Decode, /Mask. */
  extra: string;
  /** ASCII85 text including the `~>` end mark. */
  data: string;
  /** Transparency as an 8-bit grey soft mask of the same size. */
  alpha?: string;
};

export type Raster = { width: number; height: number; rgba: ArrayLike<number> };

export type EncodeOptions = {
  /** Decode formats this module cannot (GIF, WebP…) into RGBA, if the runtime can. */
  rasterize?: (bytes: Uint8Array) => Promise<Raster | null>;
};

export function ascii85(bytes: Uint8Array): string {
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const n = Math.min(4, bytes.length - i);
    let value = 0;
    for (let k = 0; k < 4; k++) value = value * 256 + (k < n ? bytes[i + k] : 0);
    if (n === 4 && value === 0) {
      current += "z";
    } else {
      const digits = [0, 0, 0, 0, 0];
      for (let k = 4; k >= 0; k--) {
        digits[k] = value % 85;
        value = Math.floor(value / 85);
      }
      for (let k = 0; k <= n; k++) current += String.fromCharCode(digits[k] + 33);
    }
    if (current.length >= 75) {
      lines.push(current);
      current = "";
    }
  }
  lines.push(current + "~>");
  return lines.join("\n");
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A valid zlib stream that stores the data uncompressed. Used when compression is unavailable. */
export function storedZlib(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  let pos = 0;
  out[pos++] = 0x78;
  out[pos++] = 0x01;
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535;
    const size = Math.min(65535, bytes.length - start);
    out[pos++] = block === blocks - 1 ? 1 : 0;
    out[pos++] = size & 0xff;
    out[pos++] = size >> 8;
    out[pos++] = ~size & 0xff;
    out[pos++] = (~size >> 8) & 0xff;
    out.set(bytes.subarray(start, start + size), pos);
    pos += size;
  }
  const sum = adler32(bytes);
  out[pos++] = sum >>> 24;
  out[pos++] = (sum >>> 16) & 0xff;
  out[pos++] = (sum >>> 8) & 0xff;
  out[pos++] = sum & 0xff;
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  const result = await new Response(source.pipeThrough(stream as unknown as ReadableWritablePair)).arrayBuffer();
  return new Uint8Array(result);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return storedZlib(bytes);
  return pipe(bytes, new CompressionStream("deflate"));
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("this runtime cannot unpack PNG data");
  try {
    return await pipe(bytes, new DecompressionStream("deflate"));
  } catch {
    throw new Error("the PNG data is damaged");
  }
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}

function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Turn a picture file into PDF image data. Throws an Error with a short reason when it cannot. */
export async function encodeImage(bytes: Uint8Array, options: EncodeOptions = {}): Promise<PdfImage> {
  if (isJpeg(bytes)) return encodeJpeg(bytes);
  if (isPng(bytes)) return encodePng(bytes);
  if (options.rasterize) {
    let raster: Raster | null = null;
    try {
      raster = await options.rasterize(bytes);
    } catch {
      raster = null;
    }
    if (raster) return encodeRaster(raster);
  }
  throw new Error("only JPEG and PNG pictures can be placed in the PDF");
}

// ---------------------------------------------------------------- JPEG

const SOF_SUPPORTED = new Set([0xc0, 0xc1, 0xc2]);
const SOF_OTHER = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export type JpegInfo = { width: number; height: number; components: number; orientation: number; adobeTransform: number | null };

export function parseJpeg(b: Uint8Array): JpegInfo {
  let pos = 2;
  let sof: { width: number; height: number; components: number } | null = null;
  let orientation = 1;
  let adobeTransform: number | null = null;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = u16(b, pos + 2);
    const body = pos + 4;
    const end = pos + 2 + length;
    if (length < 2 || end > b.length) throw new Error("the JPEG is cut short");
    if (SOF_OTHER.has(marker)) throw new Error("this kind of JPEG (lossless or arithmetic) is not supported");
    if (SOF_SUPPORTED.has(marker) && !sof) {
      if (b[body] !== 8) throw new Error("only 8-bit JPEGs are supported");
      sof = { height: u16(b, body + 1), width: u16(b, body + 3), components: b[body + 5] };
    } else if (marker === 0xe1 && text(b, body, 6) === "Exif\0\0") {
      orientation = exifOrientation(b, body + 6, end);
    } else if (marker === 0xee && text(b, body, 5) === "Adobe" && length >= 14) {
      adobeTransform = b[body + 11];
    }
    pos = end;
  }
  if (!sof || sof.width === 0 || sof.height === 0) throw new Error("the JPEG has no picture data");
  if (![1, 3, 4].includes(sof.components)) throw new Error("this JPEG colour layout is not supported");
  return { ...sof, orientation, adobeTransform };
}

function text(b: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && at + i < b.length; i++) out += String.fromCharCode(b[at + i]);
  return out;
}

function exifOrientation(b: Uint8Array, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = b[tiff] === 0x49;
  const read16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : u16(b, o));
  const read32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : u32(b, o));
  const ifd = tiff + read32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = read16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function encodeJpeg(bytes: Uint8Array): PdfImage {
  const info = parseJpeg(bytes);
  const colorSpace = info.components === 1 ? "/DeviceGray" : info.components === 3 ? "/DeviceRGB" : "/DeviceCMYK";
  const extra: string[] = [];
  if (info.adobeTransform !== null && info.components >= 3) {
    // Adobe files say whether the channels are YCbCr/YCCK (non-zero) or stored as they are (0).
    extra.push(`/DecodeParms [null << /ColorTransform ${info.adobeTransform === 0 ? 0 : 1} >>]`);
  }
  // Adobe CMYK JPEGs store inverted values.
  if (info.components === 4 && info.adobeTransform !== null) extra.push("/Decode [1 0 1 0 1 0 1 0]");
  return {
    width: info.width,
    height: info.height,
    orientation: info.orientation,
    colorSpace,
    bpc: 8,
    filters: ["ASCII85Decode", "DCTDecode"],
    extra: extra.join(" "),
    data: ascii85(bytes),
  };
}

// ---------------------------------------------------------------- PNG

type Png = {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
  palette: Uint8Array | null;
  trns: Uint8Array | null;
  idat: Uint8Array;
};

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

export function parsePng(b: Uint8Array): Png {
  let pos = 8;
  let header: Pick<Png, "width" | "height" | "depth" | "colorType" | "interlace"> | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const parts: Uint8Array[] = [];
  let sawEnd = false;
  while (pos + 12 <= b.length) {
    const length = u32(b, pos);
    const type = text(b, pos + 4, 4);
    const body = pos + 8;
    if (body + length + 4 > b.length) throw new Error("the PNG is cut short");
    const data = b.subarray(body, body + length);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("the PNG header is damaged");
      header = { width: u32(data, 0), height: u32(data, 4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    pos = body + length + 4;
  }
  if (!header) throw new Error("the PNG header is missing");
  if (!sawEnd && parts.length === 0) throw new Error("the PNG is cut short");
  if (header.width === 0 || header.height === 0) throw new Error("the PNG has no picture data");
  if (!DEPTHS[header.colorType]?.includes(header.depth)) throw new Error("this PNG colour layout is not supported");
  if (header.interlace > 1) throw new Error("this PNG layout is not supported");
  if (header.colorType === 3 && !palette) throw new Error("the PNG palette is missing");
  if (parts.length === 0) throw new Error("the PNG has no picture data");
  const idat = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    idat.set(part, at);
    at += part.length;
  }
  return { ...header, palette, trns, idat };
}

function paletteSpace(palette: Uint8Array): string {
  const entries = Math.max(1, Math.min(256, Math.floor(palette.length / 3)));
  const table = new Uint8Array(entries * 3);
  table.set(palette.subarray(0, entries * 3));
  return `[/Indexed /DeviceRGB ${entries - 1} <${hex(table)}>]`;
}

async function encodePng(bytes: Uint8Array): Promise<PdfImage> {
  const png = parsePng(bytes);
  const { width, height, depth, colorType } = png;
  const noAlpha = colorType === 0 || colorType === 2 || (colorType === 3 && !png.trns);
  // Plain PNG pixel data is what the PDF Flate filter with a PNG predictor expects,
  // so 8-bit-or-less, non-interlaced pictures go in without being unpacked.
  if (png.interlace === 0 && noAlpha && depth <= 8) {
    const colors = colorType === 2 ? 3 : 1;
    const parms = `/DecodeParms [null << /Predictor 15 /Colors ${colors} /BitsPerComponent ${depth} /Columns ${width} >>]`;
    let mask = "";
    if (png.trns && colorType === 0 && png.trns.length >= 2) {
      const key = u16(png.trns, 0) & ((1 << depth) - 1);
      mask = ` /Mask [${key} ${key}]`;
    } else if (png.trns && colorType === 2 && png.trns.length >= 6 && depth === 8) {
      const [r, g, b] = [png.trns[1], png.trns[3], png.trns[5]];
      mask = ` /Mask [${r} ${r} ${g} ${g} ${b} ${b}]`;
    }
    return {
      width,
      height,
      orientation: 1,
      colorSpace: colorType === 3 ? paletteSpace(png.palette!) : colorType === 2 ? "/DeviceRGB" : "/DeviceGray",
      bpc: depth,
      filters: ["ASCII85Decode", "FlateDecode"],
      extra: parms + mask,
      data: ascii85(png.idat),
    };
  }
  const samples = await pngSamples(png);
  const pixels = width * height;
  let color: Uint8Array;
  let alpha: Uint8Array | null = null;
  let colorSpace: string;
  if (colorType === 4 || colorType === 6) {
    const colors = colorType === 4 ? 1 : 3;
    const stride = colors + 1;
    color = new Uint8Array(pixels * colors);
    alpha = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < colors; c++) color[i * colors + c] = samples[i * stride + c];
      alpha[i] = samples[i * stride + colors];
    }
    colorSpace = colors === 1 ? "/DeviceGray" : "/DeviceRGB";
  } else if (colorType === 3) {
    color = samples;
    colorSpace = paletteSpace(png.palette!);
    if (png.trns) {
      alpha = new Uint8Array(pixels);
      for (let i = 0; i < pixels; i++) alpha[i] = png.trns[samples[i]] ?? 255;
    }
  } else {
    color = samples;
    colorSpace = colorType === 2 ? "/DeviceRGB" : "/DeviceGray";
  }
  return finish(width, height, colorSpace, color, alpha);
}

async function finish(width: number, height: number, colorSpace: string, color: Uint8Array, alpha: Uint8Array | null): Promise<PdfImage> {
  const image: PdfImage = {
    width,
    height,
    orientation: 1,
    colorSpace,
    bpc: 8,
    filters: ["ASCII85Decode", "FlateDecode"],
    extra: "",
    data: ascii85(await deflate(color)),
  };
  if (alpha && alpha.some((value) => value !== 255)) image.alpha = ascii85(await deflate(alpha));
  return image;
}

/** RGBA pixels, already decoded by the runtime (GIF, WebP…). */
async function encodeRaster(raster: Raster): Promise<PdfImage> {
  const pixels = raster.width * raster.height;
  const color = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    color[i * 3] = raster.rgba[i * 4];
    color[i * 3 + 1] = raster.rgba[i * 4 + 1];
    color[i * 3 + 2] = raster.rgba[i * 4 + 2];
    alpha[i] = raster.rgba[i * 4 + 3];
  }
  return finish(raster.width, raster.height, "/DeviceRGB", color, alpha);
}

const ADAM7: [number, number, number, number][] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/** Unpack a PNG to one byte per sample (16-bit values keep their high byte, grey below 8 bits is scaled up). */
async function pngSamples(png: Png): Promise<Uint8Array> {
  const raw = await inflate(png.idat);
  const channels = CHANNELS[png.colorType];
  const bits = channels * png.depth;
  const pixelBytes = Math.max(1, bits >> 3);
  const out = new Uint8Array(png.width * png.height * channels);
  const passes: [number, number, number, number][] = png.interlace === 1 ? ADAM7 : [[0, 0, 1, 1]];
  const scaleGrey = png.colorType === 0 && png.depth < 8 ? 255 / ((1 << png.depth) - 1) : 1;
  let offset = 0;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = Math.ceil((png.width - xStart) / xStep);
    const passHeight = Math.ceil((png.height - yStart) / yStep);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const rowBytes = Math.ceil((passWidth * bits) / 8);
    const need = passHeight * (rowBytes + 1);
    if (offset + need > raw.length) throw new Error("the PNG data is cut short");
    const rows = unfilter(raw, offset, passHeight, rowBytes, pixelBytes);
    offset += need;
    for (let y = 0; y < passHeight; y++) {
      const base = y * rowBytes;
      for (let x = 0; x < passWidth; x++) {
        const target = ((yStart + y * yStep) * png.width + xStart + x * xStep) * channels;
        for (let c = 0; c < channels; c++) {
          out[target + c] = Math.round(sample(rows, base, x * channels + c, png.depth) * scaleGrey);
        }
      }
    }
  }
  return out;
}

function sample(rows: Uint8Array, base: number, index: number, depth: number): number {
  if (depth === 8) return rows[base + index];
  if (depth === 16) return rows[base + index * 2];
  const bit = index * depth;
  return (rows[base + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

function unfilter(raw: Uint8Array, offset: number, rowCount: number, rowBytes: number, pixelBytes: number): Uint8Array {
  const out = new Uint8Array(rowCount * rowBytes);
  for (let row = 0; row < rowCount; row++) {
    const filter = raw[offset + row * (rowBytes + 1)];
    const source = offset + row * (rowBytes + 1) + 1;
    const line = row * rowBytes;
    const above = line - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= pixelBytes ? out[line + i - pixelBytes] : 0;
      const up = row > 0 ? out[above + i] : 0;
      const upLeft = row > 0 && i >= pixelBytes ? out[above + i - pixelBytes] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else if (filter > 4) throw new Error("the PNG data is damaged");
      out[line + i] = (raw[source + i] + predictor) & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

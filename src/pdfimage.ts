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

function text(b: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && at + i < b.length; i++) out += String.fromCharCode(b[at + i]);
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

type JpegScan = {
  sof: { width: number; height: number; components: number } | null;
  orientation: number;
  adobeTransform: number | null;
};

export function parseJpeg(b: Uint8Array): JpegInfo {
  let pos = 2;
  const scan: JpegScan = { sof: null, orientation: 1, adobeTransform: null };
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
    if (isStandaloneJpegMarker(marker)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    pos = readJpegSegment(b, pos, scan);
  }
  return jpegInfo(scan);
}

function jpegInfo(scan: JpegScan): JpegInfo {
  const sof = scan.sof;
  if (!sof || sof.width === 0 || sof.height === 0) throw new Error("the JPEG has no picture data");
  if (![1, 3, 4].includes(sof.components)) throw new Error("this JPEG colour layout is not supported");
  return { ...sof, orientation: scan.orientation, adobeTransform: scan.adobeTransform };
}

/** Stuffed FF00, TEM, SOI, and RST have no length field. */
function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

function readJpegSegment(b: Uint8Array, pos: number, scan: JpegScan): number {
  const length = u16(b, pos + 2);
  const end = pos + 2 + length;
  if (length < 2 || end > b.length) throw new Error("the JPEG is cut short");
  noteJpegSegment(scan, b, b[pos + 1], pos + 4, end, length);
  return end;
}

function noteJpegSegment(scan: JpegScan, b: Uint8Array, marker: number, body: number, end: number, length: number): void {
  if (SOF_OTHER.has(marker)) throw new Error("this kind of JPEG (lossless or arithmetic) is not supported");
  if (SOF_SUPPORTED.has(marker) && !scan.sof) scan.sof = readSof(b, body);
  else if (marker === 0xe1 && text(b, body, 6) === "Exif\0\0") scan.orientation = exifOrientation(b, body + 6, end);
  noteAdobe(scan, b, marker, body, length);
}

function noteAdobe(scan: JpegScan, b: Uint8Array, marker: number, body: number, length: number): void {
  if (marker === 0xee && text(b, body, 5) === "Adobe" && length >= 14) scan.adobeTransform = b[body + 11];
}

function readSof(b: Uint8Array, body: number): { width: number; height: number; components: number } {
  if (b[body] !== 8) throw new Error("only 8-bit JPEGs are supported");
  return { height: u16(b, body + 1), width: u16(b, body + 3), components: b[body + 5] };
}

function u16Endian(b: Uint8Array, at: number, little: boolean): number {
  return little ? b[at] | (b[at + 1] << 8) : u16(b, at);
}

function u32Endian(b: Uint8Array, at: number, little: boolean): number {
  return little ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0 : u32(b, at);
}

function exifOrientation(b: Uint8Array, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = b[tiff] === 0x49;
  const ifd = tiff + u32Endian(b, tiff + 4, little);
  if (ifd + 2 > end) return 1;
  return readOrientation(b, ifd, end, little);
}

function readOrientation(b: Uint8Array, ifd: number, end: number, little: boolean): number {
  const count = u16Endian(b, ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16Endian(b, entry, little) === 0x0112) return orientationValue(u16Endian(b, entry + 8, little));
  }
  return 1;
}

function orientationValue(value: number): number {
  return value >= 1 && value <= 8 ? value : 1;
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

type PngHeader = Pick<Png, "width" | "height" | "depth" | "colorType" | "interlace">;

type PngParts = {
  header: PngHeader | null;
  palette: Uint8Array | null;
  trns: Uint8Array | null;
  parts: Uint8Array[];
  sawEnd: boolean;
};

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

export function parsePng(b: Uint8Array): Png {
  const found = readPngChunks(b);
  const header = pngHeaderOf(found);
  checkPng(header, found.palette, found.parts.length);
  return { ...header, palette: found.palette, trns: found.trns, idat: joinIdat(found.parts) };
}

function readPngChunks(b: Uint8Array): PngParts {
  const found: PngParts = { header: null, palette: null, trns: null, parts: [], sawEnd: false };
  let pos = 8;
  while (pos + 12 <= b.length) {
    const length = u32(b, pos);
    const type = text(b, pos + 4, 4);
    const body = pos + 8;
    if (body + length + 4 > b.length) throw new Error("the PNG is cut short");
    storePngChunk(found, type, b.subarray(body, body + length), length);
    if (found.sawEnd) break;
    pos = body + length + 4;
  }
  return found;
}

function storePngChunk(found: PngParts, type: string, data: Uint8Array, length: number): void {
  if (type === "IHDR") {
    if (length !== 13) throw new Error("the PNG header is damaged");
    found.header = { width: u32(data, 0), height: u32(data, 4), depth: data[8], colorType: data[9], interlace: data[12] };
    return;
  }
  if (type === "PLTE") found.palette = data;
  else if (type === "tRNS") found.trns = data;
  else if (type === "IDAT") found.parts.push(data);
  else if (type === "IEND") found.sawEnd = true;
}

function pngHeaderOf(found: PngParts): PngHeader {
  if (!found.header) throw new Error("the PNG header is missing");
  if (!found.sawEnd && found.parts.length === 0) throw new Error("the PNG is cut short");
  return found.header;
}

function checkPng(header: PngHeader, palette: Uint8Array | null, partCount: number): void {
  if (header.width === 0 || header.height === 0) throw new Error("the PNG has no picture data");
  if (!DEPTHS[header.colorType]?.includes(header.depth)) throw new Error("this PNG colour layout is not supported");
  if (header.interlace > 1) throw new Error("this PNG layout is not supported");
  if (header.colorType === 3 && !palette) throw new Error("the PNG palette is missing");
  if (partCount === 0) throw new Error("the PNG has no picture data");
}

function joinIdat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const idat = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    idat.set(part, at);
    at += part.length;
  }
  return idat;
}

function paletteSpace(palette: Uint8Array): string {
  const entries = Math.max(1, Math.min(256, Math.floor(palette.length / 3)));
  const table = new Uint8Array(entries * 3);
  table.set(palette.subarray(0, entries * 3));
  return `[/Indexed /DeviceRGB ${entries - 1} <${hex(table)}>]`;
}

async function encodePng(bytes: Uint8Array): Promise<PdfImage> {
  const png = parsePng(bytes);
  // Plain PNG pixel data is what the PDF Flate filter with a PNG predictor expects,
  // so 8-bit-or-less, non-interlaced pictures go in without being unpacked.
  if (pngPassesThrough(png)) return encodeDirectPng(png);
  return encodeDecodedPng(png);
}

function pngPassesThrough(png: Png): boolean {
  if (png.interlace !== 0 || png.depth > 8) return false;
  return png.colorType === 0 || png.colorType === 2 || (png.colorType === 3 && !png.trns);
}

function encodeDirectPng(png: Png): PdfImage {
  const colors = png.colorType === 2 ? 3 : 1;
  const parms = `/DecodeParms [null << /Predictor 15 /Colors ${colors} /BitsPerComponent ${png.depth} /Columns ${png.width} >>]`;
  return {
    width: png.width,
    height: png.height,
    orientation: 1,
    colorSpace: directColorSpace(png),
    bpc: png.depth,
    filters: ["ASCII85Decode", "FlateDecode"],
    extra: parms + keyMask(png),
    data: ascii85(png.idat),
  };
}

function directColorSpace(png: Png): string {
  if (png.colorType === 3) return paletteSpace(png.palette!);
  return png.colorType === 2 ? "/DeviceRGB" : "/DeviceGray";
}

function keyMask(png: Png): string {
  const trns = png.trns;
  if (trns && png.colorType === 0 && trns.length >= 2) return greyKeyMask(trns, png.depth);
  if (trns && png.colorType === 2 && trns.length >= 6 && png.depth === 8) return rgbKeyMask(trns);
  return "";
}

function greyKeyMask(trns: Uint8Array, depth: number): string {
  const key = u16(trns, 0) & ((1 << depth) - 1);
  return ` /Mask [${key} ${key}]`;
}

function rgbKeyMask(trns: Uint8Array): string {
  return ` /Mask [${trns[1]} ${trns[1]} ${trns[3]} ${trns[3]} ${trns[5]} ${trns[5]}]`;
}

async function encodeDecodedPng(png: Png): Promise<PdfImage> {
  const { width, height, colorType } = png;
  const samples = await pngSamples(png);
  const pixels = width * height;
  if (colorType === 4 || colorType === 6) {
    const colors = colorType === 4 ? 1 : 3;
    const parts = splitColorAndAlpha(samples, pixels, colors);
    const colorSpace = colors === 1 ? "/DeviceGray" : "/DeviceRGB";
    return finish(width, height, colorSpace, parts.color, parts.alpha);
  }
  if (colorType === 3) {
    const alpha = png.trns ? paletteAlpha(samples, png.trns, pixels) : null;
    return finish(width, height, paletteSpace(png.palette!), samples, alpha);
  }
  const colorSpace = colorType === 2 ? "/DeviceRGB" : "/DeviceGray";
  return finish(width, height, colorSpace, samples, null);
}

function splitColorAndAlpha(samples: Uint8Array, pixels: number, colors: number): { color: Uint8Array; alpha: Uint8Array } {
  const stride = colors + 1;
  const color = new Uint8Array(pixels * colors);
  const alpha = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < colors; c++) color[i * colors + c] = samples[i * stride + c];
    alpha[i] = samples[i * stride + colors];
  }
  return { color, alpha };
}

function paletteAlpha(samples: Uint8Array, trns: Uint8Array, pixels: number): Uint8Array {
  const alpha = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) alpha[i] = trns[samples[i]] ?? 255;
  return alpha;
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
  const out = new Uint8Array(png.width * png.height * channels);
  const passes: [number, number, number, number][] = png.interlace === 1 ? ADAM7 : [[0, 0, 1, 1]];
  const scaleGrey = greyScale(png);
  let offset = 0;
  for (const pass of passes) offset = paintPass(png, raw, out, offset, pass, scaleGrey);
  return out;
}

function greyScale(png: Png): number {
  if (png.colorType === 0 && png.depth < 8) return 255 / ((1 << png.depth) - 1);
  return 1;
}

function paintPass(
  png: Png,
  raw: Uint8Array,
  out: Uint8Array,
  offset: number,
  pass: [number, number, number, number],
  scaleGrey: number,
): number {
  const channels = CHANNELS[png.colorType];
  const bits = channels * png.depth;
  const pixelBytes = Math.max(1, bits >> 3);
  const [xStart, yStart, xStep, yStep] = pass;
  const passWidth = Math.ceil((png.width - xStart) / xStep);
  const passHeight = Math.ceil((png.height - yStart) / yStep);
  if (passWidth <= 0 || passHeight <= 0) return offset;
  const rowBytes = Math.ceil((passWidth * bits) / 8);
  const need = passHeight * (rowBytes + 1);
  if (offset + need > raw.length) throw new Error("the PNG data is cut short");
  const rows = unfilter(raw, offset, passHeight, rowBytes, pixelBytes);
  for (let y = 0; y < passHeight; y++) {
    const base = y * rowBytes;
    for (let x = 0; x < passWidth; x++) {
      const target = ((yStart + y * yStep) * png.width + xStart + x * xStep) * channels;
      for (let c = 0; c < channels; c++) {
        out[target + c] = Math.round(sample(rows, base, x * channels + c, png.depth) * scaleGrey);
      }
    }
  }
  return offset + need;
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
      out[line + i] = (raw[source + i] + pngPredictor(filter, left, up, upLeft)) & 0xff;
    }
  }
  return out;
}

function pngPredictor(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 1) return left;
  else if (filter === 2) return up;
  else if (filter === 3) return (left + up) >> 1;
  else if (filter === 4) return paeth(left, up, upLeft);
  else if (filter > 4) throw new Error("the PNG data is damaged");
  return 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

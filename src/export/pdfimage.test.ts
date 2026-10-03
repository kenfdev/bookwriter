import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, makeJpeg, makePng, makePngRaw, unascii85 } from "../imageFixtures";
import { ascii85, encodeImage, parseJpeg, storedZlib } from "./pdfimage";

describe("ascii85", () => {
  it("round-trips any bytes, including zero groups and odd tails", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 7, 100]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i % 5 === 0 ? 0 : (i * 37) & 255));
      const text = ascii85(bytes);
      expect(text.endsWith("~>")).toBe(true);
      expect(/^[\x21-\x7e\n]*$/.test(text)).toBe(true);
      expect(Array.from(unascii85(text))).toEqual(Array.from(bytes));
    }
  });

  it("writes four zero bytes as z", () => {
    expect(ascii85(new Uint8Array(4))).toBe("z~>");
  });

  it("keeps lines short and never starts a line with a stray end mark", () => {
    const text = ascii85(Uint8Array.from({ length: 500 }, (_, i) => (i * 91) & 255));
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(77);
  });
});

describe("stored zlib", () => {
  it("is a valid zlib stream for any length", () => {
    for (const length of [0, 1, 1000, 70000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 7) & 255);
      expect(Array.from(inflateSync(storedZlib(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe("jpeg", () => {
  it("reads size, colour layout and orientation without decoding", () => {
    const info = parseJpeg(makeJpeg(30, 20, 3, 6));
    expect(info).toMatchObject({ width: 30, height: 20, components: 3, orientation: 6 });
  });

  it("passes the bytes through untouched under DCTDecode", async () => {
    const jpeg = makeJpeg(30, 20);
    const image = await encodeImage(jpeg);
    expect(image.filters).toEqual(["ASCII85Decode", "DCTDecode"]);
    expect(image.colorSpace).toBe("/DeviceRGB");
    expect(Buffer.from(unascii85(image.data)).equals(jpeg)).toBe(true);
    expect((await encodeImage(makeJpeg(5, 5, 1))).colorSpace).toBe("/DeviceGray");
  });

  it("rejects a truncated file", async () => {
    await expect(encodeImage(makeJpeg(30, 20).subarray(0, 12))).rejects.toThrow("JPEG");
  });

  it("skips fill bytes and markers that carry no payload", () => {
    const jpeg = makeJpeg(30, 20, 3, 6);
    const noisy = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0x00, 0xff, 0xff, 0xd0, 0xff, 0x01]), jpeg.subarray(2)]);
    expect(parseJpeg(noisy)).toMatchObject({ width: 30, height: 20, components: 3, orientation: 6 });
  });

  it("reads a little-endian orientation and rejects values outside 1 to 8", () => {
    expect(parseJpeg(littleEndianJpeg(8)).orientation).toBe(8);
    expect(parseJpeg(makeJpeg(30, 20, 3, 0)).orientation).toBe(1);
    expect(parseJpeg(makeJpeg(30, 20, 3, 9)).orientation).toBe(1);
  });

  it("records an Adobe transform and inverts CMYK", async () => {
    const rgb = await encodeImage(withAdobe(makeJpeg(30, 20, 3), 0));
    expect(rgb.extra).toContain("/ColorTransform 0");
    expect(rgb.extra).not.toContain("/Decode ");
    const cmyk = await encodeImage(withAdobe(makeJpeg(30, 20, 4), 2));
    expect(cmyk.colorSpace).toBe("/DeviceCMYK");
    expect(cmyk.extra).toContain("/ColorTransform 1");
    expect(cmyk.extra).toContain("/Decode [1 0 1 0 1 0 1 0]");
    const plain = await encodeImage(makeJpeg(30, 20, 4));
    expect(plain.extra).not.toContain("/Decode ");
  });
});

function withAdobe(jpeg: Buffer, transform: number): Buffer {
  const body = [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 0, 0, 0, 0, 0, transform];
  const segment = Buffer.from([0xff, 0xee, 0, body.length + 2, ...body]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** Same stand-in JPEG as makeJpeg, with the TIFF header stored little-endian. */
function littleEndianJpeg(orientation: number): Buffer {
  const jpeg = makeJpeg(30, 20, 3, orientation);
  const exif = jpeg.indexOf(Buffer.from("Exif"));
  jpeg[exif + 6] = 0x49;
  jpeg[exif + 7] = 0x49;
  jpeg[exif + 8] = 0x2a;
  jpeg[exif + 9] = 0;
  jpeg[exif + 10] = 8;
  jpeg[exif + 11] = 0;
  jpeg[exif + 12] = 0;
  jpeg[exif + 13] = 0;
  jpeg.writeUInt16LE(1, exif + 14);
  jpeg.writeUInt16LE(0x0112, exif + 16);
  jpeg.writeUInt16LE(3, exif + 18);
  jpeg.writeUInt32LE(1, exif + 20);
  jpeg.writeUInt16LE(orientation, exif + 24);
  return jpeg;
}

describe("png", () => {
  it("passes plain RGB data through with a PNG predictor", async () => {
    const rows = [[255, 0, 0, 0, 255, 0], [0, 0, 255, 9, 9, 9]];
    const image = await encodeImage(makePng({ width: 2, height: 2, colorType: 2, rows }));
    expect(image.filters).toEqual(["ASCII85Decode", "FlateDecode"]);
    expect(image.extra).toContain("/Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2");
    expect(image.alpha).toBeUndefined();
    const raw = inflateSync(unascii85(image.data));
    expect(Array.from(raw)).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9]);
  });

  it("splits RGBA into colour and a soft mask, undoing the Sub filter", async () => {
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 128],
      [70, 80, 90, 0, 100, 110, 120, 255],
    ];
    const image = await encodeImage(makePng({ width: 2, height: 2, colorType: 6, rows, filter: 1, bytesPerPixel: 4 }));
    expect(image.colorSpace).toBe("/DeviceRGB");
    expect(Array.from(inflateSync(unascii85(image.data)))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    expect(image.alpha).toBeDefined();
    expect(Array.from(inflateSync(unascii85(image.alpha!)))).toEqual([255, 128, 0, 255]);
  });

  it("drops a fully opaque alpha channel", async () => {
    const image = await encodeImage(makePng({ width: 1, height: 1, colorType: 6, rows: [[1, 2, 3, 255]] }));
    expect(image.alpha).toBeUndefined();
  });

  it("keeps palette pictures indexed and turns palette transparency into a mask", async () => {
    const palette = [255, 0, 0, 0, 0, 255];
    const plain = await encodeImage(makePng({ width: 2, height: 1, colorType: 3, rows: [[0, 1]], palette }));
    expect(plain.colorSpace).toBe("[/Indexed /DeviceRGB 1 <ff00000000ff>]");
    expect(plain.alpha).toBeUndefined();
    const clear = await encodeImage(makePng({ width: 2, height: 1, colorType: 3, rows: [[0, 1]], palette, trns: [0, 255] }));
    expect(Array.from(inflateSync(unascii85(clear.alpha!)))).toEqual([0, 255]);
    expect(Array.from(inflateSync(unascii85(clear.data)))).toEqual([0, 1]);
  });

  it("unpacks 16-bit grey with alpha to 8 bits", async () => {
    const image = await encodeImage(makePng({ width: 1, height: 1, colorType: 4, depth: 16, rows: [[0x80, 0x11, 0xff, 0xff]] }));
    expect(image.colorSpace).toBe("/DeviceGray");
    expect(Array.from(inflateSync(unascii85(image.data)))).toEqual([0x80]);
  });

  it("scales low bit-depth grey through unchanged for the predictor path", async () => {
    const image = await encodeImage(makePng({ width: 8, height: 1, colorType: 0, depth: 1, rows: [[0b10101010]] }));
    expect(image.bpc).toBe(1);
    expect(image.colorSpace).toBe("/DeviceGray");
  });

  it("unpacks an Adam7 interlaced picture into row order", async () => {
    // 2x2 grey, interlaced: pass 1 holds pixel (0,0); pass 6 holds (1,0); pass 7 holds row 1.
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 0;
    header[12] = 1;
    const raw = Buffer.from([0, 10, /* pass 6 */ 0, 20, /* pass 7 */ 0, 30, 40]);
    const rebuilt = makePngRaw(header, raw);
    const image = await encodeImage(rebuilt);
    expect(Array.from(inflateSync(unascii85(image.data)))).toEqual([10, 20, 30, 40]);
  });

  it("turns a grey or RGB transparency key into a mask", async () => {
    const grey = await encodeImage(makePng({ width: 1, height: 1, colorType: 0, rows: [[5]], trns: [0, 5] }));
    expect(grey.extra).toContain("/Mask [5 5]");
    expect(grey.alpha).toBeUndefined();
    const rgb = await encodeImage(makePng({ width: 1, height: 1, colorType: 2, rows: [[9, 8, 7]], trns: [0, 9, 0, 8, 0, 7] }));
    expect(rgb.extra).toContain("/Mask [9 9 8 8 7 7]");
  });

  it("undoes Up, Average, and Paeth filters", async () => {
    // Paeth bytes are chosen so the predictor returns left, above, and above-left.
    const decoded = async (filtered: number[]) => {
      const image = await encodeImage(indexedFiltered(2, 2, Buffer.from(filtered)));
      return Array.from(inflateSync(unascii85(image.data)));
    };
    expect(await decoded([2, 10, 20, 2, 20, 20])).toEqual([10, 20, 30, 40]);
    expect(await decoded([3, 10, 15, 3, 25, 15])).toEqual([10, 20, 30, 40]);
    expect(await decoded([4, 1, 1, 4, 255, 6])).toEqual([1, 2, 0, 7]);
  });

  it("rejects damaged and unknown files with a reason", async () => {
    const good = makePng({ width: 2, height: 1, colorType: 2, rows: [[1, 2, 3, 4, 5, 6]] });
    await expect(encodeImage(good.subarray(0, 30))).rejects.toThrow("PNG");
    await expect(encodeImage(Buffer.from("GIF89a....."))).rejects.toThrow("only JPEG and PNG");
    await expect(encodeImage(new Uint8Array(0))).rejects.toThrow();
  });

  it("rejects a PNG with no pixels, a bad colour layout, or no data", async () => {
    await expect(encodeImage(makePng({ width: 0, height: 1, colorType: 2, rows: [[]] }))).rejects.toThrow("no picture data");
    await expect(encodeImage(makePng({ width: 1, height: 0, colorType: 2, rows: [] }))).rejects.toThrow("no picture data");
    await expect(encodeImage(makePng({ width: 1, height: 1, colorType: 7, rows: [[0]] }))).rejects.toThrow("colour layout");
    await expect(encodeImage(makePng({ width: 1, height: 1, colorType: 2, depth: 4, rows: [[1, 2, 3]] }))).rejects.toThrow("colour layout");
    const interlaced = makePng({ width: 1, height: 1, colorType: 2, rows: [[1, 2, 3]] });
    interlaced[28] = 2;
    await expect(encodeImage(interlaced)).rejects.toThrow("this PNG layout is not supported");
    await expect(encodeImage(makePng({ width: 1, height: 1, colorType: 3, depth: 8, rows: [[0]] }))).rejects.toThrow("palette is missing");
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 2;
    const noData = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    await expect(encodeImage(noData)).rejects.toThrow("no picture data");
  });

  it("uses a runtime decoder for other formats when one is given", async () => {
    const rgba = [1, 2, 3, 255, 4, 5, 6, 0];
    const image = await encodeImage(Buffer.from("GIF89a....."), { rasterize: async () => ({ width: 2, height: 1, rgba }) });
    expect(Array.from(inflateSync(unascii85(image.data)))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(inflateSync(unascii85(image.alpha!)))).toEqual([255, 0]);
    await expect(encodeImage(Buffer.from("GIF89a....."), { rasterize: async () => null })).rejects.toThrow("only JPEG and PNG");
  });
});

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Indexed PNG with a tRNS chunk, so the samples are decoded instead of stored filtered. */
function indexedFiltered(width: number, height: number, filtered: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 255])),
    pngChunk("tRNS", Buffer.from([255])),
    pngChunk("IDAT", deflateSync(filtered)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

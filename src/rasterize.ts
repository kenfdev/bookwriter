import type { Raster } from "./pdfimage";

/**
 * Decode a picture the PDF writer cannot read itself (GIF, WebP, TIFF where the webview
 * supports it) into RGBA pixels, using the webview's own image decoder. Returns null when
 * the webview cannot decode the file. Browser only; the tests do not use it.
 */
function webviewPresent(): boolean {
  return typeof document !== "undefined";
}

function bitmapApiPresent(): boolean {
  return typeof createImageBitmap !== "undefined";
}

function canRasterize(): boolean {
  return webviewPresent() && bitmapApiPresent();
}

function drawnRaster(bitmap: ImageBitmap): Raster | null {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0);
  const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { width: bitmap.width, height: bitmap.height, rgba: data.data };
}

export async function rasterizePicture(bytes: Uint8Array): Promise<Raster | null> {
  if (!canRasterize()) return null;
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    return drawnRaster(bitmap);
  } finally {
    bitmap.close();
  }
}

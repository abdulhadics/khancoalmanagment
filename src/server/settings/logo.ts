import sharp from "sharp";

export const maxLogoInputBytes = 750 * 1024;

const mediaByFormat = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;

function detectRaster(bytes: Buffer): keyof typeof mediaByFormat | null {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpeg";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export async function normalizeCompanyLogo(file: File) {
  if (file.size === 0 || file.size > maxLogoInputBytes) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const format = detectRaster(bytes);
  if (!format || file.type !== mediaByFormat[format]) return null;

  try {
    const raster = sharp(bytes, {
      limitInputPixels: 4_194_304,
      failOn: "warning",
    });
    const metadata = await raster.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) return null;

    // Re-encoding drops profiles and metadata, and never emits active content.
    const normalized = await raster
      .autoOrient()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return {
      logoBytes: Uint8Array.from(normalized),
      logoMediaType: "image/png",
    };
  } catch {
    return null;
  }
}

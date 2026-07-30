import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const pdfjsPackageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = `${path.join(pdfjsPackageRoot, "standard_fonts")}${path.sep}`;

export const QUALITY_OUTPUT_DIR = path.join(
  process.cwd(),
  "test-results",
  "conversion-quality"
);

export const VISUAL_DIFF_THRESHOLDS = {
  strict: 0.025,
  losslessRaster: 0.045,
  lowLossy: 0.09,
  mediumLossy: 0.16,
  highLossy: 0.28,
  aggressiveLossy: 0.36
} as const;

export interface RenderedImage {
  png: Buffer;
  width: number;
  height: number;
  hasAlpha: boolean;
}

export interface VisualComparisonResult {
  score: number;
  dimensionsMatch: boolean;
  orientationMatch: boolean;
  expected: {
    width: number;
    height: number;
  };
  actual: {
    width: number;
    height: number;
  };
  diffPath?: string;
}

export async function blobToBuffer(blob: Blob) {
  return Buffer.from(await blob.arrayBuffer());
}

export async function getImageMetadata(blob: Blob): Promise<RenderedImage> {
  const png = await imageBlobToPng(blob);
  const metadata = await sharp(png).metadata();

  return {
    png,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    hasAlpha: metadata.hasAlpha ?? false
  };
}

export async function imageBlobToPng(
  blob: Blob,
  options: { flattenWhite?: boolean; width?: number; height?: number } = {}
) {
  let pipeline = sharp(await blobToBuffer(blob)).rotate();

  if (options.flattenWhite) {
    pipeline = pipeline.flatten({ background: "#ffffff" });
  }

  if (options.width && options.height) {
    pipeline = pipeline.resize(options.width, options.height, {
      fit: "fill"
    });
  }

  return pipeline.png().toBuffer();
}

export async function renderPdfBlobToImages(
  blob: Blob,
  options: { scale?: number; targetSizes?: Array<{ width: number; height: number }> } = {}
): Promise<RenderedImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await blobToBuffer(blob);
  const documentTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    standardFontDataUrl,
    stopAtErrors: true
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await documentTask.promise;
  const pages: RenderedImage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetSize = options.targetSizes?.[pageNumber - 1];
      const scale = targetSize
        ? targetSize.width / baseViewport.width
        : options.scale ?? 1.25;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport
      }).promise;

      const png = await canvas.encode("png");

      pages.push({
        png,
        width: canvas.width,
        height: canvas.height,
        hasAlpha: false
      });
    }
  } finally {
    await pdf.destroy();
  }

  return pages;
}

export async function compareRenderedImages({
  expected,
  actual,
  diffPath,
  writeDiff
}: {
  expected: Buffer;
  actual: Buffer;
  diffPath: string;
  writeDiff: boolean;
}): Promise<VisualComparisonResult> {
  const expectedMetadata = await sharp(expected).metadata();
  const actualMetadata = await sharp(actual).metadata();
  const expectedWidth = expectedMetadata.width ?? 0;
  const expectedHeight = expectedMetadata.height ?? 0;
  const actualWidth = actualMetadata.width ?? 0;
  const actualHeight = actualMetadata.height ?? 0;
  const width = Math.max(1, expectedWidth);
  const height = Math.max(1, expectedHeight);
  const expectedRaw = await sharp(expected)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const actualRaw = await sharp(actual)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const diffRaw = Buffer.alloc(expectedRaw.length);
  let totalDifference = 0;

  for (let index = 0; index < expectedRaw.length; index += 4) {
    const red = Math.abs(expectedRaw[index] - actualRaw[index]);
    const green = Math.abs(expectedRaw[index + 1] - actualRaw[index + 1]);
    const blue = Math.abs(expectedRaw[index + 2] - actualRaw[index + 2]);
    const alpha = Math.abs(expectedRaw[index + 3] - actualRaw[index + 3]);
    const pixelDifference = Math.max(red, green, blue, alpha);

    totalDifference += red + green + blue + alpha;
    diffRaw[index] = 255;
    diffRaw[index + 1] = 255 - pixelDifference;
    diffRaw[index + 2] = 255 - pixelDifference;
    diffRaw[index + 3] = pixelDifference === 0 ? 0 : 255;
  }

  if (writeDiff) {
    await mkdir(path.dirname(diffPath), { recursive: true });
    await sharp(diffRaw, {
      raw: {
        width,
        height,
        channels: 4
      }
    })
      .png()
      .toFile(diffPath);
  }

  return {
    score: totalDifference / (expectedRaw.length * 255),
    dimensionsMatch: expectedWidth === actualWidth && expectedHeight === actualHeight,
    orientationMatch:
      (expectedWidth >= expectedHeight) === (actualWidth >= actualHeight),
    expected: {
      width: expectedWidth,
      height: expectedHeight
    },
    actual: {
      width: actualWidth,
      height: actualHeight
    },
    diffPath: writeDiff ? diffPath : undefined
  };
}

export async function writeJsonAndMarkdownReport<T>({
  jsonPath,
  markdownPath,
  rows,
  markdown
}: {
  jsonPath: string;
  markdownPath: string;
  rows: T[];
  markdown: string;
}) {
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
  await writeFile(markdownPath, markdown);
}

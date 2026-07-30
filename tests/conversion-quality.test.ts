import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  convertFile,
  getSupportedTargetsForCategory,
  isSameFormatReencode,
  supportsCompression,
  warnsAboutTransparencyReplacement,
  type ConversionTarget,
  type SupportedInputKind
} from "@/lib/conversion-engine";
import { validateFileSafety } from "@/lib/file-safety";

import {
  makeQualityFixtures,
  type QualityFixtures
} from "./fixtures/quality-fixtures";
import { installConversionBrowserPolyfill } from "./utils/conversion-browser-polyfill";
import {
  QUALITY_OUTPUT_DIR,
  VISUAL_DIFF_THRESHOLDS,
  compareRenderedImages,
  getImageMetadata,
  imageBlobToPng,
  renderPdfBlobToImages,
  writeJsonAndMarkdownReport
} from "./utils/visual-quality";

type MatrixResult = "Pending evidence" | "Pass" | "Pass With Warning" | "Fail" | "Disable";
type FixtureKey = keyof QualityFixtures;

interface MatrixCase {
  path: string;
  inputKind: SupportedInputKind;
  inputCategory: "pdf" | "image";
  fixture: FixtureKey;
  target: ConversionTarget;
  outputType: "pdf" | "jpg" | "png" | "webp";
}

interface MatrixRow {
  path: string;
  fixture: string;
  compressionLevel: number;
  outputType: string;
  outputCount: number;
  expectedOutputCount: number;
  visualDifferenceScore: number | null;
  visualDifferenceThreshold: number;
  warningsExpected: string[];
  metadataColorProfileRisk: string;
  initialResult: "Pending evidence";
  finalResult: MatrixResult;
  shouldRemainEnabledAfterTesting: boolean;
  dimensions: Array<{
    expected: string;
    actual: string;
  }>;
  diffImages: string[];
  notes: string[];
}

const matrixCases: MatrixCase[] = [
  pdfCase("PDF -> PDF", "pdf"),
  pdfCase("PDF -> JPG", "jpg"),
  pdfCase("PDF -> PNG", "png"),
  pdfCase("PDF -> WEBP", "webp"),
  imageCase("JPG -> PDF", "jpg", "photoJpg", "pdf"),
  imageCase("JPG -> JPG", "jpg", "highResolutionJpg", "jpg"),
  imageCase("JPG -> PNG", "jpg", "edgeTextJpg", "png"),
  imageCase("JPG -> WEBP", "jpg", "photoJpg", "webp"),
  imageCase("PNG -> PDF", "png", "transparentPng", "pdf"),
  imageCase("PNG -> JPG", "png", "transparentPng", "jpg"),
  imageCase("PNG -> PNG", "png", "transparentPng", "png"),
  imageCase("PNG -> WEBP", "png", "transparentPng", "webp"),
  imageCase("WEBP -> PDF", "webp", "transparentWebp", "pdf"),
  imageCase("WEBP -> JPG", "webp", "transparentWebp", "jpg"),
  imageCase("WEBP -> PNG", "webp", "transparentWebp", "png"),
  imageCase("WEBP -> WEBP", "webp", "transparentWebp", "webp")
];

const matrixRows: MatrixRow[] = [];
let fixtures: QualityFixtures;

beforeAll(async () => {
  installConversionBrowserPolyfill();
  fixtures = await makeQualityFixtures();
});

afterAll(async () => {
  const jsonPath = path.join(QUALITY_OUTPUT_DIR, "matrix-results.json");
  const markdownPath = path.join(QUALITY_OUTPUT_DIR, "matrix-results.md");

  await writeJsonAndMarkdownReport({
    jsonPath,
    markdownPath,
    rows: matrixRows,
    markdown: buildMarkdownReport(matrixRows)
  });
});

describe("conversion quality matrix", () => {
  it("generates all required deterministic quality fixtures", async () => {
    await expectPdfPageCount(fixtures.simplePdf, 1);
    await expectPdfPageCount(fixtures.multiPagePdf, 3);
    await expectPdfPageCount(fixtures.mixedContentPdf, 2);
    await expectImage(fixtures.normalJpg, 360, 220, false);
    await expectImage(fixtures.highResolutionJpg, 1280, 800, false);
    await expectImage(fixtures.edgeTextJpg, 360, 220, false);
    await expectImage(fixtures.transparentPng, 360, 220, true);
    await expectImage(fixtures.opaquePng, 360, 220, false);
    await expectImage(fixtures.transparentWebp, 360, 220, true);
    await expectImage(fixtures.opaqueWebp, 360, 220, false);
    await expectImage(fixtures.photoJpg, 480, 320, false);
    await expectImage(fixtures.exifRotatedJpg, 220, 360, false);
  });

  it.each(expandCases(matrixCases))(
    "$path at $compressionLevel% using $fixture",
    async ({ matrixCase, compressionLevel }) => {
      const row = await runMatrixCase(matrixCase, compressionLevel);
      matrixRows.push(row);

      expect(row.finalResult, JSON.stringify(row, null, 2)).not.toBe("Fail");
      expect(row.finalResult, JSON.stringify(row, null, 2)).not.toBe("Disable");
    }
  );
});

async function runMatrixCase(
  matrixCase: MatrixCase,
  compressionLevel: number
): Promise<MatrixRow> {
  const file = fixtures[matrixCase.fixture];
  const warningsExpected = getExpectedWarnings(matrixCase);
  const threshold = getThreshold(matrixCase, compressionLevel);
  const row: MatrixRow = {
    path: matrixCase.path,
    fixture: file.name,
    compressionLevel,
    outputType: matrixCase.outputType,
    outputCount: 0,
    expectedOutputCount:
      matrixCase.inputCategory === "pdf" && matrixCase.target !== "pdf" ? 2 : 1,
    visualDifferenceScore: null,
    visualDifferenceThreshold: threshold,
    warningsExpected,
    metadataColorProfileRisk: getMetadataColorProfileRisk(matrixCase),
    initialResult: "Pending evidence",
    finalResult: "Pending evidence",
    shouldRemainEnabledAfterTesting: false,
    dimensions: [],
    diffImages: [],
    notes: []
  };

  try {
    const safety = await validateFileSafety(file);

    if (!safety.ok) {
      row.finalResult = "Disable";
      row.notes.push(`Input fixture failed safety validation: ${safety.message}`);
      return row;
    }

    const supportedTargets = getSupportedTargetsForCategory(safety.input.category).map(
      (target) => target.value
    );

    if (!supportedTargets.includes(matrixCase.target)) {
      row.finalResult = "Disable";
      row.notes.push(`${matrixCase.target} is not an enabled target for this input.`);
      return row;
    }

    const output = await convertFile(file, {
      target: matrixCase.target,
      compressionLevel,
      fileSafety: safety
    });
    const mimeOk = output.every((asset) => asset.mimeType === expectedMime(matrixCase.target));

    row.outputCount = output.length;

    if (!mimeOk) {
      row.finalResult = "Fail";
      row.notes.push("Output MIME type did not match the selected target.");
      return row;
    }

    if (output.length !== row.expectedOutputCount) {
      row.finalResult = "Fail";
      row.notes.push(
        `Expected ${row.expectedOutputCount} output file(s), received ${output.length}.`
      );
      return row;
    }

    const comparisons = await compareSourceAndOutput({
      matrixCase,
      source: file,
      output: output.map((asset) => asset.blob),
      compressionLevel,
      threshold
    });

    row.visualDifferenceScore = Math.max(...comparisons.map((result) => result.score));
    row.dimensions = comparisons.map((result) => ({
      expected: `${result.expected.width}x${result.expected.height}`,
      actual: `${result.actual.width}x${result.actual.height}`
    }));

    const failedComparisons = comparisons.filter(
      (result) =>
        result.score > threshold ||
        !result.dimensionsMatch ||
        !result.orientationMatch
    );

    if (failedComparisons.length > 0) {
      const diffComparisons = await compareSourceAndOutput({
        matrixCase,
        source: file,
        output: output.map((asset) => asset.blob),
        compressionLevel,
        threshold,
        writeDiffs: true
      });

      row.diffImages = diffComparisons
        .map((result) => result.diffPath)
        .filter((diffPath): diffPath is string => Boolean(diffPath));
      row.finalResult = "Fail";
      row.notes.push("Visual difference, dimensions, or orientation exceeded threshold.");
      return row;
    }

    await assertTransparencyBehavior(matrixCase, output.map((asset) => asset.blob), row);

    if (row.finalResult === "Fail") {
      return row;
    }

    if (compressionLevel === 0 && isSameFormatReencode(matrixCase.inputKind, matrixCase.target)) {
      row.notes.push("0% same-format output is a re-encode, not the untouched original.");
    }

    row.finalResult = warningsExpected.length > 0 ? "Pass With Warning" : "Pass";
    row.shouldRemainEnabledAfterTesting = true;
    return row;
  } catch (error) {
    row.finalResult = "Disable";
    row.notes.push(error instanceof Error ? error.message : "Conversion threw an unknown error.");
    return row;
  }
}

async function compareSourceAndOutput({
  matrixCase,
  source,
  output,
  compressionLevel,
  threshold,
  writeDiffs = false
}: {
  matrixCase: MatrixCase;
  source: File;
  output: Blob[];
  compressionLevel: number;
  threshold: number;
  writeDiffs?: boolean;
}) {
  if (matrixCase.inputCategory === "pdf" && matrixCase.target === "pdf") {
    const expectedPages = await renderPdfBlobToImages(source, { scale: 1.25 });
    const actualPages = await renderPdfBlobToImages(output[0], { scale: 1.25 });

    return comparePages({
      expectedPages,
      actualPages,
      matrixCase,
      compressionLevel,
      threshold,
      writeDiffs
    });
  }

  if (matrixCase.inputCategory === "pdf") {
    const actualPages = await Promise.all(output.map((blob) => getImageMetadata(blob)));
    const expectedPages = await renderPdfBlobToImages(source, {
      targetSizes: actualPages.map((page) => ({ width: page.width, height: page.height }))
    });

    return comparePages({
      expectedPages,
      actualPages,
      matrixCase,
      compressionLevel,
      threshold,
      writeDiffs
    });
  }

  const flattenWhite = warnsAboutTransparencyReplacement(
    matrixCase.inputKind,
    matrixCase.target
  );
  const actualPages =
    matrixCase.target === "pdf"
      ? await renderPdfBlobToImages(output[0], { scale: 1 })
      : await Promise.all(output.map((blob) => getImageMetadata(blob)));
  const expectedPng = await imageBlobToPng(source, {
    flattenWhite,
    width: actualPages[0]?.width,
    height: actualPages[0]?.height
  });
  const expectedPages = [
    {
      png: expectedPng,
      width: actualPages[0]?.width ?? 0,
      height: actualPages[0]?.height ?? 0,
      hasAlpha: !flattenWhite && (matrixCase.inputKind === "png" || matrixCase.inputKind === "webp")
    }
  ];

  return comparePages({
    expectedPages,
    actualPages,
    matrixCase,
    compressionLevel,
    threshold,
    writeDiffs
  });
}

async function comparePages({
  expectedPages,
  actualPages,
  matrixCase,
  compressionLevel,
  threshold,
  writeDiffs
}: {
  expectedPages: Array<{ png: Buffer }>;
  actualPages: Array<{ png: Buffer }>;
  matrixCase: MatrixCase;
  compressionLevel: number;
  threshold: number;
  writeDiffs: boolean;
}) {
  const comparisons = [];

  for (let index = 0; index < expectedPages.length; index += 1) {
    const diffPath = path.join(
      QUALITY_OUTPUT_DIR,
      "diffs",
      `${slug(matrixCase.path)}-${compressionLevel}-page-${index + 1}.png`
    );
    const comparison = await compareRenderedImages({
      expected: expectedPages[index].png,
      actual: actualPages[index]?.png ?? Buffer.alloc(0),
      diffPath,
      writeDiff: writeDiffs
    });

    if (writeDiffs && comparison.score <= threshold && comparison.dimensionsMatch) {
      comparison.diffPath = undefined;
    }

    comparisons.push(comparison);
  }

  return comparisons;
}

async function assertTransparencyBehavior(
  matrixCase: MatrixCase,
  output: Blob[],
  row: MatrixRow
) {
  if (
    (matrixCase.inputKind === "png" || matrixCase.inputKind === "webp") &&
    (matrixCase.target === "png" || matrixCase.target === "webp")
  ) {
    const metadata = await getImageMetadata(output[0]);

    if (!metadata.hasAlpha) {
      row.finalResult = "Fail";
      row.notes.push("Transparent input did not preserve an alpha channel.");
    }
  }

  if (warnsAboutTransparencyReplacement(matrixCase.inputKind, matrixCase.target)) {
    const png =
      matrixCase.target === "pdf"
        ? (await renderPdfBlobToImages(output[0], { scale: 1 }))[0].png
        : await imageBlobToPng(output[0]);
    const cornerIsWhite = await hasWhiteCorner(png);

    if (!cornerIsWhite) {
      row.finalResult = "Fail";
      row.notes.push("Transparent corner was not replaced with a white background.");
    }
  }
}

async function hasWhiteCorner(png: Buffer) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sampleCoordinates = [
    [0, 0],
    [info.width - 1, 0],
    [0, info.height - 1],
    [info.width - 1, info.height - 1]
  ];

  return sampleCoordinates.every(([x, y]) => {
    const offset = (y * info.width + x) * 4;

    return data[offset] >= 245 && data[offset + 1] >= 245 && data[offset + 2] >= 245;
  });
}

function expandCases(cases: MatrixCase[]) {
  return cases.flatMap((matrixCase) => {
    const levels = supportsCompression(matrixCase.inputKind, matrixCase.target)
      ? [0, 50, 90]
      : [0];

    return levels.map((compressionLevel) => ({
      path: matrixCase.path,
      fixture: matrixCase.fixture,
      compressionLevel,
      matrixCase
    }));
  });
}

function getExpectedWarnings(matrixCase: MatrixCase) {
  const warnings: string[] = [];

  if (warnsAboutTransparencyReplacement(matrixCase.inputKind, matrixCase.target)) {
    warnings.push("Transparent areas will be replaced with a white background.");
  }

  if (isSameFormatReencode(matrixCase.inputKind, matrixCase.target)) {
    warnings.push("Same-format output is a compression/re-encoding tool.");
  }

  if (matrixCase.inputKind === "pdf" && matrixCase.target !== "pdf") {
    warnings.push("PDF output is rasterized and not editable text.");
  }

  if (matrixCase.inputKind === "pdf" && matrixCase.target === "pdf") {
    warnings.push("Compressed PDF may rasterize text and vector content.");
  }

  if (!supportsCompression(matrixCase.inputKind, matrixCase.target)) {
    warnings.push("Compression slider is unavailable for this path.");
  }

  return warnings;
}

function getThreshold(matrixCase: MatrixCase, compressionLevel: number) {
  if (!supportsCompression(matrixCase.inputKind, matrixCase.target)) {
    return matrixCase.target === "png"
      ? VISUAL_DIFF_THRESHOLDS.losslessRaster
      : VISUAL_DIFF_THRESHOLDS.lowLossy;
  }

  if (compressionLevel === 0) {
    return matrixCase.target === "pdf"
      ? VISUAL_DIFF_THRESHOLDS.losslessRaster
      : VISUAL_DIFF_THRESHOLDS.lowLossy;
  }

  if (compressionLevel === 50) {
    return matrixCase.target === "pdf"
      ? VISUAL_DIFF_THRESHOLDS.mediumLossy
      : VISUAL_DIFF_THRESHOLDS.mediumLossy;
  }

  return matrixCase.target === "pdf"
    ? VISUAL_DIFF_THRESHOLDS.aggressiveLossy
    : VISUAL_DIFF_THRESHOLDS.highLossy;
}

function expectedMime(target: ConversionTarget) {
  if (target === "pdf") {
    return "application/pdf";
  }

  if (target === "jpg") {
    return "image/jpeg";
  }

  return `image/${target}`;
}

async function expectPdfPageCount(file: File, expectedPageCount: number) {
  const pages = await renderPdfBlobToImages(file, { scale: 0.25 });
  expect(pages).toHaveLength(expectedPageCount);
}

async function expectImage(
  file: File,
  width: number,
  height: number,
  hasAlpha: boolean
) {
  const metadata = await getImageMetadata(file);

  expect(metadata.width).toBe(width);
  expect(metadata.height).toBe(height);
  expect(metadata.hasAlpha).toBe(hasAlpha);
}

function pdfCase(path: string, target: ConversionTarget): MatrixCase {
  return {
    path,
    inputKind: "pdf",
    inputCategory: "pdf",
    fixture: "mixedContentPdf",
    target,
    outputType: target as MatrixCase["outputType"]
  };
}

function imageCase(
  path: string,
  inputKind: "jpg" | "png" | "webp",
  fixture: FixtureKey,
  target: ConversionTarget
): MatrixCase {
  return {
    path,
    inputKind,
    inputCategory: "image",
    fixture,
    target,
    outputType: target as MatrixCase["outputType"]
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildMarkdownReport(rows: MatrixRow[]) {
  const lines = [
    "# Looma Conversion Quality Matrix",
    "",
    "| Path | Fixture | Compression | Output | Count | Visual Score | Threshold | Warnings | Result |",
    "|---|---|---:|---|---:|---:|---:|---|---|"
  ];

  rows.forEach((row) => {
    lines.push(
      `| ${row.path} | ${row.fixture} | ${row.compressionLevel}% | ${row.outputType} | ${row.outputCount}/${row.expectedOutputCount} | ${formatScore(
        row.visualDifferenceScore
      )} | ${row.visualDifferenceThreshold.toFixed(3)} | ${row.warningsExpected.join(
        "<br>"
      ) || "None"} | ${row.finalResult} |`
    );
  });

  lines.push("");
  lines.push("## Metadata and Color Profile Notes");
  lines.push("");
  const uniqueMetadataNotes = Array.from(
    new Set(rows.map((row) => `${row.path}: ${row.metadataColorProfileRisk}`))
  );

  uniqueMetadataNotes.forEach((note) => {
    lines.push(`- ${note}`);
  });
  lines.push("");
  lines.push("## Scorecard");
  lines.push("");
  lines.push("- Pass: output opens, page/file count is correct, dimensions/orientation match, and visual score is within threshold.");
  lines.push("- Pass With Warning: output passes checks but has an expected user-facing limitation.");
  lines.push("- Fail: output opens but visual quality, dimensions, transparency, or metadata behavior is outside the accepted limit.");
  lines.push("- Disable: conversion throws, output is corrupt, or the target is not actually enabled.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function getMetadataColorProfileRisk(matrixCase: MatrixCase) {
  if (matrixCase.inputKind === "pdf" && matrixCase.target === "pdf") {
    return "PDF metadata may change; compression can rasterize text/vector content.";
  }

  if (matrixCase.inputKind === "pdf") {
    return "PDF metadata and selectable text are not retained in raster image outputs.";
  }

  if (matrixCase.target === "pdf") {
    return "Image metadata, EXIF data, and embedded color profiles may be stripped when packaging as PDF.";
  }

  return "Image metadata, EXIF data, and embedded color profiles may be stripped during browser canvas re-encoding.";
}

function formatScore(score: number | null) {
  return score === null ? "n/a" : score.toFixed(4);
}

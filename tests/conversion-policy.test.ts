import { describe, expect, it } from "vitest";

import {
  CONVERSION_WARNING_MESSAGES,
  convertFile,
  getConversionWarnings,
  getSupportedTargetsForCategory,
  supportsCompression,
  warnsAboutTransparencyReplacement,
  type ConversionTarget
} from "@/lib/conversion-engine";
import { validateFileSafety } from "@/lib/file-safety";

import { makePdfFile } from "./fixtures/file-factory";

describe("conversion policy", () => {
  it("keeps DOCX out of private-beta output targets", () => {
    expect(getSupportedTargetsForCategory("pdf").map((target) => target.value)).toEqual([
      "pdf",
      "jpg",
      "png",
      "webp"
    ]);
    expect(getSupportedTargetsForCategory("image").map((target) => target.value)).toEqual([
      "pdf",
      "jpg",
      "png",
      "webp"
    ]);
  });

  it("rejects a stale direct DOCX output target before conversion begins", async () => {
    const file = await makePdfFile("source.pdf", 1);
    const safety = await validateFileSafety(file);
    const progress: string[] = [];

    expect(safety.ok).toBe(true);

    if (!safety.ok) {
      return;
    }

    await expect(
      convertFile(file, {
        compressionLevel: 0,
        fileSafety: safety,
        target: "docx" as ConversionTarget,
        onProgress: (nextProgress) => progress.push(nextProgress.label)
      })
    ).rejects.toThrow("The selected output is not available");
    expect(progress).toEqual([]);
  });

  it("reports compression availability only for paths where compression is meaningful", () => {
    expect(supportsCompression("pdf", "pdf")).toBe(true);
    expect(supportsCompression("pdf", "jpg")).toBe(true);
    expect(supportsCompression("pdf", "png")).toBe(false);
    expect(supportsCompression("pdf", "webp")).toBe(true);

    expect(supportsCompression("jpg", "pdf")).toBe(true);
    expect(supportsCompression("jpg", "jpg")).toBe(true);
    expect(supportsCompression("jpg", "png")).toBe(false);
    expect(supportsCompression("jpg", "webp")).toBe(true);

    expect(supportsCompression("png", "pdf")).toBe(false);
    expect(supportsCompression("png", "jpg")).toBe(true);
    expect(supportsCompression("png", "png")).toBe(false);
    expect(supportsCompression("png", "webp")).toBe(true);

    expect(supportsCompression("webp", "pdf")).toBe(true);
    expect(supportsCompression("webp", "jpg")).toBe(true);
    expect(supportsCompression("webp", "png")).toBe(false);
    expect(supportsCompression("webp", "webp")).toBe(true);
  });

  it("warns when PNG or WEBP transparency may be replaced for JPG or PDF output", () => {
    expect(warnsAboutTransparencyReplacement("png", "jpg")).toBe(true);
    expect(warnsAboutTransparencyReplacement("png", "pdf")).toBe(true);
    expect(warnsAboutTransparencyReplacement("webp", "jpg")).toBe(true);
    expect(warnsAboutTransparencyReplacement("webp", "pdf")).toBe(true);
    expect(warnsAboutTransparencyReplacement("png", "webp")).toBe(false);
    expect(warnsAboutTransparencyReplacement("jpg", "pdf")).toBe(false);
  });

  it("returns PDF compression warnings only when compression is above 0%", () => {
    expect(
      getConversionWarnings({
        inputKind: "pdf",
        target: "pdf",
        compressionLevel: 0
      })
    ).not.toContain(CONVERSION_WARNING_MESSAGES.pdfCompressionRasterizes);
    expect(
      getConversionWarnings({
        inputKind: "pdf",
        target: "pdf",
        compressionLevel: 50
      })
    ).toContain(CONVERSION_WARNING_MESSAGES.pdfCompressionRasterizes);
  });

  it("returns visual image export warnings for PDF to image outputs", () => {
    for (const target of ["jpg", "png", "webp"] as const) {
      expect(
        getConversionWarnings({
          inputKind: "pdf",
          target,
          compressionLevel: 0
        })
      ).toContain(CONVERSION_WARNING_MESSAGES.pdfImageExport);
    }
  });

  it("returns transparency warnings for PNG or WEBP to JPG or PDF outputs", () => {
    for (const inputKind of ["png", "webp"] as const) {
      for (const target of ["jpg", "pdf"] as const) {
        expect(
          getConversionWarnings({
            inputKind,
            target,
            compressionLevel: 0
          })
        ).toContain(CONVERSION_WARNING_MESSAGES.transparencyReplaced);
      }
    }
  });

  it("returns same-format re-encode warnings for JPG and WEBP compression paths", () => {
    expect(
      getConversionWarnings({
        inputKind: "jpg",
        target: "jpg",
        compressionLevel: 0
      })
    ).toContain(CONVERSION_WARNING_MESSAGES.sameFormatReencode);
    expect(
      getConversionWarnings({
        inputKind: "webp",
        target: "webp",
        compressionLevel: 90
      })
    ).toContain(CONVERSION_WARNING_MESSAGES.sameFormatReencode);
  });
});

import { describe, expect, it } from "vitest";

import {
  ACCEPTED_FILE_TYPES,
  BETA_FILE_SAFETY_LIMITS,
  FILE_SAFETY_ERROR_CODES,
  WORD_CONVERSION_PRIVATE_BETA_MESSAGE,
  getFileIdentity,
  isFileSafetyResultForFile,
  type SuccessfulFileSafetyResult,
  validateFileSafety
} from "@/lib/file-safety";
import { convertFile } from "@/lib/conversion-engine";

import {
  createTestFile,
  makeCorruptImageFile,
  makeCorruptPdfFile,
  makeDocxFile,
  makeEncryptedPdfFile,
  makeInvalidDocxPackageFile,
  makePdfFile,
  makePngWithDimensions,
  makeTinyJpgFile,
  makeTinyPngFile,
  makeTinyWebpFile,
  makeZipRenamedAsDocxFile
} from "./fixtures/file-factory";

describe("validateFileSafety", () => {
  it("accepts a valid small PDF and returns page metadata", async () => {
    const result = await validateFileSafety(await makePdfFile("small.pdf", 1));

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.input.category).toBe("pdf");
      expect(result.input.kind).toBe("pdf");
      expect(result.pdf?.pageCount).toBe(1);
    }
  });

  it("rejects a PDF over the private-beta page limit", async () => {
    const result = await validateFileSafety(
      await makePdfFile("too-many-pages.pdf", BETA_FILE_SAFETY_LIMITS.pdf.maxPages + 1)
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.PDF_PAGE_LIMIT);
      expect(result.message).toContain(`${BETA_FILE_SAFETY_LIMITS.pdf.maxPages}`);
      expect(result.message).toContain("pages");
    }
  });

  it("rejects an encrypted PDF with a stable code and friendly message", async () => {
    const result = await validateFileSafety(makeEncryptedPdfFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.PDF_ENCRYPTED);
      expect(result.message).toContain("password-protected");
    }
  });

  it("rejects a corrupt PDF", async () => {
    const result = await validateFileSafety(makeCorruptPdfFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.PDF_CORRUPT);
      expect(result.message).toContain("could not be read as a PDF");
    }
  });

  it("does not advertise DOCX as a supported private-beta input", () => {
    expect(Object.values(ACCEPTED_FILE_TYPES).flat()).not.toContain(".docx");
  });

  it("rejects a structurally valid DOCX package with the honest private-beta message", async () => {
    const result = await validateFileSafety(await makeDocxFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.WORD_CONVERSION_UNAVAILABLE);
      expect(result.message).toBe(WORD_CONVERSION_PRIVATE_BETA_MESSAGE);
    }
  });

  it("rejects invalid DOCX-looking files with the same private-beta message", async () => {
    const result = await validateFileSafety(await makeInvalidDocxPackageFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.WORD_CONVERSION_UNAVAILABLE);
      expect(result.message).toBe(WORD_CONVERSION_PRIVATE_BETA_MESSAGE);
    }
  });

  it("rejects an ordinary ZIP renamed as DOCX with the same private-beta message", async () => {
    const result = await validateFileSafety(await makeZipRenamedAsDocxFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.WORD_CONVERSION_UNAVAILABLE);
      expect(result.message).toBe(WORD_CONVERSION_PRIVATE_BETA_MESSAGE);
    }
  });

  it("does not start DOCX input conversion even if called with stale successful DOCX state", async () => {
    const file = await makeDocxFile();
    const progress: string[] = [];
    const staleDocxSafety = {
      ok: true,
      file,
      identity: getFileIdentity(file),
      input: {
        kind: "docx",
        category: "docx",
        label: "DOCX"
      },
      limits: BETA_FILE_SAFETY_LIMITS
    } as unknown as SuccessfulFileSafetyResult;

    await expect(
      convertFile(file, {
        compressionLevel: 0,
        fileSafety: staleDocxSafety,
        target: "pdf",
        onProgress: (nextProgress) => progress.push(nextProgress.label)
      })
    ).rejects.toThrow("The selected output is not available");
    expect(progress).toEqual([]);
  });

  it("accepts valid tiny real JPG, PNG, and WEBP image fixtures", async () => {
    const jpg = await validateFileSafety(makeTinyJpgFile());
    const png = await validateFileSafety(makeTinyPngFile());
    const webp = await validateFileSafety(makeTinyWebpFile());

    expect(jpg.ok && jpg.input.kind).toBe("jpg");
    expect(png.ok && png.input.kind).toBe("png");
    expect(webp.ok && webp.input.kind).toBe("webp");

    if (jpg.ok && png.ok && webp.ok) {
      expect(jpg.image).toMatchObject({ width: 1, height: 1 });
      expect(png.image).toMatchObject({ width: 1, height: 1 });
      expect(webp.image).toMatchObject({ width: 1, height: 1 });
    }
  });

  it("rejects images over the megapixel limit", async () => {
    const result = await validateFileSafety(makePngWithDimensions(8000, 6000));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.IMAGE_MEGAPIXEL_LIMIT);
      expect(result.message).toContain("megapixels");
      expect(result.message).toContain(`${BETA_FILE_SAFETY_LIMITS.png.maxMegapixels}`);
    }
  });

  it("rejects images over the dimension limit", async () => {
    const result = await validateFileSafety(
      makePngWithDimensions(BETA_FILE_SAFETY_LIMITS.png.maxDimensionPixels + 1, 1)
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.IMAGE_DIMENSION_LIMIT);
      expect(result.message).toContain(`${BETA_FILE_SAFETY_LIMITS.png.maxDimensionPixels}px`);
    }
  });

  it("rejects corrupt images with unreadable dimensions", async () => {
    const result = await validateFileSafety(makeCorruptImageFile());

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.IMAGE_DIMENSIONS_UNREADABLE);
      expect(result.message).toContain("could not safely read its dimensions");
    }
  });

  it("uses detected signatures for misleading extension or MIME values", async () => {
    const result = await validateFileSafety(
      makeTinyPngFile("misleading.pdf", "application/pdf")
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.input.category).toBe("image");
      expect(result.input.kind).toBe("png");
    }
  });

  it("rejects declared images with invalid file signatures", async () => {
    const result = await validateFileSafety(
      createTestFile("fake.png", "image/png", new TextEncoder().encode("not an image"))
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.code).toBe(FILE_SAFETY_ERROR_CODES.INVALID_FILE_SIGNATURE);
      expect(result.message).toContain("valid PNG");
    }
  });

  it("ties successful validation to the exact File object and metadata", async () => {
    const file = makeTinyPngFile("identity.png");
    const result = await validateFileSafety(file);
    const replacement = makeTinyPngFile("identity.png");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(isFileSafetyResultForFile(file, result)).toBe(true);
      expect(isFileSafetyResultForFile(replacement, result)).toBe(false);
    }
  });
});

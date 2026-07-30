import { expect, test } from "@playwright/test";

import {
  CONVERSION_WARNING_MESSAGES,
  GENERAL_METADATA_WARNING
} from "@/lib/conversion-engine";
import { WORD_CONVERSION_PRIVATE_BETA_MESSAGE } from "@/lib/file-safety";

import { writeBrowserFixtureFiles } from "../fixtures/file-factory";

test("rejects unsafe upload, clears stale state, recovers with valid upload, and resets", async ({
  page
}, testInfo) => {
  const fixtures = await writeBrowserFixtureFiles(testInfo.outputPath("fixtures"));
  const uploadInput = page.locator('input[aria-label="Upload files"]');
  const convertButton = page.getByRole("button", { name: /Convert & Download/i });
  const compressionSlider = page.locator('[aria-label="Compression level"]');
  const compressionThumb = page.getByRole("slider");

  await page.goto("/");

  await expect(page.getByText("Drop file here")).toBeVisible();
  await expect(page.getByText("Private PDF & Image Converter")).toBeVisible();
  await expect(
    page.getByText("Convert and compress PDF, JPG, PNG, and WEBP files locally in your browser.")
  ).toBeVisible();
  await expect(page.getByText(GENERAL_METADATA_WARNING)).toBeVisible();
  await expect(page.getByText("PDF, JPG, PNG, WEBP")).toBeVisible();
  await expect(page.getByText("High-fidelity Word conversion is coming soon.")).toBeVisible();
  await expect(page.getByText("PDF, DOCX, JPG, PNG, WEBP")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DOCX" })).toHaveCount(0);
  await expect(convertButton).toBeDisabled();

  await uploadInput.setInputFiles(fixtures.validPdf);
  await expect(page.getByText("valid.pdf")).toBeVisible();
  await page.getByRole("button", { name: "PDF" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.pdfCompressionRasterizes
    })
  ).toHaveCount(0);
  await compressionThumb.press("ArrowRight");
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.pdfCompressionRasterizes
    })
  ).toBeVisible();
  await page.getByRole("button", { name: "JPG" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.pdfImageExport
    })
  ).toBeVisible();
  await expect(convertButton).toBeEnabled();

  const pdfToImageDownload = page.waitForEvent("download");
  await convertButton.click();
  await pdfToImageDownload;

  await expect(page.getByText("Download Ready")).toBeVisible();

  await uploadInput.setInputFiles(fixtures.validPng);
  await expect(page.getByText("tiny.png")).toBeVisible();

  await page.getByRole("button", { name: "PNG" }).click();
  await expect(compressionSlider).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/Compression is unavailable for PNG to PNG/)).toBeVisible();

  await page.getByRole("button", { name: "JPG" }).click();
  await expect(compressionSlider).toHaveAttribute("aria-disabled", "false");
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.transparencyReplaced
    })
  ).toBeVisible();
  await expect(convertButton).toBeEnabled();

  const transparencyDownload = page.waitForEvent("download");
  await convertButton.click();
  await transparencyDownload;

  await expect(page.getByText("Download Ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Convert Another File" })).toBeVisible();

  await uploadInput.setInputFiles(fixtures.validDocx);

  const fileSafetyError = page.getByRole("alert").filter({
    hasText: WORD_CONVERSION_PRIVATE_BETA_MESSAGE
  });

  await expect(fileSafetyError).toBeVisible();
  await expect(fileSafetyError).toHaveAttribute("aria-live", /polite|assertive/);
  await expect(fileSafetyError).toContainText("High-fidelity Word conversion");
  await expect(convertButton).toBeDisabled();
  await expect(page.getByText("Download Ready")).toHaveCount(0);
  await expect(page.getByText("tiny.png")).toHaveCount(0);
  await expect(page.getByText("valid.docx")).toHaveCount(0);

  await uploadInput.setInputFiles(fixtures.validPng);
  await expect(fileSafetyError).toHaveCount(0);
  await expect(page.getByText("tiny.png")).toBeVisible();
  await expect(convertButton).toBeEnabled();

  await uploadInput.setInputFiles(fixtures.validWebp);
  await expect(page.getByText("tiny.webp")).toBeVisible();
  await page.getByRole("button", { name: "PDF" }).click();
  await expect(compressionSlider).toHaveAttribute("aria-disabled", "false");
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.transparencyReplaced
    })
  ).toBeVisible();

  const imageToPdfDownload = page.waitForEvent("download");
  await convertButton.click();
  await imageToPdfDownload;

  await expect(page.getByText("Download Ready")).toBeVisible();

  await uploadInput.setInputFiles(fixtures.validJpg);
  await expect(page.getByText("tiny.jpg")).toBeVisible();
  await page.getByRole("button", { name: "JPG" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: CONVERSION_WARNING_MESSAGES.sameFormatReencode
    })
  ).toBeVisible();
  await expect(page.getByText("0% / Re-encode")).toBeVisible();

  const sameFormatDownload = page.waitForEvent("download");
  await convertButton.click();
  await sameFormatDownload;

  await expect(page.getByText("Download Ready")).toBeVisible();

  await page.getByRole("button", { name: "Convert Another File" }).click();

  await expect(page.getByText("Drop file here")).toBeVisible();
  await expect(page.getByText("tiny.png")).toHaveCount(0);
  await expect(page.getByText("Download Ready")).toHaveCount(0);
  await expect(fileSafetyError).toHaveCount(0);
  await expect(convertButton).toBeDisabled();
  await expect(page.getByText("0% / Standard")).toBeVisible();
  await expect(page.getByRole("button", { name: "DOCX" })).toHaveCount(0);

  for (const format of ["PDF", "JPG", "PNG", "WEBP"]) {
    await expect(page.getByRole("button", { name: format })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  }
});

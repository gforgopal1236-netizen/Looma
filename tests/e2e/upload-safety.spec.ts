import { expect, test } from "@playwright/test";

import { WORD_CONVERSION_PRIVATE_BETA_MESSAGE } from "@/lib/file-safety";

import { writeBrowserFixtureFiles } from "../fixtures/file-factory";

test("rejects unsafe upload, clears stale state, recovers with valid upload, and resets", async ({
  page
}, testInfo) => {
  const fixtures = await writeBrowserFixtureFiles(testInfo.outputPath("fixtures"));
  const uploadInput = page.locator('input[aria-label="Upload files"]');
  const convertButton = page.getByRole("button", { name: /Convert & Download/i });
  const compressionSlider = page.locator('[aria-label="Compression level"]');

  await page.goto("/");

  await expect(page.getByText("Drop file here")).toBeVisible();
  await expect(page.getByText("Private PDF & Image Converter")).toBeVisible();
  await expect(
    page.getByText("Convert and compress PDF, JPG, PNG, and WEBP files locally in your browser.")
  ).toBeVisible();
  await expect(page.getByText("PDF, JPG, PNG, WEBP")).toBeVisible();
  await expect(page.getByText("High-fidelity Word conversion is coming soon.")).toBeVisible();
  await expect(page.getByText("PDF, DOCX, JPG, PNG, WEBP")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "DOCX" })).toHaveCount(0);
  await expect(convertButton).toBeDisabled();

  await uploadInput.setInputFiles(fixtures.validPng);
  await expect(page.getByText("tiny.png")).toBeVisible();

  await page.getByRole("button", { name: "PNG" }).click();
  await expect(compressionSlider).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Unavailable")).toBeVisible();
  await expect(page.getByText(/Compression is unavailable for PNG to PNG/)).toBeVisible();

  await page.getByRole("button", { name: "JPG" }).click();
  await expect(compressionSlider).toHaveAttribute("aria-disabled", "false");
  await expect(
    page.getByText("Transparent areas will be replaced with a white background.")
  ).toBeVisible();
  await expect(convertButton).toBeEnabled();

  const firstDownload = page.waitForEvent("download");
  await convertButton.click();
  await firstDownload;

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
    page.getByText("Transparent areas will be replaced with a white background.")
  ).toBeVisible();

  const secondDownload = page.waitForEvent("download");
  await convertButton.click();
  await secondDownload;

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

# Looma File-Safety Fixtures

The tests generate fixture files at runtime instead of committing large binaries.

- Tiny valid JPG, PNG, and WEBP images are embedded as small base64 byte strings
  in `file-factory.ts`.
- Oversized, corrupt, and structurally invalid cases are generated from metadata
  or minimal byte sequences.
- Browser-test files are written into `test-results/`, which is ignored by Git.
- Do not commit genuinely large PDFs, DOCX files, or images for these tests.

The encrypted PDF fixture is a tiny standards-style PDF generated in memory with
an `/Encrypt` trailer entry so pdf.js follows its password-protected path.

## Conversion-quality fixtures

`quality-fixtures.ts` generates Looma's visual-quality matrix inputs at runtime:

- `simple-one-page.pdf`: basic text and vector line checks.
- `multi-page.pdf`: page-count and ordering checks.
- `mixed-content.pdf`: text, embedded images, vector graphics, and multiple pages.
- `normal.jpg`: ordinary sharp-edged image.
- `high-resolution.jpg`: moderate high-resolution stress case kept small enough for CI.
- `edge-text.jpg`: fine text and hard-edge image conversion checks.
- `photo.jpg`: deterministic photographic gradient/noise fixture.
- `transparent.png` and `transparent.webp`: alpha handling and white-background warning checks.
- `opaque.png` and `opaque.webp`: non-transparent baseline image checks.
- `exif-rotated.jpg`: generated for orientation investigation; Looma does not currently make a private-beta quality claim for EXIF rotation.

The conversion-quality matrix writes machine-readable JSON and a product-manager
friendly Markdown scorecard to `test-results/conversion-quality/`.

Scorecard meanings:

- Pass: output opens, expected count matches, dimensions/orientation match, and visual difference is within threshold.
- Pass With Warning: output passes checks but has an expected user-facing limitation.
- Fail: output opens but visual quality, dimensions, transparency, or metadata behavior is outside the accepted limit.
- Disable: conversion throws, output is corrupt, or the target is not actually enabled.

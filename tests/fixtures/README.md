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

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

import { BETA_FILE_SAFETY_LIMITS } from "@/lib/file-safety";

const DEFAULT_LAST_MODIFIED = 1_700_000_000_000;

const TINY_IMAGE_BASE64 = {
  jpg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  webp: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"
};

export function createTestFile(name: string, type: string, bytes: Uint8Array) {
  return new File([toArrayBuffer(bytes)], name, {
    lastModified: DEFAULT_LAST_MODIFIED,
    type
  });
}

export async function makePdfFile(name = "valid.pdf", pageCount = 1) {
  const pdf = await PDFDocument.create();

  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200, 200]);
  }

  const bytes = await pdf.save({ useObjectStreams: false });

  return createTestFile(name, "application/pdf", bytes);
}

export function makeEncryptedPdfFile(name = "encrypted.pdf") {
  return createTestFile(name, "application/pdf", makeMinimalPdfBytes({ encrypted: true }));
}

export function makeCorruptPdfFile(name = "corrupt.pdf") {
  return createTestFile(
    name,
    "application/pdf",
    bytesFromAscii("%PDF-1.4\nthis is not a complete pdf\n%%EOF\n")
  );
}

export async function makeDocxFile(name = "valid.docx") {
  const doc = new Document({
    sections: [
      {
        children: [new Paragraph("Hello from Looma.")]
      }
    ]
  });
  const buffer = await Packer.toBuffer(doc);

  return createTestFile(name, docxMimeType, Uint8Array.from(buffer));
}

export async function makeInvalidDocxPackageFile(name = "invalid.docx") {
  const zip = new JSZip();

  zip.file("[Content_Types].xml", "<Types></Types>");

  return createTestFile(name, docxMimeType, await zip.generateAsync({ type: "uint8array" }));
}

export async function makeZipRenamedAsDocxFile(name = "renamed.docx") {
  const zip = new JSZip();

  zip.file("notes.txt", "This is only a ZIP file.");

  return createTestFile(name, docxMimeType, await zip.generateAsync({ type: "uint8array" }));
}

export function makeTinyJpgFile(name = "tiny.jpg", type = "image/jpeg") {
  return createTestFile(name, type, bytesFromBase64(TINY_IMAGE_BASE64.jpg));
}

export function makeTinyPngFile(name = "tiny.png", type = "image/png") {
  return createTestFile(name, type, bytesFromBase64(TINY_IMAGE_BASE64.png));
}

export function makeTinyWebpFile(name = "tiny.webp", type = "image/webp") {
  return createTestFile(name, type, bytesFromBase64(TINY_IMAGE_BASE64.webp));
}

export function makePngWithDimensions(
  width: number,
  height: number,
  name = "unsafe.png"
) {
  return createTestFile(name, "image/png", makePngDimensionBytes(width, height));
}

export function makeCorruptImageFile(name = "corrupt.jpg") {
  return createTestFile(
    name,
    "image/jpeg",
    Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
  );
}

export async function writeBrowserFixtureFiles(directory: string) {
  await mkdir(directory, { recursive: true });

  const files = {
    invalidTooWidePng: path.join(directory, "too-wide.png"),
    validDocx: path.join(directory, "valid.docx"),
    validJpg: path.join(directory, "tiny.jpg"),
    validPdf: path.join(directory, "valid.pdf"),
    validPng: path.join(directory, "tiny.png"),
    validWebp: path.join(directory, "tiny.webp")
  };

  const docx = await makeDocxFile("valid.docx");
  const pdf = await makePdfFile("valid.pdf", 1);

  await writeFile(files.validDocx, new Uint8Array(await docx.arrayBuffer()));
  await writeFile(files.validPdf, new Uint8Array(await pdf.arrayBuffer()));
  await writeFile(files.validJpg, bytesFromBase64(TINY_IMAGE_BASE64.jpg));
  await writeFile(files.validPng, bytesFromBase64(TINY_IMAGE_BASE64.png));
  await writeFile(files.validWebp, bytesFromBase64(TINY_IMAGE_BASE64.webp));
  await writeFile(
    files.invalidTooWidePng,
    makePngDimensionBytes(
      BETA_FILE_SAFETY_LIMITS.png.maxDimensionPixels + 1,
      1
    )
  );

  return files;
}

function makeMinimalPdfBytes({ encrypted }: { encrypted: boolean }) {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n"
  ];

  if (encrypted) {
    objects.push(
      "4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>\nendobj\n"
    );
  }

  let output = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += object;
  });

  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += "xref\n";
  output += `0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";

  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  output += "trailer\n";
  output += encrypted
    ? `<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R >>\n`
    : `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Uint8Array.from(Buffer.from(output, "latin1"));
}

function makePngDimensionBytes(width: number, height: number) {
  const bytes = new Uint8Array(33);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set(bytesFromAscii("IHDR"), 12);
  writeUint32BE(bytes, 16, width);
  writeUint32BE(bytes, 20, height);
  bytes[24] = 8;
  bytes[25] = 6;

  return bytes;
}

function bytesFromBase64(value: string) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function bytesFromAscii(value: string) {
  return Uint8Array.from(Buffer.from(value, "ascii"));
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy.buffer;
}

const docxMimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

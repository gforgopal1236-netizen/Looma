import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

import { createTestFile } from "./file-factory";

export interface QualityFixtures {
  simplePdf: File;
  multiPagePdf: File;
  mixedContentPdf: File;
  normalJpg: File;
  highResolutionJpg: File;
  edgeTextJpg: File;
  exifRotatedJpg: File;
  transparentPng: File;
  opaquePng: File;
  transparentWebp: File;
  opaqueWebp: File;
  photoJpg: File;
}

export async function makeQualityFixtures(): Promise<QualityFixtures> {
  const opaquePngBytes = await drawEdgeFixture({ transparent: false });
  const transparentPngBytes = await drawEdgeFixture({ transparent: true });
  const photoPngBytes = await drawPhotoFixture(480, 320);
  const highResolutionPngBytes = await drawHighResolutionFixture();
  const normalJpgBytes = await sharp(opaquePngBytes)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const edgeTextJpgBytes = await sharp(opaquePngBytes)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  const highResolutionJpgBytes = await sharp(highResolutionPngBytes)
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const photoJpgBytes = await sharp(photoPngBytes)
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const exifRotatedJpgBytes = await sharp(opaquePngBytes)
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const transparentWebpBytes = await sharp(transparentPngBytes)
    .webp({ quality: 90, lossless: false })
    .toBuffer();
  const opaqueWebpBytes = await sharp(opaquePngBytes)
    .webp({ quality: 90, lossless: false })
    .toBuffer();

  return {
    simplePdf: createTestFile(
      "simple-one-page.pdf",
      "application/pdf",
      await makeSimplePdf()
    ),
    multiPagePdf: createTestFile(
      "multi-page.pdf",
      "application/pdf",
      await makeMultiPagePdf()
    ),
    mixedContentPdf: createTestFile(
      "mixed-content.pdf",
      "application/pdf",
      await makeMixedContentPdf(opaquePngBytes, photoJpgBytes)
    ),
    normalJpg: createTestFile("normal.jpg", "image/jpeg", normalJpgBytes),
    highResolutionJpg: createTestFile(
      "high-resolution.jpg",
      "image/jpeg",
      highResolutionJpgBytes
    ),
    edgeTextJpg: createTestFile("edge-text.jpg", "image/jpeg", edgeTextJpgBytes),
    exifRotatedJpg: createTestFile(
      "exif-rotated.jpg",
      "image/jpeg",
      exifRotatedJpgBytes
    ),
    transparentPng: createTestFile(
      "transparent.png",
      "image/png",
      transparentPngBytes
    ),
    opaquePng: createTestFile("opaque.png", "image/png", opaquePngBytes),
    transparentWebp: createTestFile(
      "transparent.webp",
      "image/webp",
      transparentWebpBytes
    ),
    opaqueWebp: createTestFile("opaque.webp", "image/webp", opaqueWebpBytes),
    photoJpg: createTestFile("photo.jpg", "image/jpeg", photoJpgBytes)
  };
}

async function makeSimplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([420, 300]);

  page.drawText("Looma PDF quality fixture", {
    x: 36,
    y: 240,
    size: 20,
    font: bold,
    color: rgb(0.08, 0.08, 0.08)
  });
  page.drawText("Simple one-page PDF with text and vector lines.", {
    x: 36,
    y: 210,
    size: 11,
    font,
    color: rgb(0.15, 0.15, 0.15)
  });
  page.drawLine({
    start: { x: 36, y: 190 },
    end: { x: 384, y: 190 },
    thickness: 1,
    color: rgb(0.1, 0.36, 0.7)
  });
  page.drawRectangle({
    x: 36,
    y: 70,
    width: 120,
    height: 70,
    borderWidth: 2,
    borderColor: rgb(0.85, 0.15, 0.12),
    color: rgb(0.98, 0.9, 0.88)
  });

  return pdf.save();
}

async function makeMultiPagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
    const page = pdf.addPage([360, 260]);
    page.drawText(`Multi-page fixture / page ${pageNumber}`, {
      x: 32,
      y: 210,
      size: 16,
      font,
      color: rgb(0.08, 0.08, 0.08)
    });
    page.drawRectangle({
      x: 32 + pageNumber * 14,
      y: 62,
      width: 120,
      height: 84,
      color: rgb(0.1 * pageNumber, 0.28, 0.72)
    });
  }

  return pdf.save();
}

async function makeMixedContentPdf(pngBytes: Uint8Array, jpgBytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const embeddedPng = await pdf.embedPng(pngBytes);
  const embeddedJpg = await pdf.embedJpg(jpgBytes);

  const page1 = pdf.addPage([540, 380]);
  page1.drawText("Mixed PDF: text, image, vector", {
    x: 36,
    y: 330,
    size: 20,
    font: bold,
    color: rgb(0.06, 0.06, 0.06)
  });
  page1.drawText("Sharp text and edges should remain recognizable after conversion.", {
    x: 36,
    y: 306,
    size: 11,
    font,
    color: rgb(0.1, 0.1, 0.1)
  });
  page1.drawImage(embeddedPng, {
    x: 36,
    y: 92,
    width: 230,
    height: 130
  });
  page1.drawRectangle({
    x: 314,
    y: 92,
    width: 170,
    height: 130,
    borderColor: rgb(0.92, 0.2, 0.15),
    borderWidth: 3,
    color: rgb(0.92, 0.95, 1)
  });
  page1.drawLine({
    start: { x: 314, y: 92 },
    end: { x: 484, y: 222 },
    thickness: 2,
    color: rgb(0.1, 0.3, 0.75)
  });

  const page2 = pdf.addPage([540, 380]);
  page2.drawText("Mixed PDF: photographic image", {
    x: 36,
    y: 330,
    size: 20,
    font: bold,
    color: rgb(0.06, 0.06, 0.06)
  });
  page2.drawImage(embeddedJpg, {
    x: 36,
    y: 82,
    width: 288,
    height: 192
  });
  page2.drawText("Page 2 includes a JPEG-like photograph and small footer text.", {
    x: 36,
    y: 42,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  });

  return pdf.save();
}

async function drawEdgeFixture({ transparent }: { transparent: boolean }) {
  const canvas = createCanvas(360, 220);
  const context = canvas.getContext("2d");

  if (!transparent) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.fillStyle = transparent ? "rgba(255,255,255,0.88)" : "#f7f9fc";
  context.fillRect(24, 22, 312, 176);
  context.strokeStyle = "#111827";
  context.lineWidth = 3;
  context.strokeRect(24, 22, 312, 176);
  context.fillStyle = "#111827";
  context.font = "700 28px Arial";
  context.fillText("LOOMA", 42, 72);
  context.font = "16px Arial";
  context.fillText("Fine text + sharp edges 123", 42, 104);
  context.strokeStyle = "#e11d48";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(42, 128);
  context.lineTo(318, 128);
  context.stroke();
  context.fillStyle = "#2563eb";
  context.fillRect(42, 148, 82, 30);
  context.fillStyle = "#16a34a";
  context.beginPath();
  context.arc(170, 163, 18, 0, Math.PI * 2);
  context.fill();

  if (transparent) {
    context.clearRect(0, 0, 28, 28);
    context.clearRect(332, 0, 28, 28);
    context.clearRect(0, 192, 28, 28);
    context.clearRect(332, 192, 28, 28);
  }

  const png = await canvas.encode("png");

  return transparent ? png : sharp(png).removeAlpha().png().toBuffer();
}

async function drawPhotoFixture(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const wave = Math.sin((x + y) / 18) * 22;
      pixels[offset] = Math.max(0, Math.min(255, 82 + x / 3 + wave));
      pixels[offset + 1] = Math.max(0, Math.min(255, 102 + y / 3 - wave / 2));
      pixels[offset + 2] = Math.max(0, Math.min(255, 142 + (x + y) / 7));
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function drawHighResolutionFixture() {
  const width = 1280;
  const height = 800;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f8fafc");
  gradient.addColorStop(0.5, "#93c5fd");
  gradient.addColorStop(1, "#111827");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "700 64px Arial";
  context.fillText("High-resolution JPG fixture", 70, 130);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;

  for (let i = 0; i < 12; i += 1) {
    context.strokeRect(70 + i * 36, 210 + i * 18, 360, 180);
  }

  return canvas.encode("png");
}

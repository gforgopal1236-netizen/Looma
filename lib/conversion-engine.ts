import {
  assertFileSafetyResultForFile,
  formatBytes,
  getFileCategory,
  type FileCategory,
  type SuccessfulFileSafetyResult
} from "@/lib/file-safety";

export {
  BETA_FILE_SAFETY_LIMITS,
  formatBytes,
  getFileCategory,
  getFileIdentity,
  isFileSafetyResultForFile,
  validateFileSafety
} from "@/lib/file-safety";

export type {
  FailedFileSafetyResult,
  FileCategory,
  FileSafetyResult,
  SuccessfulFileSafetyResult
} from "@/lib/file-safety";

export type ConversionTarget =
  | "jpg"
  | "png"
  | "webp"
  | "pdf"
  | "docx"
  | "compressed-image"
  | "compressed-pdf";

export type ConversionStage =
  | "queued"
  | "parsing"
  | "converting"
  | "compressing"
  | "packaging"
  | "completed";

export interface ConversionProgress {
  stage: ConversionStage;
  percent: number;
  label: string;
}

export interface ConversionOptions {
  target: ConversionTarget;
  compressionLevel: number;
  fileSafety: SuccessfulFileSafetyResult;
  onProgress?: (progress: ConversionProgress) => void;
}

export interface ConvertedAsset {
  blob: Blob;
  filename: string;
  mimeType: string;
  sourceName: string;
  target: ConversionTarget;
}

export interface TargetOption {
  value: ConversionTarget;
  label: string;
  extension: string;
}

type PdfPageProxy = import("pdfjs-dist").PDFPageProxy;

interface DocumentTextBlock {
  text: string;
  kind: "heading1" | "heading2" | "heading3" | "paragraph" | "list";
}

const TARGETS: Record<ConversionTarget, TargetOption> = {
  jpg: { value: "jpg", label: "JPG images", extension: "jpg" },
  png: { value: "png", label: "PNG images", extension: "png" },
  webp: { value: "webp", label: "WEBP image", extension: "webp" },
  pdf: { value: "pdf", label: "PDF document", extension: "pdf" },
  docx: { value: "docx", label: "Editable DOCX", extension: "docx" },
  "compressed-image": {
    value: "compressed-image",
    label: "Compressed image",
    extension: "image"
  },
  "compressed-pdf": {
    value: "compressed-pdf",
    label: "Compressed PDF",
    extension: "pdf"
  }
};

export function getTargetOption(target: ConversionTarget) {
  return TARGETS[target];
}

export function getSupportedTargets(file: File): TargetOption[] {
  return getSupportedTargetsForCategory(getFileCategory(file));
}

export function getSupportedTargetsForCategory(category: FileCategory): TargetOption[] {
  switch (category) {
    case "pdf":
      return [TARGETS.pdf, TARGETS.docx, TARGETS.jpg, TARGETS.png, TARGETS.webp];
    case "docx":
      return [];
    case "image":
      return [TARGETS.pdf, TARGETS.jpg, TARGETS.png, TARGETS.webp];
    default:
      return [];
  }
}

export async function convertFile(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset[]> {
  const fileSafety = assertFileSafetyResultForFile(file, options.fileSafety);
  const supportedTargets = getSupportedTargetsForCategory(
    fileSafety.input.category
  ).map((target) => target.value);

  if (!supportedTargets.includes(options.target)) {
    throw new Error(`The selected output is not available for ${file.name}.`);
  }

  emit(options, "queued", 1, "Queued...");

  try {
    const category = fileSafety.input.category;

    if (category === "pdf" && options.target === "pdf") {
      return [await compressPdf(file, options)];
    }

    if (
      category === "pdf" &&
      (options.target === "jpg" || options.target === "png" || options.target === "webp")
    ) {
      return await pdfToImages(file, options.target, options);
    }

    if (category === "pdf" && options.target === "docx") {
      // PDF to DOCX remains available for private beta, but needs a separate
      // fidelity audit before public launch.
      return [await pdfToDocx(file, options)];
    }

    if (category === "pdf" && options.target === "compressed-pdf") {
      return [await compressPdf(file, options)];
    }

    if (category === "image" && options.target === "pdf") {
      return [await imageToPdf(file, options)];
    }

    if (
      category === "image" &&
      (options.target === "jpg" || options.target === "png" || options.target === "webp")
    ) {
      return [await imageToImage(file, options.target, options)];
    }

    if (category === "image" && options.target === "compressed-image") {
      return [await compressImage(file, options)];
    }

    throw new Error("Unsupported conversion request.");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The browser could not complete this conversion.";
    throw new Error(message);
  }
}

async function pdfToImages(
  file: File,
  target: "jpg" | "png" | "webp",
  options: ConversionOptions
): Promise<ConvertedAsset[]> {
  emit(options, "parsing", 8, "Parsing PDF...");

  const pdfjs = await loadPdfJs();
  const sourceBytes = await file.arrayBuffer();
  const documentTask = pdfjs.getDocument({ data: sourceBytes.slice(0) });
  const pdf = await documentTask.promise;
  const assets: ConvertedAsset[] = [];
  const mimeType = getImageMimeType(target);
  const quality = getRasterQuality(target, options.compressionLevel);
  const baseName = stripExtension(file.name);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(1, Math.min(2.25, 2600 / Math.max(baseViewport.width, baseViewport.height)));
    const rendered = await renderPdfPageToBlob(page, scale, mimeType, quality);

    assets.push({
      blob: rendered.blob,
      filename:
        pdf.numPages === 1
          ? `${baseName}.${target}`
          : `${baseName}-page-${String(pageNumber).padStart(3, "0")}.${target}`,
      mimeType,
      sourceName: file.name,
      target
    });

    emit(
      options,
      "converting",
      10 + Math.round((pageNumber / pdf.numPages) * 80),
      `Converting page ${pageNumber} of ${pdf.numPages}...`
    );
  }

  await pdf.destroy();
  emit(options, "completed", 100, "Completed.");

  return assets;
}

async function pdfToDocx(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "parsing", 12, "Parsing PDF text...");

  const pdfjs = await loadPdfJs();
  const sourceBytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: sourceBytes.slice(0) }).promise;
  const blocks: DocumentTextBlock[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageBlocks = textContentToBlocks(content.items);

    if (pageNumber > 1) {
      blocks.push({ text: `Page ${pageNumber}`, kind: "heading3" });
    }

    blocks.push(...pageBlocks);

    emit(
      options,
      "converting",
      16 + Math.round((pageNumber / pdf.numPages) * 58),
      `Extracting page ${pageNumber} of ${pdf.numPages}...`
    );
  }

  await pdf.destroy();

  emit(options, "packaging", 86, "Building DOCX...");
  const blob = await blocksToDocxBlob(blocks.length > 0 ? blocks : fallbackBlocks(file.name));

  emit(options, "completed", 100, "Completed.");

  return {
    blob,
    filename: `${stripExtension(file.name)}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sourceName: file.name,
    target: "docx"
  };
}

async function imageToImage(
  file: File,
  target: "jpg" | "png" | "webp",
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "parsing", 12, "Loading image...");

  const image = await loadImage(file);
  const mimeType = getImageMimeType(target);
  const quality = getRasterQuality(target, options.compressionLevel);

  emit(options, "converting", 56, `Converting to ${target.toUpperCase()}...`);

  const blob = await drawImageToBlob(image, mimeType, quality);
  URL.revokeObjectURL(image.objectUrl);

  emit(options, "completed", 100, "Completed.");

  return {
    blob,
    filename: `${stripExtension(file.name)}.${target}`,
    mimeType,
    sourceName: file.name,
    target
  };
}

async function imageToPdf(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "parsing", 12, "Loading image...");

  const image = await loadImage(file);
  const imageMimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = clamp(1 - options.compressionLevel / 120, 0.35, 0.94);
  const dataUrl = await drawImageToDataUrl(image, imageMimeType, quality);

  emit(options, "converting", 58, "Converting to PDF...");

  const { jsPDF } = await import("jspdf");
  const orientation = image.width >= image.height ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [image.width, image.height],
    compress: true
  });

  pdf.addImage(
    dataUrl,
    imageMimeType === "image/png" ? "PNG" : "JPEG",
    0,
    0,
    image.width,
    image.height,
    undefined,
    "FAST"
  );

  emit(options, "packaging", 88, "Packaging PDF...");

  const blob = pdf.output("blob");
  URL.revokeObjectURL(image.objectUrl);

  emit(options, "completed", 100, "Completed.");

  return {
    blob,
    filename: `${stripExtension(file.name)}.pdf`,
    mimeType: "application/pdf",
    sourceName: file.name,
    target: "pdf"
  };
}

async function compressImage(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "compressing", 16, "Compressing image...");

  if (options.compressionLevel <= 0) {
    emit(options, "completed", 100, "Completed.");
    return {
      blob: file,
      filename: `${stripExtension(file.name)}-compressed.${normalizeImageExtension(file)}`,
      mimeType: file.type,
      sourceName: file.name,
      target: "compressed-image"
    };
  }

  const imageCompression = (await import("browser-image-compression")).default;
  const targetRatio = clamp(1 - options.compressionLevel / 100, 0.1, 1);
  const originalMb = Math.max(file.size / 1024 / 1024, 0.1);
  const maxWidthOrHeight = Math.round(4096 - options.compressionLevel * 26);
  const compressed = await imageCompression(file, {
    alwaysKeepResolution: options.compressionLevel < 35,
    fileType: file.type || "image/jpeg",
    initialQuality: clamp(targetRatio, 0.1, 0.92),
    maxSizeMB: Math.max(originalMb * targetRatio, 0.08),
    maxWidthOrHeight: Math.max(1280, maxWidthOrHeight),
    useWebWorker: true
  });

  emit(options, "completed", 100, "Completed.");

  const output = compressed.size <= file.size ? compressed : file;
  const extension = normalizeImageExtension(output);

  return {
    blob: output,
    filename: `${stripExtension(file.name)}-compressed.${extension}`,
    mimeType: output.type || file.type,
    sourceName: file.name,
    target: "compressed-image"
  };
}

async function compressPdf(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "parsing", 10, "Parsing PDF...");

  if (options.compressionLevel <= 0) {
    emit(options, "completed", 100, "Completed.");
    return {
      blob: file,
      filename:
        options.target === "pdf"
          ? `${stripExtension(file.name)}.pdf`
          : `${stripExtension(file.name)}-compressed.pdf`,
      mimeType: "application/pdf",
      sourceName: file.name,
      target: options.target
    };
  }

  const pdfjs = await loadPdfJs();
  const { PDFDocument } = await import("pdf-lib");
  const sourceBytes = await file.arrayBuffer();
  const source = await pdfjs.getDocument({ data: sourceBytes.slice(0) }).promise;
  const output = await PDFDocument.create();
  const rasterScale = clamp(1.85 - options.compressionLevel / 64, 0.48, 1.85);
  const jpegQuality = clamp(0.92 - options.compressionLevel / 145, 0.3, 0.92);

  for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
    const page = await source.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const rendered = await renderPdfPageToBlob(page, rasterScale, "image/jpeg", jpegQuality);
    const bytes = await rendered.blob.arrayBuffer();
    const embedded = await output.embedJpg(bytes);
    const outPage = output.addPage([viewport.width, viewport.height]);

    outPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height
    });

    emit(
      options,
      "compressing",
      12 + Math.round((pageNumber / source.numPages) * 76),
      `Compressing page ${pageNumber} of ${source.numPages}...`
    );
  }

  await source.destroy();

  emit(options, "packaging", 92, "Packaging PDF...");

  const rasterizedBytes = await output.save({ useObjectStreams: true });
  const rasterizedBlob = new Blob([toArrayBuffer(rasterizedBytes)], {
    type: "application/pdf"
  });
  const sourceBlob = new Blob([sourceBytes], { type: "application/pdf" });
  const blob = rasterizedBlob.size < sourceBlob.size ? rasterizedBlob : sourceBlob;

  emit(options, "completed", 100, "Completed.");

  return {
    blob,
    filename: `${stripExtension(file.name)}-compressed.pdf`,
    mimeType: "application/pdf",
    sourceName: file.name,
    target: options.target
  };
}

async function blocksToDocxBlob(blocks: DocumentTextBlock[]): Promise<Blob> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");

  const children = blocks.map((block) => {
    const heading =
      block.kind === "heading1"
        ? HeadingLevel.HEADING_1
        : block.kind === "heading2"
          ? HeadingLevel.HEADING_2
          : block.kind === "heading3"
            ? HeadingLevel.HEADING_3
            : undefined;

    return new Paragraph({
      heading,
      spacing: {
        after: block.kind.startsWith("heading") ? 180 : 120
      },
      children: [
        new TextRun({
          text: block.text,
          bold: block.kind.startsWith("heading"),
          size:
            block.kind === "heading1"
              ? 32
              : block.kind === "heading2"
                ? 28
                : block.kind === "heading3"
                  ? 24
                  : 22
        })
      ]
    });
  });

  const doc = new Document({
    creator: "Private File Converter",
    description: "Generated locally in the browser.",
    title: "Converted document",
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBlob(doc);
}

async function renderPdfPageToBlob(
  page: PdfPageProxy,
  scale: number,
  mimeType: string,
  quality: number
) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  const blob = await canvasToBlob(canvas, mimeType, quality);
  canvas.width = 0;
  canvas.height = 0;

  return { blob, width: viewport.width, height: viewport.height };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

async function loadImage(file: File): Promise<{
  image: HTMLImageElement;
  width: number;
  height: number;
  objectUrl: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;

  try {
    await image.decode();
  } catch {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The image could not be decoded."));
    });
  }

  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    objectUrl
  };
}

async function drawImageToDataUrl(
  source: { image: HTMLImageElement; width: number; height: number },
  mimeType: string,
  quality: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d", { alpha: mimeType === "image/png" });

  if (!context) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  if (mimeType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(source.image, 0, 0, source.width, source.height);
  const dataUrl = canvas.toDataURL(mimeType, quality);
  canvas.width = 0;
  canvas.height = 0;

  return dataUrl;
}

async function drawImageToBlob(
  source: { image: HTMLImageElement; width: number; height: number },
  mimeType: string,
  quality: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d", { alpha: mimeType !== "image/jpeg" });

  if (!context) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  if (mimeType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(source.image, 0, 0, source.width, source.height);
  const blob = await canvasToBlob(canvas, mimeType, quality);
  canvas.width = 0;
  canvas.height = 0;

  return blob;
}

function getImageMimeType(target: "jpg" | "png" | "webp") {
  if (target === "png") {
    return "image/png";
  }

  if (target === "webp") {
    return "image/webp";
  }

  return "image/jpeg";
}

function getRasterQuality(target: "jpg" | "png" | "webp", compressionLevel: number) {
  if (target === "png") {
    return 1;
  }

  return clamp(0.94 - compressionLevel / 120, 0.18, 0.94);
}

function textContentToBlocks(items: unknown[]): DocumentTextBlock[] {
  const textItems = items
    .map((item) => item as { str?: string; transform?: number[] })
    .filter((item) => item.str && item.str.trim().length > 0);

  if (textItems.length === 0) {
    return [];
  }

  const rows = new Map<number, { x: number; text: string }[]>();

  textItems.forEach((item) => {
    const transform = item.transform ?? [0, 0, 0, 0, 0, 0];
    const y = Math.round(transform[5] ?? 0);
    const x = transform[4] ?? 0;
    const text = normalizeWhitespace(item.str ?? "");

    if (!rows.has(y)) {
      rows.set(y, []);
    }

    rows.get(y)?.push({ x, text });
  });

  return Array.from(rows.entries())
    .sort(([a], [b]) => b - a)
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
    )
    .map((text) => normalizeWhitespace(text))
    .filter(Boolean)
    .map((text) => ({ text, kind: "paragraph" }));
}

function rawTextToBlocks(text: string): DocumentTextBlock[] {
  return text
    .split(/\n{1,}/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .map((line) => ({ text: line, kind: "paragraph" }));
}

function fallbackBlocks(fileName: string): DocumentTextBlock[] {
  return [
    {
      text: stripExtension(fileName),
      kind: "heading1"
    },
    {
      text: "No extractable text was found in the source file.",
      kind: "paragraph"
    }
  ];
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("The browser could not create the output file."));
      },
      mimeType,
      quality
    );
  });
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/-+$/, "") || "converted";
}

function getExtension(fileName: string) {
  const extension = fileName.split(".").pop();
  return extension ? extension.toLowerCase() : "";
}

function normalizeImageExtension(file: Blob | File) {
  if (file.type === "image/jpeg") {
    return "jpg";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  if (file.type === "image/png") {
    return "png";
  }

  return "jpg";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function emit(
  options: ConversionOptions,
  stage: ConversionStage,
  percent: number,
  label: string
) {
  options.onProgress?.({
    stage,
    percent: clamp(percent, 0, 100),
    label
  });
}

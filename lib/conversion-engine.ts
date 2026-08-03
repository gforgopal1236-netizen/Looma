import {
  assertFileSafetyResultForFile,
  formatBytes,
  getFileCategory,
  type FileCategory,
  type SupportedInputKind,
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
  SupportedInputKind,
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

const TARGETS: Record<ConversionTarget, TargetOption> = {
  jpg: { value: "jpg", label: "JPG images", extension: "jpg" },
  png: { value: "png", label: "PNG images", extension: "png" },
  webp: { value: "webp", label: "WEBP image", extension: "webp" },
  pdf: { value: "pdf", label: "PDF document", extension: "pdf" },
  docx: { value: "docx", label: "Word document", extension: "docx" },
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

export const GENERAL_METADATA_WARNING =
  "Image metadata and color profiles may not be preserved.";

export const CONVERSION_WARNING_MESSAGES = {
  pdfCompressionRasterizes:
    "Compression may rasterize pages, which can reduce text and vector sharpness.",
  pdfImageExport:
    "The output is a visual image export and will not contain editable text.",
  transparencyReplaced:
    "Transparent areas will be replaced with a white background.",
  sameFormatReencode:
    "This re-encodes the file for compression and may reduce quality."
} as const;

export function getTargetOption(target: ConversionTarget) {
  return TARGETS[target];
}

export function getSupportedTargets(file: File): TargetOption[] {
  return getSupportedTargetsForCategory(getFileCategory(file));
}

export function getSupportedTargetsForCategory(category: FileCategory): TargetOption[] {
  switch (category) {
    case "pdf":
      return [TARGETS.docx, TARGETS.pdf, TARGETS.jpg, TARGETS.png, TARGETS.webp];
    case "docx":
      return [TARGETS.pdf];
    case "image":
      return [TARGETS.pdf, TARGETS.jpg, TARGETS.png, TARGETS.webp];
    default:
      return [];
  }
}

export function supportsCompression(
  inputKind: SupportedInputKind,
  target: ConversionTarget
) {
  if (target === "compressed-pdf") {
    return inputKind === "pdf";
  }

  if (target === "compressed-image") {
    return inputKind === "jpg" || inputKind === "png" || inputKind === "webp";
  }

  if (inputKind === "pdf") {
    return target === "pdf" || target === "jpg" || target === "webp";
  }

  if (inputKind === "jpg") {
    return target === "pdf" || target === "jpg" || target === "webp";
  }

  if (inputKind === "png") {
    return target === "jpg" || target === "webp";
  }

  if (inputKind === "webp") {
    return target === "pdf" || target === "jpg" || target === "webp";
  }

  return false;
}

export function warnsAboutTransparencyReplacement(
  inputKind: SupportedInputKind,
  target: ConversionTarget
) {
  return (inputKind === "png" || inputKind === "webp") && (target === "jpg" || target === "pdf");
}

export function isSameFormatReencode(
  inputKind: SupportedInputKind,
  target: ConversionTarget
) {
  return (inputKind === "jpg" && target === "jpg") || (inputKind === "webp" && target === "webp");
}

export function getConversionWarnings({
  inputKind,
  target,
  compressionLevel
}: {
  inputKind: SupportedInputKind;
  target: ConversionTarget;
  compressionLevel: number;
}) {
  const warnings: string[] = [];

  if (
    inputKind === "pdf" &&
    (target === "pdf" || target === "compressed-pdf") &&
    compressionLevel > 0
  ) {
    warnings.push(CONVERSION_WARNING_MESSAGES.pdfCompressionRasterizes);
  }

  if (
    inputKind === "pdf" &&
    (target === "jpg" || target === "png" || target === "webp")
  ) {
    warnings.push(CONVERSION_WARNING_MESSAGES.pdfImageExport);
  }

  if (warnsAboutTransparencyReplacement(inputKind, target)) {
    warnings.push(CONVERSION_WARNING_MESSAGES.transparencyReplaced);
  }

  if (isSameFormatReencode(inputKind, target)) {
    warnings.push(CONVERSION_WARNING_MESSAGES.sameFormatReencode);
  }

  return warnings;
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

  const effectiveOptions = supportsCompression(fileSafety.input.kind, options.target)
    ? options
    : { ...options, compressionLevel: 0 };

  emit(effectiveOptions, "queued", 1, "Queued...");

  try {
    const category = fileSafety.input.category;
    if (
  (category === "docx" && effectiveOptions.target === "pdf") ||
  (category === "pdf" && effectiveOptions.target === "docx")
) {
  return [await convertDocumentWithCloudConvert(file, effectiveOptions)];
}

    if (category === "pdf" && effectiveOptions.target === "pdf") {
      return [await compressPdf(file, effectiveOptions)];
    }

    if (
      category === "pdf" &&
      (effectiveOptions.target === "jpg" ||
        effectiveOptions.target === "png" ||
        effectiveOptions.target === "webp")
    ) {
      return await pdfToImages(file, effectiveOptions.target, effectiveOptions);
    }

    if (category === "pdf" && effectiveOptions.target === "compressed-pdf") {
      return [await compressPdf(file, effectiveOptions)];
    }

    if (category === "image" && effectiveOptions.target === "pdf") {
      return [await imageToPdf(file, effectiveOptions)];
    }

    if (
      category === "image" &&
      (effectiveOptions.target === "jpg" ||
        effectiveOptions.target === "png" ||
        effectiveOptions.target === "webp")
    ) {
      return [await imageToImage(file, effectiveOptions.target, effectiveOptions)];
    }

    if (category === "image" && effectiveOptions.target === "compressed-image") {
      return [await compressImage(file, effectiveOptions)];
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
  const imageMimeType =
    options.fileSafety.input.kind === "png" ? "image/png" : "image/jpeg";
  const quality = clamp(1 - options.compressionLevel / 120, 0.35, 0.94);
  const dataUrl = await drawImageToDataUrl(image, imageMimeType, quality, {
    replaceTransparencyWithWhite: options.fileSafety.input.kind === "png"
  });

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
  quality: number,
  options: { replaceTransparencyWithWhite?: boolean } = {}
) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;

  const context = canvas.getContext("2d", {
    alpha: mimeType === "image/png" && !options.replaceTransparencyWithWhite
  });

  if (!context) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  if (mimeType === "image/jpeg" || options.replaceTransparencyWithWhite) {
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
async function convertDocumentWithCloudConvert(
  file: File,
  options: ConversionOptions
): Promise<ConvertedAsset> {
  emit(options, "converting", 20, "Uploading document...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("target", options.target);

  const response = await fetch("/api/convert", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    let message = "Document conversion failed.";

    try {
      const result = (await response.json()) as { error?: string };
      message = result.error ?? message;
    } catch {
      // Keep the default message.
    }

    throw new Error(message);
  }

  emit(options, "packaging", 90, "Preparing download...");

  const blob = await response.blob();
  const extension = options.target === "docx" ? "docx" : "pdf";
  const mimeType =
    options.target === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";

  emit(options, "completed", 100, "Completed.");

  return {
    blob,
    filename: `${stripExtension(file.name)}.${extension}`,
    mimeType,
    sourceName: file.name,
    target: options.target
  };
}
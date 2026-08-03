export type FileCategory = "pdf" | "docx" | "image" | "unknown";

export type SupportedInputKind = "pdf" | "docx" | "jpg" | "png" | "webp";

type DeclaredInputKind = SupportedInputKind;

export interface FileIdentity {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface SuccessfulFileSafetyResult {
  ok: true;
  file: File;
  identity: FileIdentity;
  input: {
    kind: SupportedInputKind;
    category: "pdf" | "docx" | "image";
    label: string;
  };
  limits: typeof BETA_FILE_SAFETY_LIMITS;
  pdf?: {
    pageCount: number;
  };
  image?: {
    width: number;
    height: number;
    megapixels: number;
  };
}

export interface FailedFileSafetyResult {
  ok: false;
  file: File;
  identity: FileIdentity;
  code: FileSafetyErrorCode;
  message: string;
}

export type FileSafetyResult = SuccessfulFileSafetyResult | FailedFileSafetyResult;

export const FILE_SAFETY_ERROR_CODES = {
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  WORD_CONVERSION_UNAVAILABLE: "WORD_CONVERSION_UNAVAILABLE",
  EMPTY_FILE: "EMPTY_FILE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  INVALID_FILE_SIGNATURE: "INVALID_FILE_SIGNATURE",
  PDF_CORRUPT: "PDF_CORRUPT",
  PDF_ENCRYPTED: "PDF_ENCRYPTED",
  PDF_PAGE_LIMIT: "PDF_PAGE_LIMIT",
  IMAGE_DIMENSIONS_UNREADABLE: "IMAGE_DIMENSIONS_UNREADABLE",
  IMAGE_DIMENSION_LIMIT: "IMAGE_DIMENSION_LIMIT",
  IMAGE_MEGAPIXEL_LIMIT: "IMAGE_MEGAPIXEL_LIMIT"
} as const;

export type FileSafetyErrorCode =
  (typeof FILE_SAFETY_ERROR_CODES)[keyof typeof FILE_SAFETY_ERROR_CODES];

const MB = 1024 * 1024;
const IMAGE_HEADER_BYTES = 512 * 1024;
const PDF_SIGNATURE_BYTES = 1024;

export const BETA_FILE_SAFETY_LIMITS = {
  pdf: {
    maxBytes: 25 * MB,
    maxPages: 100
    // PDF-to-image and raster compression paths may need lower target-specific
    // page limits after private-beta performance testing.
  },
  jpg: {
    maxBytes: 20 * MB,
    maxMegapixels: 40,
    maxDimensionPixels: 12000
  },
  png: {
    maxBytes: 15 * MB,
    maxMegapixels: 40,
    maxDimensionPixels: 12000
  },
  webp: {
    maxBytes: 15 * MB,
    maxMegapixels: 40,
    maxDimensionPixels: 12000
  }
} as const;

export const ACCEPTED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ['.docx'],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"]
};

export const WORD_CONVERSION_PRIVATE_BETA_MESSAGE =
  "High-fidelity Word conversion is not available in Looma’s private beta. Please export the document as PDF in Microsoft Word, Google Docs, or LibreOffice, then upload the PDF to Looma.";

export function getFileIdentity(file: File): FileIdentity {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified
  };
}

export function isFileSafetyResultForFile(
  file: File,
  result: SuccessfulFileSafetyResult | null | undefined
): result is SuccessfulFileSafetyResult {
  if (!result?.ok) {
    return false;
  }

  const identity = getFileIdentity(file);

  return (
    result.file === file &&
    result.identity.name === identity.name &&
    result.identity.size === identity.size &&
    result.identity.type === identity.type &&
    result.identity.lastModified === identity.lastModified
  );
}

export function assertFileSafetyResultForFile(
  file: File,
  result: SuccessfulFileSafetyResult | null | undefined
) {
  if (!isFileSafetyResultForFile(file, result)) {
    throw new Error(
      "Please upload this file again so Looma can verify it before conversion."
    );
  }

  return result;
}

export function getFileCategory(file: Pick<File, "name" | "type">): FileCategory {
  const kind = getDeclaredInputKind(file);

  if (kind === "pdf") {
    return "pdf";
  }

  if (kind === "docx") {
    return "docx";
  }

  if (kind === "jpg" || kind === "png" || kind === "webp") {
    return "image";
  }

  return "unknown";
}

export async function validateInputFile(file: File) {
  const result = await validateFileSafety(file);

  return result.ok ? null : result.message;
}

export async function validateFileSafety(file: File): Promise<FileSafetyResult> {
  const identity = getFileIdentity(file);

  if (file.size <= 0) {
    return fail(file, FILE_SAFETY_ERROR_CODES.EMPTY_FILE, `${file.name} appears to be empty.`);
  }

  const header = await readFileHeader(file, IMAGE_HEADER_BYTES);
  const signature = detectFileSignature(header);
  const declaredKind = getDeclaredInputKind(file);

  if (signature === "pdf") {
    return validatePdfSafety(file, identity, header);
  }

  if (signature === "jpg" || signature === "png" || signature === "webp") {
    return validateImageSafety(file, identity, signature, header);
  }

  if (declaredKind === "docx") {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.WORD_CONVERSION_UNAVAILABLE,
      WORD_CONVERSION_PRIVATE_BETA_MESSAGE
    );
  }

  if (declaredKind === "pdf") {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.INVALID_FILE_SIGNATURE,
      `${file.name} does not appear to be a valid PDF file.`
    );
  }

  if (
    declaredKind === "jpg" ||
    declaredKind === "png" ||
    declaredKind === "webp"
  ) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.INVALID_FILE_SIGNATURE,
      `${file.name} does not appear to be a valid ${getKindLabel(declaredKind)} file.`
    );
  }

  return fail(
    file,
    FILE_SAFETY_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    "Supported formats are PDF, JPG, PNG, and WEBP."
  );
}

export function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** unitIndex;

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function validatePdfSafety(
  file: File,
  identity: FileIdentity,
  header: Uint8Array
): Promise<FileSafetyResult> {
  if (!hasPdfSignature(header)) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.INVALID_FILE_SIGNATURE,
      `${file.name} does not appear to be a valid PDF file.`
    );
  }

  const limits = BETA_FILE_SAFETY_LIMITS.pdf;

  if (file.size > limits.maxBytes) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.FILE_TOO_LARGE,
      `${file.name} is ${formatBytes(file.size)}. For private beta, PDF files must be ${formatBytes(
        limits.maxBytes
      )} or smaller so Looma can keep your browser responsive.`
    );
  }

  try {
    const pdfjs = await loadPdfJs();
    const bytes = await file.arrayBuffer();
    const documentOptions = {
      data: copyArrayBuffer(bytes),
      disableWorker: typeof window === "undefined",
      stopAtErrors: true
    } as unknown as Parameters<typeof pdfjs.getDocument>[0];
    const documentTask = pdfjs.getDocument(documentOptions);
    const pdf = await documentTask.promise;

    try {
      if (pdf.numPages > limits.maxPages) {
        return fail(
          file,
          FILE_SAFETY_ERROR_CODES.PDF_PAGE_LIMIT,
          `${file.name} has ${pdf.numPages} pages. For private beta, PDFs must be ${limits.maxPages} pages or fewer so Looma can keep your browser responsive.`
        );
      }

      return {
        ok: true,
        file,
        identity,
        input: {
          kind: "pdf",
          category: "pdf",
          label: "PDF"
        },
        limits: BETA_FILE_SAFETY_LIMITS,
        pdf: {
          pageCount: pdf.numPages
        }
      };
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    if (isPdfPasswordError(error)) {
      return fail(
        file,
        FILE_SAFETY_ERROR_CODES.PDF_ENCRYPTED,
        `${file.name} appears to be password-protected. Looma cannot convert encrypted PDFs in private beta.`
      );
    }

    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.PDF_CORRUPT,
      `${file.name} could not be read as a PDF. It may be corrupt or incomplete.`
    );
  }
}

function validateImageSafety(
  file: File,
  identity: FileIdentity,
  kind: "jpg" | "png" | "webp",
  header: Uint8Array
): FileSafetyResult {
  const dimensions = readImageDimensions(kind, header);
  const label = getKindLabel(kind);

  if (!dimensions) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.IMAGE_DIMENSIONS_UNREADABLE,
      `${file.name} looks like a ${label} file, but Looma could not safely read its dimensions. The file may be corrupt.`
    );
  }

  const limits = BETA_FILE_SAFETY_LIMITS[kind];
  const megapixels = (dimensions.width * dimensions.height) / 1_000_000;

  if (
    dimensions.width > limits.maxDimensionPixels ||
    dimensions.height > limits.maxDimensionPixels
  ) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.IMAGE_DIMENSION_LIMIT,
      `${file.name} is ${dimensions.width} x ${dimensions.height}px. For private beta, ${label} images must be no wider or taller than ${limits.maxDimensionPixels}px.`
    );
  }

  if (megapixels > limits.maxMegapixels) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.IMAGE_MEGAPIXEL_LIMIT,
      `${file.name} is ${formatMegapixels(megapixels)} megapixels (${dimensions.width} x ${dimensions.height}px). For private beta, ${label} images must be ${limits.maxMegapixels} megapixels or smaller.`
    );
  }

  if (file.size > limits.maxBytes) {
    return fail(
      file,
      FILE_SAFETY_ERROR_CODES.FILE_TOO_LARGE,
      `${file.name} is ${formatBytes(file.size)}. For private beta, ${label} images must be ${formatBytes(
        limits.maxBytes
      )} or smaller.`
    );
  }

  return {
    ok: true,
    file,
    identity,
    input: {
      kind,
      category: "image",
      label
    },
    limits: BETA_FILE_SAFETY_LIMITS,
    image: {
      width: dimensions.width,
      height: dimensions.height,
      megapixels
    }
  };
}

type FileSignature = "pdf" | "jpg" | "png" | "webp" | "zip" | null;

function detectFileSignature(bytes: Uint8Array): FileSignature {
  if (hasPdfSignature(bytes)) {
    return "pdf";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }

  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  ) {
    return "zip";
  }

  return null;
}

function hasPdfSignature(bytes: Uint8Array) {
  return readAscii(bytes, 0, Math.min(bytes.length, PDF_SIGNATURE_BYTES)).includes(
    "%PDF-"
  );
}

function getDeclaredInputKind(
  file: Pick<File, "name" | "type">
): DeclaredInputKind | null {
  const extension = getExtension(file.name);
  const mimeType = file.type.toLowerCase();

  if (mimeType === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "docx";
  }

  if (mimeType === "image/jpeg" || extension === "jpg" || extension === "jpeg") {
    return "jpg";
  }

  if (mimeType === "image/png" || extension === "png") {
    return "png";
  }

  if (mimeType === "image/webp" || extension === "webp") {
    return "webp";
  }

  return null;
}

function readImageDimensions(
  kind: "jpg" | "png" | "webp",
  bytes: Uint8Array
) {
  if (kind === "jpg") {
    return readJpegDimensions(bytes);
  }

  if (kind === "png") {
    return readPngDimensions(bytes);
  }

  return readWebpDimensions(bytes);
}

function readPngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || readAscii(bytes, 12, 4) !== "IHDR") {
    return null;
  }

  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20)
  };
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;

  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      break;
    }

    const segmentLength = readUint16BE(bytes, offset);

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (isJpegStartOfFrame(marker) && offset + 7 <= bytes.length) {
      return {
        height: readUint16BE(bytes, offset + 3),
        width: readUint16BE(bytes, offset + 5)
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array) {
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkType = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const payloadOffset = offset + 8;

    if (payloadOffset + chunkSize > bytes.length) {
      return null;
    }

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: readUint24LE(bytes, payloadOffset + 4) + 1,
        height: readUint24LE(bytes, payloadOffset + 7) + 1
      };
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[payloadOffset] === 0x2f) {
      const b1 = bytes[payloadOffset + 1];
      const b2 = bytes[payloadOffset + 2];
      const b3 = bytes[payloadOffset + 3];
      const b4 = bytes[payloadOffset + 4];

      return {
        width: ((b2 & 0x3f) << 8) + b1 + 1,
        height: ((b4 & 0x0f) << 10) + (b3 << 2) + ((b2 & 0xc0) >> 6) + 1
      };
    }

    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      bytes[payloadOffset + 3] === 0x9d &&
      bytes[payloadOffset + 4] === 0x01 &&
      bytes[payloadOffset + 5] === 0x2a
    ) {
      return {
        width: readUint16LE(bytes, payloadOffset + 6) & 0x3fff,
        height: readUint16LE(bytes, payloadOffset + 8) & 0x3fff
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

async function readFileHeader(file: File, bytes: number) {
  const buffer = await file.slice(0, Math.min(file.size, bytes)).arrayBuffer();

  return new Uint8Array(buffer);
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");

  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  return pdfjs;
}

function fail(
  file: File,
  code: FileSafetyErrorCode,
  message: string
): FailedFileSafetyResult {
  return {
    ok: false,
    file,
    identity: getFileIdentity(file),
    code,
    message
  };
}

function isPdfPasswordError(error: unknown) {
  const candidate = error as { name?: string; message?: string };

  return (
    candidate.name === "PasswordException" ||
    /password|encrypted/i.test(candidate.message ?? "")
  );
}

function isJpegStartOfFrame(marker: number) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function getKindLabel(kind: DeclaredInputKind) {
  if (kind === "jpg") {
    return "JPG/JPEG";
  }

  return kind.toUpperCase();
}

function formatMegapixels(megapixels: number) {
  return megapixels.toFixed(megapixels >= 10 ? 1 : 2);
}

function readAscii(bytes: Uint8Array, start: number, length: number) {
  let value = "";

  for (let index = start; index < start + length && index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }

  return value;
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function copyArrayBuffer(buffer: ArrayBuffer) {
  const source = new Uint8Array(buffer);
  const copy = new Uint8Array(source.byteLength);

  copy.set(source);

  return copy.buffer;
}

function getExtension(fileName: string) {
  const extension = fileName.split(".").pop();
  return extension ? extension.toLowerCase() : "";
}

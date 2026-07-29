import type { ConvertedAsset } from "@/lib/conversion-engine";

export interface DownloadableAsset {
  blob: Blob;
  filename: string;
}

export async function downloadConvertedAssets(
  assets: ConvertedAsset[],
  archiveName = "converted-files.zip"
) {
  if (assets.length === 0) {
    return;
  }

  if (assets.length === 1) {
    downloadBlob(assets[0].blob, assets[0].filename);
    return;
  }

  const zipBlob = await packageAssetsAsZip(assets, archiveName);
  downloadBlob(zipBlob, archiveName);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export async function packageAssetsAsZip(
  assets: DownloadableAsset[],
  archiveName = "converted-files.zip"
) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  assets.forEach((asset) => {
    zip.file(uniqueArchiveName(asset.filename, usedNames), asset.blob);
  });

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: {
      level: 6
    },
    comment: archiveName
  });

  return blob;
}

export async function gzipBlob(asset: DownloadableAsset) {
  const pako = await import("pako");
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  const compressed = pako.gzip(bytes);

  return {
    blob: new Blob([compressed], { type: "application/gzip" }),
    filename: `${asset.filename}.gz`
  };
}

function uniqueArchiveName(filename: string, usedNames: Map<string, number>) {
  const normalized = filename.replace(/^\/+/, "") || "converted-file";
  const count = usedNames.get(normalized) ?? 0;

  usedNames.set(normalized, count + 1);

  if (count === 0) {
    return normalized;
  }

  const dotIndex = normalized.lastIndexOf(".");

  if (dotIndex === -1) {
    return `${normalized}-${count + 1}`;
  }

  return `${normalized.slice(0, dotIndex)}-${count + 1}${normalized.slice(dotIndex)}`;
}

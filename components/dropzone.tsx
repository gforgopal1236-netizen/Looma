"use client";

import * as React from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  FileArchive,
  FileImage,
  FileText,
  FileType,
  UploadCloud,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { motion } from "framer-motion";

import {
  formatBytes,
  getFileCategory
} from "@/lib/file-safety";
import { cn } from "@/lib/utils";

interface ConverterDropzoneProps {
  onFilesAccepted: (files: File[]) => void;
  selectedFile?: File | null;
  disabled?: boolean;
  className?: string;
  multiple?: boolean;
  validationMessage?: string | null;
}

interface FileVisual {
  label: string;
  Icon: LucideIcon;
  className: string;
}

export function ConverterDropzone({
  onFilesAccepted,
  selectedFile = null,
  disabled = false,
  className,
  multiple = true,
  validationMessage = null
}: ConverterDropzoneProps) {
  const [message, setMessage] = React.useState<string | null>(null);
  const displayedMessage = validationMessage ?? message;

  const onDrop = React.useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (rejectedFiles.length > 0) {
        setMessage(buildRejectionMessage(rejectedFiles));
      } else {
        setMessage(null);
      }

      if (acceptedFiles.length > 0) {
        onFilesAccepted(multiple ? acceptedFiles : acceptedFiles.slice(0, 1));
      }
    },
    [multiple, onFilesAccepted]
  );

  const {
    getRootProps,
    getInputProps,
    isDragAccept,
    isDragActive,
    isDragReject,
    open
  } = useDropzone({
    disabled,
    multiple,
    noClick: true,
    onDrop
  });

  const activeVisual = isDragReject
    ? rejectedVisual
    : isDragAccept
      ? acceptedVisual
      : neutralVisual;

  return (
    <motion.div
      animate={{ scale: isDragActive ? 1.01 : 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={className}
    >
      <div
        {...getRootProps({
          className: cn(
            "group relative flex min-h-[190px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-card px-5 py-7 text-center transition-colors",
            "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
            isDragAccept && "border-primary bg-primary/5",
            isDragReject && "border-destructive bg-destructive/5",
            disabled && "cursor-not-allowed opacity-60"
          )
        })}
      >
        <input {...getInputProps()} aria-label="Upload files" />
        <div
          className={cn(
            "mb-5 flex h-16 w-16 items-center justify-center rounded-full border",
            activeVisual.className
          )}
        >
          <activeVisual.Icon className="h-8 w-8" aria-hidden="true" />
        </div>

        <div className="max-w-xl space-y-3">
          <div className="space-y-1">
            <p className="text-xl font-semibold tracking-normal sm:text-2xl">
              {selectedFile ? "File selected" : "Drop file here"}
            </p>
            <p className="text-sm text-muted-foreground">
              PDF, JPG, PNG, WEBP
            </p>
            <p className="text-xs text-muted-foreground">
              High-fidelity Word conversion is coming soon.
            </p>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
            disabled={disabled}
            className="touch-target inline-flex items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
            Select File
          </button>
        </div>

        {selectedFile ? (
          <div className="mt-5 flex w-full max-w-md items-center gap-3 rounded-md border bg-background p-3 text-left">
            <FileBadgeIcon file={selectedFile} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(selectedFile.size)}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {displayedMessage ? (
        <div
          role="alert"
          aria-live="polite"
          aria-atomic="true"
          className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{displayedMessage}</p>
        </div>
      ) : null}
    </motion.div>
  );
}

export function FileBadgeIcon({ file }: { file: File }) {
  const visual = getFileVisual(file.name, file.type);

  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border",
        visual.className
      )}
      title={visual.label}
    >
      <visual.Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

export function getFileVisual(nameOrExtension: string, mimeType = ""): FileVisual {
  const extension = nameOrExtension.includes(".")
    ? nameOrExtension.split(".").pop()?.toLowerCase() ?? ""
    : nameOrExtension.toLowerCase();

  if (mimeType === "application/pdf" || extension === "pdf") {
    return {
      label: "PDF",
      Icon: FileText,
      className: "border-rose-200 bg-rose-50 text-rose-700"
    };
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return {
      label: "DOCX",
      Icon: FileType,
      className: "border-sky-200 bg-sky-50 text-sky-700"
    };
  }

  if (
    mimeType.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp"].includes(extension) ||
    getFileCategory({ name: nameOrExtension, type: mimeType } as File) === "image"
  ) {
    return {
      label: extension === "jpeg" ? "JPG" : extension.toUpperCase(),
      Icon: FileImage,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700"
    };
  }

  return {
    label: extension ? extension.toUpperCase() : "FILE",
    Icon: FileArchive,
    className: "border-zinc-200 bg-zinc-50 text-zinc-700"
  };
}

function buildRejectionMessage(rejections: FileRejection[]) {
  const first = rejections[0];
  const fileName = first.file.name;
  const error = first.errors[0];

  if (error?.message) {
    return `${fileName}: ${error.message}`;
  }

  return `${fileName} cannot be added.`;
}

const neutralVisual: FileVisual = {
  label: "Upload",
  Icon: UploadCloud,
  className: "border-border bg-background text-muted-foreground"
};

const acceptedVisual: FileVisual = {
  label: "Accepted",
  Icon: FileArchive,
  className: "border-primary/30 bg-primary/10 text-primary"
};

const rejectedVisual: FileVisual = {
  label: "Rejected",
  Icon: XCircle,
  className: "border-destructive/30 bg-destructive/10 text-destructive"
};

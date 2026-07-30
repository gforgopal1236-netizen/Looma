"use client";

import * as React from "react";
import { CheckCircle2, Download, Loader2, RotateCcw } from "lucide-react";

import { ConverterDropzone } from "@/components/dropzone";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  convertFile,
  formatBytes,
  getSupportedTargetsForCategory,
  isSameFormatReencode,
  supportsCompression,
  warnsAboutTransparencyReplacement,
  type ConvertedAsset,
  type ConversionProgress,
  type ConversionTarget
} from "@/lib/conversion-engine";
import { downloadConvertedAssets } from "@/lib/download-handler";
import {
  isFileSafetyResultForFile,
  validateFileSafety,
  type SuccessfulFileSafetyResult
} from "@/lib/file-safety";
import { cn } from "@/lib/utils";

type ConverterStatus = "idle" | "processing" | "completed" | "error";

const FORMAT_OPTIONS: Array<{ value: ConversionTarget; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "jpg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WEBP" }
];

export function Converter() {
  const [file, setFile] = React.useState<File | null>(null);
  const [target, setTarget] = React.useState<ConversionTarget | null>(null);
  const [compressionLevel, setCompressionLevel] = React.useState(0);
  const [status, setStatus] = React.useState<ConverterStatus>("idle");
  const [progress, setProgress] = React.useState(0);
  const [stageLabel, setStageLabel] = React.useState("Waiting for a file.");
  const [error, setError] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [formatMessage, setFormatMessage] = React.useState<string | null>(null);
  const [fileSafety, setFileSafety] =
    React.useState<SuccessfulFileSafetyResult | null>(null);
  const [completedAssets, setCompletedAssets] = React.useState<ConvertedAsset[]>([]);
  const fileValidationRunId = React.useRef(0);
  const conversionRunId = React.useRef(0);

  const supportedTargets = React.useMemo(
    () => (fileSafety ? getSupportedTargetsForCategory(fileSafety.input.category) : []),
    [fileSafety]
  );
  const supportedTargetValues = React.useMemo(
    () => new Set(supportedTargets.map((option) => option.value)),
    [supportedTargets]
  );
  const hasValidatedFile = Boolean(
    file && fileSafety && isFileSafetyResultForFile(file, fileSafety)
  );
  const canConvert = Boolean(
    hasValidatedFile && target && supportedTargetValues.has(target) && status !== "processing"
  );
  const hasSupportedSelectedConversion = Boolean(
    fileSafety && target && supportedTargetValues.has(target)
  );
  const compressionAvailable = Boolean(
    fileSafety &&
      target &&
      supportedTargetValues.has(target) &&
      supportsCompression(fileSafety.input.kind, target)
  );
  const compressionUnavailable = Boolean(
    hasSupportedSelectedConversion && !compressionAvailable
  );
  const sameFormatReencode = Boolean(
    fileSafety && target && isSameFormatReencode(fileSafety.input.kind, target)
  );
  const showTransparencyWarning = Boolean(
    fileSafety && target && warnsAboutTransparencyReplacement(fileSafety.input.kind, target)
  );

  const handleFilesAccepted = React.useCallback((files: File[]) => {
    const selectedFile = files[0];

    if (!selectedFile) {
      return;
    }

    const validationRunId = fileValidationRunId.current + 1;
    fileValidationRunId.current = validationRunId;
    conversionRunId.current += 1;
    setFile(null);
    setFileSafety(null);
    setStatus("idle");
    setProgress(0);
    setStageLabel("Checking file...");
    setError(null);
    setUploadError(null);
    setFormatMessage(null);
    setCompletedAssets([]);

    void validateFileSafety(selectedFile)
      .then((safetyResult) => {
        if (fileValidationRunId.current !== validationRunId) {
          return;
        }

        if (!safetyResult.ok) {
          setStatus("error");
          setProgress(0);
          setStageLabel("File not accepted.");
          setError(safetyResult.message);
          setUploadError(safetyResult.message);
          return;
        }

        const nextSupportedTargets = getSupportedTargetsForCategory(
          safetyResult.input.category
        ).map((option) => option.value);

        setFile(selectedFile);
        setFileSafety(safetyResult);
        setStatus("idle");
        setStageLabel("Ready.");

        if (target && !nextSupportedTargets.includes(target)) {
          setFormatMessage(buildUnsupportedFormatMessage(target, nextSupportedTargets));
          setTarget(nextSupportedTargets[0] ?? null);
          return;
        }

        setFormatMessage(null);
      })
      .catch(() => {
        if (fileValidationRunId.current !== validationRunId) {
          return;
        }

        const message =
          "Looma could not verify this file safely. Please try another file.";

        setStatus("error");
        setProgress(0);
        setStageLabel("File not accepted.");
        setError(message);
        setUploadError(message);
      });
  }, [target]);

  const handleConvert = React.useCallback(async () => {
    if (status === "processing") {
      return;
    }

    if (!file) {
      setStatus("error");
      setProgress(0);
      setStageLabel("Select a file first.");
      setError("Select a file before converting.");
      return;
    }

    if (
      !target ||
      !supportedTargetValues.has(target) ||
      !fileSafety ||
      !isFileSafetyResultForFile(file, fileSafety)
    ) {
      setStatus("error");
      setProgress(0);
      setStageLabel("File needs verification.");
      setError("Please upload this file again so Looma can verify it before conversion.");
      setUploadError(null);
      return;
    }

    const runId = conversionRunId.current + 1;
    conversionRunId.current = runId;

    setStatus("processing");
    setProgress(3);
    setStageLabel("Parsing...");
    setError(null);
    setUploadError(null);
    setCompletedAssets([]);

    try {
      const assets = await convertFile(file, {
        target,
        compressionLevel,
        fileSafety,
        onProgress: (nextProgress: ConversionProgress) => {
          if (conversionRunId.current !== runId) {
            return;
          }

          setProgress(nextProgress.percent);
          setStageLabel(nextProgress.label);
        }
      });

      if (conversionRunId.current !== runId) {
        return;
      }

      await downloadConvertedAssets(assets, buildArchiveName(file));

      if (conversionRunId.current !== runId) {
        return;
      }

      setCompletedAssets(assets);
      setProgress(100);
      setStageLabel("Download Ready");
      setStatus("completed");
    } catch (conversionError) {
      if (conversionRunId.current !== runId) {
        return;
      }

      setProgress(100);
      setStageLabel("Conversion failed.");
      setStatus("error");
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "The browser could not complete this conversion."
      );
    }
  }, [compressionLevel, file, fileSafety, status, supportedTargetValues, target]);

  function reset() {
    fileValidationRunId.current += 1;
    conversionRunId.current += 1;
    setFile(null);
    setFileSafety(null);
    setTarget(null);
    setCompressionLevel(0);
    setStatus("idle");
    setProgress(0);
    setStageLabel("Waiting for a file.");
    setError(null);
    setUploadError(null);
    setFormatMessage(null);
    setCompletedAssets([]);
  }

  function chooseTarget(nextTarget: ConversionTarget) {
    conversionRunId.current += 1;
    setTarget(nextTarget);
    if (!uploadError) {
      setStatus("idle");
      setProgress(0);
      setError(null);
    }
    setStageLabel(file ? "Ready." : "Waiting for a file.");
    setFormatMessage(
      file && !supportedTargetValues.has(nextTarget)
        ? buildUnsupportedFormatMessage(nextTarget, Array.from(supportedTargetValues))
        : null
    );
    setCompletedAssets([]);
  }

  return (
    <Card className="w-full max-w-2xl border bg-card/95 shadow-soft backdrop-blur">
      <CardHeader className="space-y-2 p-6 text-center sm:p-8 sm:pb-5">
        <CardTitle className="text-2xl font-bold tracking-normal sm:text-3xl">
          Private PDF & Image Converter
        </CardTitle>
        <CardDescription className="mx-auto max-w-md text-sm">
          Convert and compress PDF, JPG, PNG, and WEBP files locally in your browser.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 p-5 pt-0 sm:p-8 sm:pt-0">
        <WorkflowStep number={1} title="Upload">
          <ConverterDropzone
            onFilesAccepted={handleFilesAccepted}
            selectedFile={file}
            multiple={false}
            validationMessage={uploadError}
          />
        </WorkflowStep>

        <WorkflowStep number={2} title="SELECT FORMAT">
          <div className="grid grid-cols-4 gap-2">
            {FORMAT_OPTIONS.map((option) => {
              const isActive = target === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => chooseTarget(option.value)}
                  aria-pressed={isActive}
                  className={cn(
                    "touch-target rounded-md border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-input bg-background text-foreground hover:bg-muted"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {formatMessage ? (
            <p className="text-xs text-destructive">
              {formatMessage}
            </p>
          ) : null}
          {sameFormatReencode && target ? (
            <p className="text-xs text-muted-foreground">
              {getFormatLabel(target)} to {getFormatLabel(target)} re-encodes the image
              for compression.
            </p>
          ) : null}
          {showTransparencyWarning ? (
            <p className="text-xs text-amber-700">
              Transparent areas will be replaced with a white background.
            </p>
          ) : null}
        </WorkflowStep>

        <WorkflowStep number={3} title="COMPRESS FILE">
          <div className="space-y-3 rounded-md border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">Compression level</span>
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-bold",
                  compressionUnavailable
                    ? "bg-muted text-muted-foreground"
                    : compressionLevel === 0
                    ? "bg-muted text-muted-foreground"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {getCompressionBadgeLabel({
                  compressionLevel,
                  compressionUnavailable,
                  sameFormatReencode
                })}
              </span>
            </div>
            <Slider
              value={[compressionLevel]}
              min={0}
              max={90}
              step={5}
              onValueChange={([value]) => setCompressionLevel(value)}
              disabled={compressionUnavailable}
              aria-label="Compression level"
              aria-disabled={compressionUnavailable}
            />
            {compressionUnavailable && fileSafety && target ? (
              <p className="text-xs text-muted-foreground">
                Compression is unavailable for {fileSafety.input.label} to{" "}
                {getFormatLabel(target)} because this output does not use a compression
                setting.
              </p>
            ) : null}
          </div>
        </WorkflowStep>

        <WorkflowStep number={4} title="Action Button">
          <Button
            type="button"
            size="lg"
            onClick={handleConvert}
            disabled={!canConvert}
            className="h-12 w-full text-base"
          >
            {status === "processing" ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-5 w-5" aria-hidden="true" />
            )}
            Convert & Download
          </Button>

          {status === "processing" ? (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground">{stageLabel}</p>
            </div>
          ) : null}

          {status === "completed" ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">Download Ready</p>
                  <p className="text-sm">
                    {completedAssets.length}{" "}
                    {completedAssets.length === 1 ? "file" : "files"} prepared
                    {completedAssets.length > 0
                      ? ` / ${formatBytes(
                          completedAssets.reduce(
                            (total, asset) => total + asset.blob.size,
                            0
                          )
                        )}`
                      : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Convert Another File
              </button>
            </div>
          ) : null}

          {status === "error" && error && !uploadError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </WorkflowStep>
      </CardContent>
    </Card>
  );
}

function WorkflowStep({
  number,
  title,
  children
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
          {number}
        </span>
        <h2 className="text-sm font-bold tracking-normal text-foreground sm:text-base">
          Step {number} - {title}
        </h2>
      </div>
      <div className="pl-0 sm:pl-11">{children}</div>
    </section>
  );
}

function buildArchiveName(file: File) {
  return `${file.name.replace(/\.[^/.]+$/, "") || "converted"}-converted.zip`;
}

function buildUnsupportedFormatMessage(
  target: ConversionTarget,
  supportedTargets: ConversionTarget[]
) {
  const requestedFormat = getFormatLabel(target);
  const supportedFormats = supportedTargets.map(getFormatLabel).join(", ");

  return `${requestedFormat} output is not available for this file type. Please choose ${supportedFormats}.`;
}

function getFormatLabel(target: ConversionTarget) {
  return FORMAT_OPTIONS.find((option) => option.value === target)?.label ?? target.toUpperCase();
}

function getCompressionBadgeLabel({
  compressionLevel,
  compressionUnavailable,
  sameFormatReencode
}: {
  compressionLevel: number;
  compressionUnavailable: boolean;
  sameFormatReencode: boolean;
}) {
  if (compressionUnavailable) {
    return "Unavailable";
  }

  if (compressionLevel === 0 && sameFormatReencode) {
    return "0% / Re-encode";
  }

  if (compressionLevel === 0) {
    return "0% / Standard";
  }

  return `${compressionLevel}%`;
}

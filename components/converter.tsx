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
  type ConvertedAsset,
  type ConversionProgress,
  type ConversionTarget
} from "@/lib/conversion-engine";
import { downloadConvertedAssets } from "@/lib/download-handler";
import { cn } from "@/lib/utils";

type ConverterStatus = "idle" | "processing" | "completed" | "error";

const FORMAT_OPTIONS: Array<{ value: ConversionTarget; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
  { value: "jpg", label: "JPG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WEBP" }
];

export function Converter() {
  const [file, setFile] = React.useState<File | null>(null);
  const [target, setTarget] = React.useState<ConversionTarget>("pdf");
  const [compressionLevel, setCompressionLevel] = React.useState(0);
  const [status, setStatus] = React.useState<ConverterStatus>("idle");
  const [progress, setProgress] = React.useState(0);
  const [stageLabel, setStageLabel] = React.useState("Waiting for a file.");
  const [error, setError] = React.useState<string | null>(null);
  const [completedAssets, setCompletedAssets] = React.useState<ConvertedAsset[]>([]);

  const handleFilesAccepted = React.useCallback((files: File[]) => {
    const selectedFile = files[0];

    if (!selectedFile) {
      return;
    }

    setFile(selectedFile);
    setStatus("idle");
    setProgress(0);
    setStageLabel("Ready.");
    setError(null);
    setCompletedAssets([]);
  }, []);

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

    setStatus("processing");
    setProgress(3);
    setStageLabel("Parsing...");
    setError(null);
    setCompletedAssets([]);

    try {
      const assets = await convertFile(file, {
        target,
        compressionLevel,
        onProgress: (nextProgress: ConversionProgress) => {
          setProgress(nextProgress.percent);
          setStageLabel(nextProgress.label);
        }
      });

      await downloadConvertedAssets(assets, buildArchiveName(file));

      setCompletedAssets(assets);
      setProgress(100);
      setStageLabel("Download Ready");
      setStatus("completed");
    } catch (conversionError) {
      setProgress(100);
      setStageLabel("Conversion failed.");
      setStatus("error");
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "The browser could not complete this conversion."
      );
    }
  }, [compressionLevel, file, status, target]);

  function reset() {
    setFile(null);
    setTarget("pdf");
    setCompressionLevel(0);
    setStatus("idle");
    setProgress(0);
    setStageLabel("Waiting for a file.");
    setError(null);
    setCompletedAssets([]);
  }

  function chooseTarget(nextTarget: ConversionTarget) {
    setTarget(nextTarget);
    setStatus("idle");
    setProgress(0);
    setStageLabel(file ? "Ready." : "Waiting for a file.");
    setError(null);
    setCompletedAssets([]);
  }

  return (
    <Card className="w-full max-w-2xl border bg-card/95 shadow-soft backdrop-blur">
      <CardHeader className="space-y-2 p-6 text-center sm:p-8 sm:pb-5">
        <CardTitle className="text-2xl font-bold tracking-normal sm:text-3xl">
          Private File Converter
        </CardTitle>
        <CardDescription className="mx-auto max-w-md text-sm">
          Convert one file at a time locally in your browser.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 p-5 pt-0 sm:p-8 sm:pt-0">
        <WorkflowStep number={1} title="Upload">
          <ConverterDropzone
            onFilesAccepted={handleFilesAccepted}
            selectedFile={file}
            multiple={false}
          />
        </WorkflowStep>

        <WorkflowStep number={2} title="SELECT FORMAT">
          <div className="grid grid-cols-5 gap-2">
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
        </WorkflowStep>

        <WorkflowStep number={3} title="COMPRESS FILE">
          <div className="space-y-3 rounded-md border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">Compression level</span>
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-bold",
                  compressionLevel === 0
                    ? "bg-muted text-muted-foreground"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {compressionLevel === 0 ? "0% / None" : `${compressionLevel}%`}
              </span>
            </div>
            <Slider
              value={[compressionLevel]}
              min={0}
              max={90}
              step={5}
              onValueChange={([value]) => setCompressionLevel(value)}
              aria-label="Compression level"
            />
          </div>
        </WorkflowStep>

        <WorkflowStep number={4} title="Action Button">
          <Button
            type="button"
            size="lg"
            onClick={handleConvert}
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
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset / Convert Another File
              </button>
            </div>
          ) : null}

          {status === "error" && error ? (
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

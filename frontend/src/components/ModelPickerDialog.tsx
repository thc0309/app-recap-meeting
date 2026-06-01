import { CheckCircle2, Download, LoaderCircle, X } from "lucide-react";

import { formatBytes } from "@/lib/format";
import type { ModelStatusSnapshot, WhisperModelId } from "@/types";

interface ModelPickerDialogProps {
  open: boolean;
  modelStatus: ModelStatusSnapshot | null;
  onClose: () => void;
  onSelectModel: (modelId: WhisperModelId) => void;
  onDownloadModel: (modelId: WhisperModelId) => void;
}

export function ModelPickerDialog({
  open,
  modelStatus,
  onClose,
  onSelectModel,
  onDownloadModel,
}: ModelPickerDialogProps) {
  if (!open || !modelStatus) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-3xl rounded-3xl p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              Whisper Models
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Choose your transcription model</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your last selection is saved automatically. You can switch models at any
              time; the selected model is used for new transcription work.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card p-2 hover:bg-muted"
            aria-label="Close model picker"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {modelStatus.models.map((model) => {
            const selected = model.id === modelStatus.selectedModelId;
            const downloading = model.id === modelStatus.downloadModelId && modelStatus.isDownloading;
            const progress = downloading ? modelStatus.downloadProgressPercent : null;

            return (
              <article
                key={model.id}
                className={`rounded-2xl border p-4 transition ${
                  selected
                    ? "border-accent bg-accent/8 shadow-[0_0_0_1px_rgba(37,99,235,0.18)]"
                    : "border-border bg-background/55"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{model.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {model.fileName} · {formatBytes(model.approxSizeBytes)}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {selected ? (
                      <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
                        Selected
                      </span>
                    ) : null}
                    {model.isDownloaded ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                        <CheckCircle2 className="size-3.5" />
                        Installed
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted-foreground break-all">{model.path}</p>

                {downloading ? (
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <LoaderCircle className="size-4 animate-spin" />
                        Downloading…
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {progress !== null ? `${progress.toFixed(0)}%` : "Starting…"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300"
                        style={{ width: `${progress ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatBytes(modelStatus.downloadDownloadedBytes ?? 0)}
                      {modelStatus.downloadTotalBytes
                        ? ` / ${formatBytes(modelStatus.downloadTotalBytes)}`
                        : ""}
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectModel(model.id)}
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${
                      selected
                        ? "bg-accent text-accent-foreground"
                        : "border border-border bg-card hover:bg-muted"
                    }`}
                  >
                    {selected ? "Using this model" : "Use this model"}
                  </button>

                  {!model.isDownloaded ? (
                    <button
                      type="button"
                      disabled={modelStatus.isDownloading}
                      onClick={() => onDownloadModel(model.id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      <Download className="size-4" />
                      Download
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

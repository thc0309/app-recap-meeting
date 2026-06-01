import {
  Download,
  LoaderCircle,
  Moon,
  RefreshCw,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { ModelStatusSnapshot } from "@/types";

interface HeaderProps {
  ipcConnected: boolean;
  isRefreshing: boolean;
  modelStatus: ModelStatusSnapshot | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onRefresh: () => void;
  onDownloadModel: () => void;
}

export function Header({
  ipcConnected,
  isRefreshing,
  modelStatus,
  theme,
  onToggleTheme,
  onRefresh,
  onDownloadModel,
}: HeaderProps) {
  const modelReady = modelStatus?.defaultModelExists ?? false;
  const isDownloading = modelStatus?.isDownloading ?? false;

  return (
    <header className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Meeting Transcriber
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Your meetings, transcribed locally</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
            ipcConnected
              ? "bg-success/10 text-success"
              : "bg-danger/10 text-danger"
          }`}
        >
          {ipcConnected ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
          {ipcConnected ? "IPC connected" : "IPC unavailable"}
        </span>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
        >
          {isRefreshing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </button>

        <button
          type="button"
          onClick={onDownloadModel}
          disabled={isDownloading || modelReady}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {isDownloading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {isDownloading
            ? "Downloading model..."
            : modelReady
              ? "Whisper model ready"
              : "Download Whisper model"}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex items-center justify-center rounded-xl border border-border bg-card p-2 hover:bg-muted"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}

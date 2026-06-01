import {
  ArrowLeft,
  Download,
  LoaderCircle,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { ModelStatusSnapshot } from "@/types";

export type AppScreen = "meetings" | "settings";

interface HeaderProps {
  screen: AppScreen;
  ipcConnected: boolean;
  isRefreshing: boolean;
  modelStatus: ModelStatusSnapshot | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onRefresh: () => void;
  onDownloadModel: () => void;
  onOpenSettings: () => void;
  onBackToMeetings: () => void;
}

export function Header({
  screen,
  ipcConnected,
  isRefreshing,
  modelStatus,
  theme,
  onToggleTheme,
  onRefresh,
  onDownloadModel,
  onOpenSettings,
  onBackToMeetings,
}: HeaderProps) {
  const modelReady = modelStatus?.defaultModelExists ?? false;
  const isDownloading = modelStatus?.isDownloading ?? false;
  const onSettings = screen === "meetings";

  return (
    <header className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {!onSettings && (
          <button
            type="button"
            onClick={onBackToMeetings}
            className="mt-0.5 inline-flex items-center justify-center rounded-xl border border-border p-2 hover:bg-muted"
            aria-label="Back to meetings"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Meeting Transcriber
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {onSettings ? "Your meetings, transcribed locally" : "Settings"}
          </h1>
        </div>
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

        {onSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            <Settings className="size-4" />
            Settings
          </button>
        ) : null}

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

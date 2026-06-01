import { AlertTriangle, ShieldCheck } from "lucide-react";

import type { CaptureStateSnapshot } from "@/types";

interface CapturePanelProps {
  captureState: CaptureStateSnapshot | null;
  disabled: boolean;
  onRequestPermission: () => Promise<unknown>;
  onSimulateLoss: (source: "system_audio" | "local_mic") => Promise<unknown>;
  onRecoverDevice: (source: "system_audio" | "local_mic") => Promise<unknown>;
}

function formatPermission(state: string | undefined): string {
  return (state ?? "unknown").replaceAll("_", " ");
}

export function CapturePanel({
  captureState,
  disabled,
  onRequestPermission,
  onSimulateLoss,
  onRecoverDevice,
}: CapturePanelProps) {
  const showSpeakerBleedWarning = captureState?.platformName === "macos";

  return (
    <section className="glass-panel rounded-2xl p-5">
      <h2 className="text-lg font-semibold">Capture status</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform: {captureState?.platformName ?? "unknown"} · Backend:{" "}
        {captureState?.systemAudioBackend ?? "n/a"}
      </p>

      {showSpeakerBleedWarning ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-medium">macOS speaker bleed warning</p>
          <p className="mt-1 text-amber-800 dark:text-amber-200">
            If you play meeting audio through speakers while mic capture is on, the microphone can
            re-record that speaker output. That creates duplicated or overlapping transcript
            segments. Headphones are the safest path right now.
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {captureState?.sources.map((source) => (
          <div
            key={source.kind}
            className="rounded-xl border border-border bg-background/50 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{source.displayName}</p>
              <span className="text-xs text-muted-foreground">{source.backend}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Permission: {formatPermission(source.permissionState)} · Device:{" "}
              {formatPermission(source.deviceState)}
            </p>
            {source.lastError && (
              <p className="mt-2 flex items-center gap-2 text-sm text-danger">
                <AlertTriangle className="size-4" />
                {source.lastError}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onRequestPermission()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          <ShieldCheck className="size-4" />
          Request system audio permission
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onSimulateLoss("system_audio")}
          className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Simulate system loss
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onRecoverDevice("system_audio")}
          className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Recover system audio
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onSimulateLoss("local_mic")}
          className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Simulate mic loss
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onRecoverDevice("local_mic")}
          className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Recover mic
        </button>
      </div>
    </section>
  );
}

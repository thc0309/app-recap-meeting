import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { formatElapsedMs, useSessionDuration } from "@/hooks/useSessionDuration";
import type { MeetingSession } from "@/types";

interface RecordingHubProps {
  activeSession: MeetingSession | null;
  hasActiveSession: boolean;
  isProcessing: boolean;
  defaultSaveRawAudio: boolean;
  defaultRefineAfterMeeting: boolean;
  onCreateSession: (input: {
    title: string | null;
    saveRawAudio: boolean;
    refineRequested: boolean;
  }) => Promise<unknown>;
  onRecover: () => Promise<unknown>;
  onFinalize: (runRefine: boolean) => Promise<unknown>;
}

export function RecordingHub({
  activeSession,
  hasActiveSession,
  isProcessing,
  defaultSaveRawAudio,
  defaultRefineAfterMeeting,
  onCreateSession,
  onRecover,
  onFinalize,
}: RecordingHubProps) {
  const [title, setTitle] = useState("");
  const [saveRawAudio, setSaveRawAudio] = useState(defaultSaveRawAudio);
  const [refineRequested, setRefineRequested] = useState(defaultRefineAfterMeeting);
  const elapsedMs = useSessionDuration(activeSession);

  useEffect(() => {
    setSaveRawAudio(defaultSaveRawAudio);
    setRefineRequested(defaultRefineAfterMeeting);
  }, [defaultSaveRawAudio, defaultRefineAfterMeeting]);

  const refineDisabled = !saveRawAudio || hasActiveSession || isProcessing;

  return (
    <section className="glass-panel rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Recording</h2>
          {activeSession && elapsedMs !== null && (
            <p className="mt-0.5 text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-300">
              {formatElapsedMs(elapsedMs)}
            </p>
          )}
        </div>
        {activeSession && <StatusBadge status={activeSession.status} />}
      </div>

      {isProcessing && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
          <LoaderCircle className="size-3.5 animate-spin" />
          Processing…
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateSession({
            title: title.trim() || null,
            saveRawAudio,
            refineRequested: refineRequested && saveRawAudio,
          }).then(() => setTitle(""));
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={hasActiveSession || isProcessing}
            placeholder="Design review"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={saveRawAudio}
              disabled={hasActiveSession || isProcessing}
              onChange={(event) => {
                setSaveRawAudio(event.target.checked);
                if (!event.target.checked) {
                  setRefineRequested(false);
                }
              }}
            />
            Save raw audio
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={refineRequested}
              disabled={refineDisabled}
              onChange={(event) => setRefineRequested(event.target.checked)}
            />
            Refine pass
          </label>
        </div>

        <button
          type="submit"
          disabled={hasActiveSession || isProcessing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          <Mic className="size-4" />
          New session
        </button>
      </form>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!activeSession || isProcessing || activeSession.status !== "recording"}
          onClick={() => void onRecover()}
          className="rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          Recover
        </button>
        <button
          type="button"
          disabled={!activeSession || isProcessing}
          onClick={() => void onFinalize(refineRequested && defaultRefineAfterMeeting)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <Square className="size-3.5" />
          Finalize
        </button>
      </div>
    </section>
  );
}

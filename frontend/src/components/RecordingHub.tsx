import { LoaderCircle, Mic, Square } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
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

  const refineDisabled = !saveRawAudio || hasActiveSession || isProcessing;

  return (
    <section className="glass-panel rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Recording hub</h2>
          <p className="text-sm text-muted-foreground">
            Create a session, capture mic + system audio, then finalize when the meeting ends.
          </p>
        </div>
        {activeSession && <StatusBadge status={activeSession.status} />}
      </div>

      {isProcessing && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
          <LoaderCircle className="size-4 animate-spin" />
          Processing transcript. Controls are temporarily disabled.
        </div>
      )}

      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateSession({
            title: title.trim() || null,
            saveRawAudio,
            refineRequested: refineRequested && saveRawAudio,
          }).then(() => setTitle(""));
        }}
      >
        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-muted-foreground">Session title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={hasActiveSession || isProcessing}
            placeholder="Design review"
            className="rounded-xl border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={refineRequested}
            disabled={refineDisabled}
            onChange={(event) => setRefineRequested(event.target.checked)}
          />
          Request refine pass
        </label>

        <button
          type="submit"
          disabled={hasActiveSession || isProcessing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-50 md:col-span-2"
        >
          <Mic className="size-4" />
          Create session
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!activeSession || isProcessing || activeSession.status !== "recording"}
          onClick={() => void onRecover()}
          className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Recover active session
        </button>
        <button
          type="button"
          disabled={!activeSession || isProcessing}
          onClick={() => void onFinalize(refineRequested && defaultRefineAfterMeeting)}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Square className="size-4" />
          Finalize session
        </button>
      </div>
    </section>
  );
}

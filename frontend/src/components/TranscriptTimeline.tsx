import { Mic, MonitorSpeaker } from "lucide-react";

import type { TranscriptSegment } from "@/types";
import { formatTimestamp, isMicSource } from "@/lib/format";

interface TranscriptTimelineProps {
  segments: TranscriptSegment[];
  isProcessing: boolean;
}

export function TranscriptTimeline({ segments, isProcessing }: TranscriptTimelineProps) {
  if (isProcessing) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40">
        <p className="text-sm text-muted-foreground">
          Finalizing transcript and speaker labels...
        </p>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40">
        <p className="text-sm text-muted-foreground">
          Transcript segments will appear here after finalization.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
      {segments.map((segment) => {
        const mic = isMicSource(segment.sourceType);
        return (
          <article
            key={segment.id}
            className={`rounded-2xl border px-4 py-3 ${
              mic
                ? "border-emerald-500/25 bg-emerald-500/5"
                : "border-sky-500/25 bg-sky-500/5"
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                  mic
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                }`}
              >
                {mic ? <Mic className="size-3" /> : <MonitorSpeaker className="size-3" />}
                {mic ? "Mic" : "System"}
              </span>
              <span>{segment.speakerLabel}</span>
              <span>
                {formatTimestamp(segment.startTimeMs)} – {formatTimestamp(segment.endTimeMs)}
              </span>
            </div>
            <p className="text-sm leading-6">{segment.text}</p>
          </article>
        );
      })}
    </div>
  );
}

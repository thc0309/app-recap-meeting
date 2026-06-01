import { Radio } from "lucide-react";

import { TimelineTree } from "@/components/TimelineTree";
import type { TranscriptSegment } from "@/types";

interface LiveTranscriptPanelProps {
  segments: TranscriptSegment[];
  isActive: boolean;
  isProcessing: boolean;
  modelReady: boolean;
}

export function LiveTranscriptPanel({
  segments,
  isActive,
  isProcessing,
  modelReady,
}: LiveTranscriptPanelProps) {
  return (
    <section className="glass-panel flex min-h-[20rem] flex-1 flex-col rounded-2xl p-5 lg:min-h-0">
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Live transcript</h2>
          <p className="text-sm text-muted-foreground">
            Timeline tree — mic and system branches update while you record.
          </p>
        </div>
        {isActive && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Radio className="size-3 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {!modelReady && isActive && (
        <p className="mb-3 shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Download the Whisper model to enable live transcription.
        </p>
      )}

      <div className="min-h-0 flex-1">
        <TimelineTree
          segments={segments}
          isProcessing={isProcessing}
          autoScrollToEnd={isActive}
          emptyMessage={
            isActive
              ? "Listening… new branches will appear on the timeline."
              : "Start a session to see the live timeline tree."
          }
        />
      </div>
    </section>
  );
}

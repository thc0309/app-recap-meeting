import { Mic, MonitorSpeaker } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { TranscriptSegment } from "@/types";
import { formatTimestamp, isMicSource } from "@/lib/format";

interface TimelineTreeProps {
  segments: TranscriptSegment[];
  isProcessing?: boolean;
  emptyMessage?: string;
  autoScrollToEnd?: boolean;
  className?: string;
}

function sourceMeta(sourceType: string) {
  const mic = isMicSource(sourceType);
  return {
    mic,
    label: mic ? "Mic" : "System",
    Icon: mic ? Mic : MonitorSpeaker,
    dotClass: mic ? "bg-emerald-500 ring-emerald-500/30" : "bg-sky-500 ring-sky-500/30",
    branchClass: mic
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-sky-500/30 bg-sky-500/5",
    badgeClass: mic
      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
      : "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  };
}

export function TimelineTree({
  segments,
  isProcessing = false,
  emptyMessage = "No transcript segments yet.",
  autoScrollToEnd = false,
  className = "",
}: TimelineTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...segments].sort((a, b) => a.startTimeMs - b.startTimeMs),
    [segments],
  );

  useEffect(() => {
    if (!autoScrollToEnd || !scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [autoScrollToEnd, sorted]);

  if (isProcessing) {
    return (
      <div
        className={`flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 ${className}`}
      >
        <p className="text-sm text-muted-foreground">
          Finalizing transcript and speaker labels...
        </p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className={`flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/40 ${className}`}
      >
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`max-h-[28rem] overflow-y-auto pr-1 ${className}`}
      role="tree"
      aria-label="Transcript timeline"
    >
      <ol className="relative ml-2 border-l-2 border-border/80 pl-0">
        {sorted.map((segment, index) => {
          const meta = sourceMeta(segment.sourceType);
          const isLast = index === sorted.length - 1;

          return (
            <li
              key={segment.id}
              role="treeitem"
              className={`relative pb-6 ${isLast ? "pb-1" : ""}`}
            >
              <span
                className={`absolute top-1.5 -left-[7px] size-3 rounded-full ring-4 ${meta.dotClass}`}
                aria-hidden
              />

              <div className="ml-5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <time
                    className="font-mono font-medium tabular-nums text-foreground"
                    dateTime={`PT${Math.floor(segment.startTimeMs / 1000)}S`}
                  >
                    {formatTimestamp(segment.startTimeMs)}
                  </time>
                  {segment.endTimeMs > segment.startTimeMs && (
                    <span className="text-muted-foreground">
                      → {formatTimestamp(segment.endTimeMs)}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${meta.badgeClass}`}
                  >
                    <meta.Icon className="size-3" />
                    {meta.label}
                  </span>
                  <span className="text-muted-foreground">{segment.speakerLabel}</span>
                </div>

                <div
                  className={`rounded-xl border px-3 py-2.5 text-sm leading-6 ${meta.branchClass}`}
                >
                  {segment.text}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

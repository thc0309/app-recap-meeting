import type { SessionStatus } from "@/types";
import { formatSessionStatus } from "@/lib/format";

const STATUS_STYLES: Record<SessionStatus, string> = {
  recording: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  recovered: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  processing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  done: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  recap_done: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {formatSessionStatus(status)}
    </span>
  );
}

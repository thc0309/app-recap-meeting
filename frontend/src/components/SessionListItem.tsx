import { StatusBadge } from "@/components/StatusBadge";
import { useSessionDuration, formatElapsedMs } from "@/hooks/useSessionDuration";
import { formatDuration } from "@/lib/format";
import type { MeetingSession } from "@/types";

interface SessionListItemProps {
  session: MeetingSession;
  collapsed: boolean;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
}

export function SessionListItem({
  session,
  collapsed,
  isSelected,
  isActive,
  onSelect,
}: SessionListItemProps) {
  const elapsedMs = useSessionDuration(session);
  const isLive = elapsedMs !== null;
  const durationLabel = isLive ? formatElapsedMs(elapsedMs) : formatDuration(session);

  return (
    <button
      type="button"
      onClick={onSelect}
      title={session.title}
      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
        isSelected ? "border-accent bg-accent/10" : "border-border hover:bg-muted/70"
      } ${collapsed ? "px-2 py-2 text-center" : ""}`}
    >
      {collapsed ? (
        <span className="text-xs font-semibold">{session.title.slice(0, 1)}</span>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-1 font-medium">{session.title}</p>
            {isActive && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent uppercase">
                Live
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <StatusBadge status={session.status} />
            <span
              className={`text-xs tabular-nums ${
                isLive ? "font-medium text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"
              }`}
            >
              {durationLabel}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

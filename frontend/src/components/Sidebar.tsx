import { ChevronLeft, ChevronRight, History, Trash2 } from "lucide-react";

import { StatusBadge } from "@/components/StatusBadge";
import type { MeetingSession } from "@/types";
import { formatDuration } from "@/lib/format";

interface SidebarProps {
  collapsed: boolean;
  sessions: MeetingSession[];
  selectedSessionId: string | null;
  activeSessionId: string | null;
  disabled: boolean;
  onToggleCollapsed: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClearHistory: () => void;
}

export function Sidebar({
  collapsed,
  sessions,
  selectedSessionId,
  activeSessionId,
  disabled,
  onToggleCollapsed,
  onSelectSession,
  onDeleteSession,
  onClearHistory,
}: SidebarProps) {
  return (
    <aside
      className={`glass-panel flex h-full flex-col rounded-2xl transition-all ${
        collapsed ? "w-14 p-2" : "w-72 p-4"
      }`}
    >
      <div className={`mb-4 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <History className="size-4 text-accent" />
            <h2 className="font-semibold">Sessions</h2>
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-lg border border-border p-2 hover:bg-muted"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {sessions.length === 0 && !collapsed && (
          <p className="text-sm text-muted-foreground">No meetings yet.</p>
        )}

        {sessions.map((session) => {
          const isSelected = session.id === selectedSessionId;
          const isActive = session.id === activeSessionId;

          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              title={session.title}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                isSelected
                  ? "border-accent bg-accent/10"
                  : "border-border hover:bg-muted/70"
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
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(session)}
                    </span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>

      {!collapsed && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={disabled || !selectedSessionId}
            onClick={() => selectedSessionId && onDeleteSession(selectedSessionId)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 px-3 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            Delete session
          </button>
          <button
            type="button"
            disabled={disabled || sessions.length === 0}
            onClick={() => onClearHistory()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 px-3 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Clear history
          </button>
        </div>
      )}
    </aside>
  );
}

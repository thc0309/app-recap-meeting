import { ChevronLeft, ChevronRight, History, Sparkles, Trash2 } from "lucide-react";

import { SessionListItem } from "@/components/SessionListItem";
import type { MeetingSession, SessionStatus } from "@/types";

interface SidebarProps {
  collapsed: boolean;
  sessions: MeetingSession[];
  selectedSessionId: string | null;
  selectedSessionStatus: SessionStatus | null;
  activeSessionId: string | null;
  disabled: boolean;
  onToggleCollapsed: () => void;
  onSelectSession: (sessionId: string) => void;
  onGenerateRecap: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClearHistory: () => void;
}

export function Sidebar({
  collapsed,
  sessions,
  selectedSessionId,
  selectedSessionStatus,
  activeSessionId,
  disabled,
  onToggleCollapsed,
  onSelectSession,
  onGenerateRecap,
  onDeleteSession,
  onClearHistory,
}: SidebarProps) {
  const canGenerateRecap =
    selectedSessionStatus === "done" || selectedSessionStatus === "recap_done";

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

        {sessions.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            collapsed={collapsed}
            isSelected={session.id === selectedSessionId}
            isActive={session.id === activeSessionId}
            onSelect={() => onSelectSession(session.id)}
          />
        ))}
      </div>

      {!collapsed && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <button
            type="button"
            disabled={disabled || !selectedSessionId || !canGenerateRecap}
            onClick={() => selectedSessionId && onGenerateRecap(selectedSessionId)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            Generate recap
          </button>
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

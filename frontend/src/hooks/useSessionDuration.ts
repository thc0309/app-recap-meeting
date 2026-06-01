import { useEffect, useState } from "react";

import type { MeetingSession, SessionStatus } from "@/types";

const LIVE_STATUSES: SessionStatus[] = ["recording", "recovered"];

export function useSessionDuration(session: MeetingSession | null): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!session || !LIVE_STATUSES.includes(session.status)) {
      setElapsedMs(null);
      return;
    }

    const startedAt = Number(session.startedAtUnixMs);
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick();

    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  return elapsedMs;
}

export function formatElapsedMs(elapsedMs: number | null): string {
  if (elapsedMs === null) {
    return "";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}m ${seconds}s`;
}

import type { MeetingSession, SessionStatus } from "@/types";

const STATUS_LABELS: Record<SessionStatus, string> = {
  recording: "Recording",
  recovered: "Recovered",
  processing: "Processing",
  done: "Done",
  recap_done: "Recap ready",
  error: "Error",
};

export function formatSessionStatus(status: SessionStatus): string {
  return STATUS_LABELS[status];
}

export function formatDuration(session: MeetingSession): string {
  const end = session.endedAtUnixMs ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - session.startedAtUnixMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function isMicSource(sourceType: string): boolean {
  const normalized = sourceType.toLowerCase();
  return normalized.includes("mic") || normalized.includes("local");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

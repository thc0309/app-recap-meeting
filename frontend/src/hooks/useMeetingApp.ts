import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as api from "@/api/tauri";
import type {
  AppStateSnapshot,
  CaptureStateSnapshot,
  LiveTranscriptSnapshot,
  ModelStatusSnapshot,
  SessionDetailSnapshot,
  StatusKind,
} from "@/types";

interface OperationErrorEvent {
  message: string;
}

interface ModelDownloadProgressEvent {
  modelId: string;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
}

function pickSessionId(
  sessions: AppStateSnapshot["sessions"],
  activeSessionId: string | null,
  previous: string | null,
): string | null {
  if (previous && sessions.some((session) => session.id === previous)) {
    return previous;
  }
  if (activeSessionId && sessions.some((session) => session.id === activeSessionId)) {
    return activeSessionId;
  }
  return sessions[0]?.id ?? null;
}

export function useMeetingApp() {
  const [appState, setAppState] = useState<AppStateSnapshot | null>(null);
  const [captureState, setCaptureState] = useState<CaptureStateSnapshot | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusSnapshot | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetailSnapshot | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptSnapshot | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [ipcConnected, setIpcConnected] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Connecting to Tauri IPC...");
  const [statusKind, setStatusKind] = useState<StatusKind>("info");

  const setStatus = useCallback((message: string, kind: StatusKind = "info") => {
    setStatusMessage(message);
    setStatusKind(kind);
  }, []);

  const refreshCore = useCallback(async () => {
    const [nextAppState, nextCaptureState, nextModelStatus] = await Promise.all([
      api.getAppState(),
      api.getCaptureOverview(),
      api.getModelStatus(),
    ]);
    setAppState(nextAppState);
    setCaptureState(nextCaptureState);
    setModelStatus(nextModelStatus);

    let selectedSessionId: string | null = null;
    setSelectedSessionId((previous) => {
      selectedSessionId = pickSessionId(
        nextAppState.sessions,
        nextAppState.activeSessionId,
        previous,
      );
      return selectedSessionId;
    });

    return {
      nextAppState,
      nextCaptureState,
      nextModelStatus,
      selectedSessionId,
    };
  }, []);

  const refreshSessionDetail = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setSessionDetail(null);
      return;
    }
    const detail = await api.getSessionDetail(sessionId);
    setSessionDetail(detail);
  }, []);

  const refreshLiveTranscript = useCallback(async () => {
    const live = await api.getLiveTranscript();
    setLiveTranscript(live);
  }, []);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { selectedSessionId: sessionId } = await refreshCore();
      await Promise.all([refreshSessionDetail(sessionId), refreshLiveTranscript()]);
      setIpcConnected(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCore, refreshLiveTranscript, refreshSessionDetail]);

  useEffect(() => {
    if (!api.isTauriAvailable()) {
      setStatus("Run this app inside Tauri to enable IPC.", "error");
      setIsRefreshing(false);
      return;
    }

    void refreshAll()
      .then(() => setStatus("Ready.", "success"))
      .catch((error: Error) =>
        setStatus(`Initial state load failed: ${error.message}`, "error"),
      );
    // Mount-only bootstrap; background updates use the state-changed listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.isTauriAvailable()) {
      return;
    }

    let cancelled = false;
    const unlistenState = listen("state-changed", () => {
      if (cancelled) {
        return;
      }
      refreshAll()
        .catch((error: Error) =>
          setStatus(`Background refresh failed: ${error.message}`, "error"),
        );
    });

    const unlistenOperationError = listen<OperationErrorEvent>("operation-error", (event) => {
      if (cancelled) {
        return;
      }
      setStatus(event.payload.message, "error");
    });

    const unlistenModelProgress = listen<ModelDownloadProgressEvent>(
      "model-download-progress",
      (event) => {
        if (cancelled) {
          return;
        }
        setModelStatus((previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            isDownloading: true,
            downloadModelId: event.payload.modelId as typeof previous.selectedModelId,
            downloadProgressPercent: event.payload.progressPercent,
            downloadDownloadedBytes: event.payload.downloadedBytes,
            downloadTotalBytes: event.payload.totalBytes,
          };
        });
      },
    );

    const unlistenLive = listen<LiveTranscriptSnapshot>("live-transcript-updated", (event) => {
      if (cancelled) {
        return;
      }
      setLiveTranscript(event.payload);
    });

    return () => {
      cancelled = true;
      void unlistenState.then((unlisten) => unlisten());
      void unlistenOperationError.then((unlisten) => unlisten());
      void unlistenModelProgress.then((unlisten) => unlisten());
      void unlistenLive.then((unlisten) => unlisten());
    };
  }, [refreshAll, setStatus]);

  useEffect(() => {
    if (!ipcConnected || !selectedSessionId) {
      return;
    }
    refreshSessionDetail(selectedSessionId).catch((error: Error) =>
      setStatus(`Failed to load session detail: ${error.message}`, "error"),
    );
  }, [ipcConnected, refreshSessionDetail, selectedSessionId, setStatus]);

  const selectSession = useCallback(
    (sessionId: string) => {
      setSelectedSessionId(sessionId);
      void refreshSessionDetail(sessionId).catch((error: Error) =>
        setStatus(`Failed to load session detail: ${error.message}`, "error"),
      );
    },
    [refreshSessionDetail, setStatus],
  );

  const runAction = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
      try {
        setStatus(`${label}...`);
        const result = await action();
        await refreshAll();
        setStatus(`${label} succeeded.`, "success");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`${label} failed: ${message}`, "error");
        throw error;
      }
    },
    [refreshAll, setStatus],
  );

  const activeSession = useMemo(
    () =>
      appState?.sessions.find((session) => session.id === appState.activeSessionId) ??
      null,
    [appState],
  );

  const selectedSession = useMemo(
    () => appState?.sessions.find((session) => session.id === selectedSessionId) ?? null,
    [appState, selectedSessionId],
  );

  const isProcessing =
    activeSession?.status === "processing" ||
    selectedSession?.status === "processing";

  const isLiveRecording =
    activeSession?.status === "recording" || activeSession?.status === "recovered";

  return {
    appState,
    captureState,
    modelStatus,
    sessionDetail,
    liveTranscript,
    selectedSessionId,
    selectSession,
    activeSession,
    selectedSession,
    ipcConnected,
    isRefreshing,
    isProcessing,
    isLiveRecording,
    statusMessage,
    statusKind,
    setStatus,
    runAction,
    refreshAll,
  };
}

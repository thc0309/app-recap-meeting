import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as api from "@/api/tauri";
import type {
  AppStateSnapshot,
  CaptureStateSnapshot,
  ModelStatusSnapshot,
  SessionDetailSnapshot,
  StatusKind,
} from "@/types";

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

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { selectedSessionId: sessionId } = await refreshCore();
      await refreshSessionDetail(sessionId);
      setIpcConnected(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCore, refreshSessionDetail]);

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
    const unlistenPromise = listen("state-changed", () => {
      if (cancelled) {
        return;
      }
      refreshAll()
        .then(() => setStatus("State updated.", "success"))
        .catch((error: Error) =>
          setStatus(`Background refresh failed: ${error.message}`, "error"),
        );
    });

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
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

  return {
    appState,
    captureState,
    modelStatus,
    sessionDetail,
    selectedSessionId,
    selectSession,
    activeSession,
    selectedSession,
    ipcConnected,
    isRefreshing,
    isProcessing,
    statusMessage,
    statusKind,
    setStatus,
    runAction,
    refreshAll,
  };
}

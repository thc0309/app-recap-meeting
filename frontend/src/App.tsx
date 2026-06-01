import { useEffect, useMemo, useState } from "react";

import * as api from "@/api/tauri";
import { Header, type AppScreen } from "@/components/Header";
import { LiveTranscriptPanel } from "@/components/LiveTranscriptPanel";
import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import { RecapPanel } from "@/components/RecapPanel";
import { RecordingHub } from "@/components/RecordingHub";
import { Sidebar } from "@/components/Sidebar";
import { TranscriptTimeline } from "@/components/TranscriptTimeline";
import { useMeetingApp } from "@/hooks/useMeetingApp";
import type { WhisperModelId } from "@/types";
import { SettingsScreen } from "@/views/SettingsScreen";

function App() {
  const {
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
  } = useMeetingApp();

  const [screen, setScreen] = useState<AppScreen>("meetings");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const hasActiveSession = Boolean(appState?.activeSessionId);
  const sessions = appState?.sessions ?? [];
  const useLiveTranscript =
    isLiveRecording && selectedSessionId !== null && selectedSessionId === appState?.activeSessionId;
  const showLivePanel = isLiveRecording && selectedSessionId === appState?.activeSessionId;
  const timelineSegments = useMemo(() => {
    if (useLiveTranscript && liveTranscript?.segments.length) {
      return liveTranscript.segments;
    }

    return sessionDetail?.segments ?? [];
  }, [liveTranscript?.segments, sessionDetail?.segments, useLiveTranscript]);

  const selectedSessionTitle = selectedSession?.title ?? "Meeting transcript";
  const selectedSessionSubtitle = selectedSession
    ? `Session ${selectedSession.id}`
    : "Select a session from the sidebar.";

  async function handleSelectWhisperModel(modelId: WhisperModelId) {
    await runAction("Switch Whisper model", () => api.selectWhisperModel(modelId));
  }

  async function handleDownloadWhisperModel(modelId: WhisperModelId) {
    const model = modelStatus?.models.find((item) => item.id === modelId);
    const modelLabel = model?.label ?? "Whisper model";

    try {
      setStatus(`Starting ${modelLabel} download...`);
      await api.downloadWhisperModel(modelId);
      await refreshAll();
      setStatus(`${modelLabel} download started.`, "success");
      setModelPickerOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to start ${modelLabel} download: ${message}`, "error");
      throw error;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 lg:p-6">
      <Header
        screen={screen}
        ipcConnected={ipcConnected}
        isRefreshing={isRefreshing}
        modelStatus={modelStatus}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onRefresh={() => void refreshAll()}
        onOpenModelPicker={() => setModelPickerOpen(true)}
        onOpenSettings={() => setScreen("settings")}
        onBackToMeetings={() => setScreen("meetings")}
      />

      <ModelPickerDialog
        open={modelPickerOpen}
        modelStatus={modelStatus}
        onClose={() => setModelPickerOpen(false)}
        onSelectModel={(modelId) => void handleSelectWhisperModel(modelId)}
        onDownloadModel={(modelId) => void handleDownloadWhisperModel(modelId)}
      />

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${statusKind === "success"
            ? "border-success/30 bg-success/10 text-success"
            : statusKind === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-border bg-card/70 text-muted-foreground"
          }`}
      >
        {statusMessage}
      </div>

      {screen === "settings" ? (
        <SettingsScreen
          captureState={captureState}
          settings={appState?.settings ?? null}
          selectedSessionId={selectedSessionId}
          disabled={isProcessing}
          onRequestPermission={() =>
            runAction("Request system audio permission", api.requestSystemAudioPermission)
          }
          onSimulateLoss={(sourceKind) =>
            runAction("Simulate device loss", () => api.simulateDeviceLoss(sourceKind))
          }
          onRecoverDevice={(sourceKind) =>
            runAction("Recover capture device", () => api.recoverCaptureDevice(sourceKind))
          }
          onSaveSettings={(input) => runAction("Save settings", () => api.updateSettings(input))}
          onSaveApiKey={(key) => runAction("Save API key", () => api.saveOpenAiApiKey(key))}
          onExportMarkdown={(sessionId) =>
            runAction("Export markdown", async () => api.exportSessionMarkdown(sessionId))
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          <Sidebar
            collapsed={sidebarCollapsed}
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            selectedSessionStatus={selectedSession?.status ?? null}
            activeSessionId={appState?.activeSessionId ?? null}
            disabled={isProcessing}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onSelectSession={selectSession}
            onGenerateRecap={(sessionId) =>
              void runAction("Generate recap", () => api.generateRecap(sessionId))
            }
            onDeleteSession={(sessionId) =>
              runAction("Delete session", () => api.deleteSession(sessionId))
            }
            onClearHistory={() => runAction("Clear history", api.clearHistory)}
          />

          <main className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <div className="grid gap-4 xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
              <RecordingHub
                activeSession={activeSession}
                hasActiveSession={hasActiveSession}
                isProcessing={isProcessing}
                defaultSaveRawAudio={appState?.settings.saveRawAudio ?? true}
                defaultRefineAfterMeeting={appState?.settings.refineAfterMeeting ?? true}
                onCreateSession={(input) =>
                  runAction("Create session", () => api.createSession(input))
                }
                onRecover={() => runAction("Recover active session", api.recoverActiveSession)}
                onFinalize={(runRefine) => {
                  const sessionId = appState?.activeSessionId;
                  if (!sessionId) {
                    return Promise.reject(new Error("No active session exists."));
                  }

                  return runAction("Finalize session", () =>
                    api.finalizeSession({
                      sessionId,
                      runRefine,
                      generateRecap: false,
                    }),
                  );
                }}
              />
              {showLivePanel &&
                <LiveTranscriptPanel
                segments={timelineSegments}
                isActive={liveTranscript?.isActive ?? false}
                isProcessing={false}
                modelReady={liveTranscript?.modelReady ?? modelStatus?.selectedModelExists ?? false}
              />
              }
            </div>

            <section className="glass-panel rounded-2xl p-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{selectedSessionTitle}</h2>
                <p className="text-sm text-muted-foreground">{selectedSessionSubtitle}</p>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    Transcript
                  </h3>
                  <TranscriptTimeline
                    segments={!showLivePanel ? timelineSegments : []}
                    isProcessing={selectedSession?.status === "processing"}
                  />
                </div>

                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                    Recap
                  </h3>
                  {/* <p className="mb-4 text-sm text-muted-foreground">
                    {selectedSession
                      ? "Recap stays empty until you generate one after finalization."
                      : "Pick a completed session to review the generated recap."}
                  </p> */}
                  <RecapPanel recapMarkdown={sessionDetail?.recapMarkdown ?? null} />
                </div>
              </div>
            </section>
          </main>
        </div>
      )}
    </div>
  );
}

export default App;

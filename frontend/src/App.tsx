import { useEffect, useState } from "react";

import * as api from "@/api/tauri";
import { CapturePanel } from "@/components/CapturePanel";
import { Header } from "@/components/Header";
import { RecapPanel } from "@/components/RecapPanel";
import { RecordingHub } from "@/components/RecordingHub";
import { SettingsPanel } from "@/components/SettingsPanel";
import { Sidebar } from "@/components/Sidebar";
import { TranscriptTimeline } from "@/components/TranscriptTimeline";
import { useMeetingApp } from "@/hooks/useMeetingApp";

function App() {
  const {
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
    runAction,
    refreshAll,
  } = useMeetingApp();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
      <Header
        ipcConnected={ipcConnected}
        isRefreshing={isRefreshing}
        modelStatus={modelStatus}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onRefresh={() => void refreshAll()}
        onDownloadModel={() => void runAction("Download default model", api.downloadDefaultModel)}
      />

      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${
          statusKind === "success"
            ? "border-success/30 bg-success/10 text-success"
            : statusKind === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-border bg-card/70 text-muted-foreground"
        }`}
      >
        {statusMessage}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Sidebar
          collapsed={sidebarCollapsed}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          activeSessionId={appState?.activeSessionId ?? null}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onSelectSession={selectSession}
        />

        <div className="grid min-h-0 gap-4 overflow-y-auto xl:grid-cols-2">
          <div className="space-y-4">
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

            <CapturePanel
              captureState={captureState}
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
            />

            <SettingsPanel
              settings={appState?.settings ?? null}
              selectedSessionId={selectedSessionId}
              disabled={isProcessing}
              onSaveSettings={(input) =>
                runAction("Save settings", () => api.updateSettings(input))
              }
              onSaveApiKey={(key) => runAction("Save API key", () => api.saveOpenAiApiKey(key))}
              onGenerateRecap={(sessionId) =>
                runAction("Generate recap", () => api.generateRecap(sessionId))
              }
              onExportMarkdown={(sessionId) =>
                runAction("Export markdown", async () => {
                  const exportPath = await api.exportSessionMarkdown(sessionId);
                  return exportPath;
                })
              }
              onDeleteSession={(sessionId) =>
                runAction("Delete session", () => api.deleteSession(sessionId))
              }
              onClearHistory={() => runAction("Clear history", api.clearHistory)}
            />
          </div>

          <div className="space-y-4">
            <section className="glass-panel rounded-2xl p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {selectedSession?.title ?? "Meeting viewport"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedSession
                      ? `Session ${selectedSession.id}`
                      : "Select a session to inspect transcript and recap."}
                  </p>
                </div>
              </div>

              <h3 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                Transcript timeline
              </h3>
              <TranscriptTimeline
                segments={sessionDetail?.segments ?? []}
                isProcessing={selectedSession?.status === "processing"}
              />

              <h3 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                Recap
              </h3>
              <RecapPanel recapMarkdown={sessionDetail?.recapMarkdown ?? null} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

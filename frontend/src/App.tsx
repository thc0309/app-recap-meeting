import { useEffect, useState } from "react";

import * as api from "@/api/tauri";
import { Header, type AppScreen } from "@/components/Header";
import { RecapPanel } from "@/components/RecapPanel";
import { RecordingHub } from "@/components/RecordingHub";
import { Sidebar } from "@/components/Sidebar";
import { TranscriptTimeline } from "@/components/TranscriptTimeline";
import { useMeetingApp } from "@/hooks/useMeetingApp";
import { SettingsScreen } from "@/views/SettingsScreen";

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

  const [screen, setScreen] = useState<AppScreen>("meetings");
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
        screen={screen}
        ipcConnected={ipcConnected}
        isRefreshing={isRefreshing}
        modelStatus={modelStatus}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onRefresh={() => void refreshAll()}
        onDownloadModel={() => void runAction("Download default model", api.downloadDefaultModel)}
        onOpenSettings={() => setScreen("settings")}
        onBackToMeetings={() => setScreen("meetings")}
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
          onGenerateRecap={(sessionId) =>
            runAction("Generate recap", () => api.generateRecap(sessionId))
          }
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
            activeSessionId={appState?.activeSessionId ?? null}
            disabled={isProcessing}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onSelectSession={selectSession}
            onDeleteSession={(sessionId) =>
              runAction("Delete session", () => api.deleteSession(sessionId))
            }
            onClearHistory={() => runAction("Clear history", api.clearHistory)}
          />

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
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

            <section className="glass-panel min-h-0 flex-1 rounded-2xl p-5">
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
      )}
    </div>
  );
}

export default App;

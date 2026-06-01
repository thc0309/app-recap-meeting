import { CapturePanel } from "@/components/CapturePanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import type { AppSettings, CaptureStateSnapshot } from "@/types";

interface SettingsScreenProps {
  captureState: CaptureStateSnapshot | null;
  settings: AppSettings | null;
  selectedSessionId: string | null;
  disabled: boolean;
  onRequestPermission: () => Promise<unknown>;
  onSimulateLoss: (source: "system_audio" | "local_mic") => Promise<unknown>;
  onRecoverDevice: (source: "system_audio" | "local_mic") => Promise<unknown>;
  onSaveSettings: (input: {
    openaiModel: string;
    refineAfterMeeting: boolean;
    saveRawAudio: boolean;
  }) => Promise<unknown>;
  onSaveApiKey: (apiKey: string) => Promise<unknown>;
  onGenerateRecap: (sessionId: string) => Promise<unknown>;
  onExportMarkdown: (sessionId: string) => Promise<unknown>;
}

export function SettingsScreen({
  captureState,
  settings,
  selectedSessionId,
  disabled,
  onRequestPermission,
  onSimulateLoss,
  onRecoverDevice,
  onSaveSettings,
  onSaveApiKey,
  onGenerateRecap,
  onExportMarkdown,
}: SettingsScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto pb-4">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permissions, capture diagnostics, OpenAI recap, and export tools.
        </p>
      </div>

      <CapturePanel
        captureState={captureState}
        disabled={disabled}
        onRequestPermission={onRequestPermission}
        onSimulateLoss={onSimulateLoss}
        onRecoverDevice={onRecoverDevice}
      />

      <SettingsPanel
        settings={settings}
        selectedSessionId={selectedSessionId}
        disabled={disabled}
        onSaveSettings={onSaveSettings}
        onSaveApiKey={onSaveApiKey}
        onGenerateRecap={onGenerateRecap}
        onExportMarkdown={onExportMarkdown}
      />
    </div>
  );
}

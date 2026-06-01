import { FileDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { AppSettings } from "@/types";

interface SettingsPanelProps {
  settings: AppSettings | null;
  selectedSessionId: string | null;
  disabled: boolean;
  onSaveSettings: (input: {
    openaiModel: string;
    refineAfterMeeting: boolean;
    saveRawAudio: boolean;
  }) => Promise<unknown>;
  onSaveApiKey: (apiKey: string) => Promise<unknown>;
  onGenerateRecap: (sessionId: string) => Promise<unknown>;
  onExportMarkdown: (sessionId: string) => Promise<unknown>;
}

export function SettingsPanel({
  settings,
  selectedSessionId,
  disabled,
  onSaveSettings,
  onSaveApiKey,
  onGenerateRecap,
  onExportMarkdown,
}: SettingsPanelProps) {
  const [openaiModel, setOpenaiModel] = useState("gpt-4.1-mini");
  const [refineAfterMeeting, setRefineAfterMeeting] = useState(true);
  const [saveRawAudio, setSaveRawAudio] = useState(true);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!settings) {
      return;
    }
    setOpenaiModel(settings.openaiModel);
    setRefineAfterMeeting(settings.refineAfterMeeting);
    setSaveRawAudio(settings.saveRawAudio);
  }, [settings]);

  return (
    <section className="glass-panel rounded-2xl p-5">
      <h2 className="text-lg font-semibold">Settings & output</h2>

      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSaveSettings({
            openaiModel: openaiModel.trim() || "gpt-4.1-mini",
            refineAfterMeeting,
            saveRawAudio,
          });
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">OpenAI model</span>
          <input
            value={openaiModel}
            onChange={(event) => setOpenaiModel(event.target.value)}
            disabled={disabled}
            className="rounded-xl border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">OpenAI API key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={disabled}
            type="password"
            placeholder="Stored in macOS Keychain"
            className="rounded-xl border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={refineAfterMeeting}
            disabled={disabled}
            onChange={(event) => setRefineAfterMeeting(event.target.checked)}
          />
          Refine after meeting
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saveRawAudio}
            disabled={disabled}
            onChange={(event) => setSaveRawAudio(event.target.checked)}
          />
          Default save raw audio
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            Save settings
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onSaveApiKey(apiKey.trim())}
            className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            Save API key
          </button>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          disabled={disabled || !selectedSessionId}
          onClick={() => selectedSessionId && void onGenerateRecap(selectedSessionId)}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className="size-4" />
          Generate recap
        </button>
        <button
          type="button"
          disabled={disabled || !selectedSessionId}
          onClick={() => selectedSessionId && void onExportMarkdown(selectedSessionId)}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <FileDown className="size-4" />
          Export markdown
        </button>
      </div>
    </section>
  );
}

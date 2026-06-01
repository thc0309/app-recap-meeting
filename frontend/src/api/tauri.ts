import { invoke } from "@tauri-apps/api/core";

import type {
  AppStateSnapshot,
  CaptureSourceKind,
  CaptureStateSnapshot,
  CreateSessionInput,
  FinalizeSessionInput,
  ModelStatusSnapshot,
  LiveTranscriptSnapshot,
  SessionDetailSnapshot,
  UpdateSettingsInput,
  WhisperModelId,
} from "@/types";

export async function health(): Promise<string> {
  return invoke("health");
}

export async function getAppState(): Promise<AppStateSnapshot> {
  return invoke("get_app_state");
}

export async function getCaptureOverview(): Promise<CaptureStateSnapshot> {
  return invoke("get_capture_overview");
}

export async function getModelStatus(): Promise<ModelStatusSnapshot> {
  return invoke("get_model_status");
}

export async function getSessionDetail(
  sessionId: string,
): Promise<SessionDetailSnapshot> {
  return invoke("get_session_detail", { sessionId });
}

export async function getLiveTranscript(): Promise<LiveTranscriptSnapshot> {
  return invoke("get_live_transcript");
}

export async function createSession(
  input: CreateSessionInput,
): Promise<AppStateSnapshot> {
  return invoke("create_session", { input });
}

export async function recoverActiveSession(): Promise<AppStateSnapshot> {
  return invoke("recover_active_session");
}

export async function finalizeSession(
  input: FinalizeSessionInput,
): Promise<AppStateSnapshot> {
  return invoke("finalize_session", { input });
}

export async function deleteSession(sessionId: string): Promise<AppStateSnapshot> {
  return invoke("delete_session", { sessionId });
}

export async function clearHistory(): Promise<AppStateSnapshot> {
  return invoke("clear_history");
}

export async function requestSystemAudioPermission(): Promise<CaptureStateSnapshot> {
  return invoke("request_system_audio_permission");
}

export async function simulateDeviceLoss(
  sourceKind: CaptureSourceKind,
): Promise<CaptureStateSnapshot> {
  return invoke("simulate_device_loss", { sourceKind });
}

export async function recoverCaptureDevice(
  sourceKind: CaptureSourceKind,
): Promise<CaptureStateSnapshot> {
  return invoke("recover_capture_device", { sourceKind });
}

export async function updateSettings(
  input: UpdateSettingsInput,
): Promise<AppStateSnapshot> {
  return invoke("update_settings", { input });
}

export async function saveOpenAiApiKey(apiKey: string): Promise<void> {
  return invoke("save_openai_api_key", { apiKey });
}

export async function selectWhisperModel(
  modelId: WhisperModelId,
): Promise<AppStateSnapshot> {
  return invoke("select_whisper_model", { modelId });
}

export async function downloadWhisperModel(modelId: WhisperModelId): Promise<void> {
  return invoke("download_whisper_model", { modelId });
}

export async function generateRecap(sessionId: string): Promise<AppStateSnapshot> {
  return invoke("generate_recap", { sessionId });
}

export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  return invoke("export_session_markdown", { sessionId });
}

export function isTauriAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

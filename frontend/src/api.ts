import type {
  LiveSessionStartResponse,
  LiveSessionState,
  Meeting,
  NativeAudioDevice,
  NativeAudioSupport,
  NativeCaptureSessionState,
  NativeCaptureTarget,
  RecapResponse,
  StartNativeCaptureRequest,
  TranscriptSegment
} from "./types";

const API_BASE = "http://127.0.0.1:8000/api";

async function invokeTauri<T>(command: string): Promise<T | null> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return (await mod.invoke(command)) as T;
  } catch {
    return null;
  }
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Request failed");
  }
  return response.json() as Promise<T>;
}

export async function fetchMeetings(): Promise<Meeting[]> {
  return handle<Meeting[]>(await fetch(`${API_BASE}/meetings`));
}

export async function fetchHealth(): Promise<{ status: string }> {
  return handle<{ status: string }>(await fetch(`${API_BASE}/health`));
}

export async function fetchBackendStartupError(): Promise<string | null> {
  return invokeTauri<string | null>("get_backend_startup_error");
}

export async function fetchNativeAudioSupport(): Promise<NativeAudioSupport | null> {
  return invokeTauri<NativeAudioSupport>("native_audio_support");
}

export async function fetchNativeAudioInputs(): Promise<NativeAudioDevice[] | null> {
  return invokeTauri<NativeAudioDevice[]>("native_audio_inputs");
}

export async function fetchNativeAudioTargets(): Promise<NativeCaptureTarget[] | null> {
  return invokeTauri<NativeCaptureTarget[]>("native_audio_targets");
}

export async function fetchNativeAudioState(): Promise<NativeCaptureSessionState | null> {
  return invokeTauri<NativeCaptureSessionState | null>("native_audio_state");
}

export async function startNativeAudioCapture(
  payload: StartNativeCaptureRequest
): Promise<NativeCaptureSessionState | null> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return (await mod.invoke("start_native_audio_capture", { payload })) as NativeCaptureSessionState;
  } catch {
    return null;
  }
}

export async function stopNativeAudioCapture(): Promise<NativeCaptureSessionState | null> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return (await mod.invoke("stop_native_audio_capture")) as NativeCaptureSessionState;
  } catch {
    return null;
  }
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await handle(await fetch(`${API_BASE}/meetings/${meetingId}`, { method: "DELETE" }));
}

export async function deleteAllMeetings(): Promise<void> {
  await handle(await fetch(`${API_BASE}/meetings`, { method: "DELETE" }));
}

export async function createMeeting(payload: {
  title: string;
  source_path?: string | null;
  model_name?: string;
}): Promise<Meeting> {
  return handle<Meeting>(
    await fetch(`${API_BASE}/meetings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function importMeetingFile(payload: {
  title?: string;
  file: File;
  model_name?: string;
}): Promise<Meeting> {
  const formData = new FormData();
  formData.append("file", payload.file);
  if (payload.title?.trim()) {
    formData.append("title", payload.title.trim());
  }
  if (payload.model_name?.trim()) {
    formData.append("model_name", payload.model_name.trim());
  }

  return handle<Meeting>(
    await fetch(`${API_BASE}/meetings/import`, {
      method: "POST",
      body: formData
    })
  );
}

export async function startLiveSession(payload: {
  title: string;
  model_name?: string;
}): Promise<LiveSessionStartResponse> {
  return handle<LiveSessionStartResponse>(
    await fetch(`${API_BASE}/live-sessions/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function fetchLiveSession(meetingId: string): Promise<LiveSessionState> {
  return handle<LiveSessionState>(await fetch(`${API_BASE}/live-sessions/${meetingId}`));
}

export async function runTranscription(meetingId: string): Promise<void> {
  await handle(await fetch(`${API_BASE}/meetings/${meetingId}/transcribe`, { method: "POST" }));
}

export async function runRecap(meetingId: string): Promise<RecapResponse> {
  return handle<RecapResponse>(
    await fetch(`${API_BASE}/meetings/${meetingId}/recap`, { method: "POST" })
  );
}

export async function fetchSegments(meetingId: string): Promise<TranscriptSegment[]> {
  return handle<TranscriptSegment[]>(await fetch(`${API_BASE}/meetings/${meetingId}/segments`));
}

export async function fetchRecap(meetingId: string): Promise<RecapResponse> {
  return handle<RecapResponse>(await fetch(`${API_BASE}/meetings/${meetingId}/recap`));
}

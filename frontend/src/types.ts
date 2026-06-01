export type SessionStatus =
  | "recording"
  | "recovered"
  | "processing"
  | "done"
  | "recap_done"
  | "error";

export type TranscriptMode = "static_source_label" | "final_speaker_labels";

export type RemoteSpeakerLabelState =
  | "source_only"
  | "post_meeting_pending"
  | "final_labels_applied";

export type CaptureSourceKind = "local_mic" | "system_audio";

export type CapturePermissionState =
  | "not_required"
  | "unknown"
  | "requested"
  | "granted"
  | "denied";

export type CaptureDeviceState =
  | "idle"
  | "ready"
  | "capturing"
  | "permission_blocked"
  | "device_lost"
  | "error";

export type RecapProvider = "open_ai";

export interface AppSettings {
  recapProvider: RecapProvider;
  openaiModel: string;
  refineAfterMeeting: boolean;
  saveRawAudio: boolean;
  dataDirectory: string;
}

export interface MeetingSession {
  id: string;
  title: string;
  status: SessionStatus;
  transcriptMode: TranscriptMode;
  remoteSpeakerLabelState: RemoteSpeakerLabelState;
  saveRawAudio: boolean;
  refineEnabled: boolean;
  startedAtUnixMs: number;
  endedAtUnixMs: number | null;
  sessionDir: string;
  micAudioPath: string;
  systemAudioPath: string;
  transcriptPath: string;
  recapPath: string;
}

export interface CaptureSource {
  kind: CaptureSourceKind;
  displayName: string;
  backend: string;
  permissionState: CapturePermissionState;
  deviceState: CaptureDeviceState;
  boundSessionId: string | null;
  lastError: string | null;
}

export interface CaptureStateSnapshot {
  platformName: string;
  systemAudioBackend: string;
  supportsSystemAudio: boolean;
  requiresExplicitPermission: boolean;
  supportsMidSessionDeviceRecovery: boolean;
  sources: CaptureSource[];
}

export interface AppStateSnapshot {
  activeSessionId: string | null;
  capture: CaptureStateSnapshot;
  settings: AppSettings;
  sessions: MeetingSession[];
}

export interface ModelStatusSnapshot {
  defaultModelPath: string;
  defaultModelExists: boolean;
  isDownloading: boolean;
}

export interface TranscriptSegment {
  id: string;
  sourceType: string;
  speakerLabel: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
}

export interface SessionDetailSnapshot {
  segments: TranscriptSegment[];
  recapMarkdown: string | null;
}

export interface CreateSessionInput {
  title: string | null;
  saveRawAudio: boolean;
  refineRequested: boolean;
}

export interface FinalizeSessionInput {
  sessionId: string;
  runRefine: boolean;
  generateRecap: boolean;
}

export interface UpdateSettingsInput {
  openaiModel: string;
  refineAfterMeeting: boolean;
  saveRawAudio: boolean;
}

export type StatusKind = "info" | "success" | "error";

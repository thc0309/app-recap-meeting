export type MeetingStatus =
  | "draft"
  | "recording"
  | "finalizing"
  | "transcribing"
  | "transcribed"
  | "generating_recap"
  | "recap_ready"
  | "failed";

export interface Meeting {
  id: string;
  title: string;
  source_path: string | null;
  status: MeetingStatus;
  transcript_path: string | null;
  transcript_text_path: string | null;
  recap_json_path: string | null;
  recap_markdown_path: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegment {
  start_sec: number;
  end_sec: number;
  speaker_label: string | null;
  text: string;
}

export interface ActionItem {
  owner?: string | null;
  task: string;
  deadline?: string | null;
}

export interface RecapPayload {
  summary: string;
  key_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
}

export interface RecapResponse {
  meeting_id: string;
  recap: RecapPayload;
  created_at: string;
}

export interface LiveSessionState {
  meeting_id: string;
  title: string;
  status: string;
  seconds_recorded: number;
  chunk_count: number;
  has_microphone: boolean;
  has_system_audio: boolean;
  transcript_ready: boolean;
  recap_ready: boolean;
  partial_transcript: string | null;
  partial_updated_at: string | null;
  last_error: string | null;
}

export interface LiveSessionStartResponse {
  meeting: Meeting;
  websocket_url: string;
  chunk_sample_rate: number;
  chunk_channels: number;
}

export type NativeCaptureMode = "screenShareMix" | "audioInputOnly" | "appAudioAndMic";

export type NativeAudioDeviceKind = "input" | "aggregate" | "virtualLoopback";

export type NativeCaptureTargetKind = "browser" | "meetingApp" | "systemAudio";

export interface NativeAudioDevice {
  id: string;
  name: string;
  kind: NativeAudioDeviceKind;
  isDefault: boolean;
  channels: number;
}

export interface NativeCaptureTarget {
  id: string;
  name: string;
  bundleId: string | null;
  pid: number | null;
  kind: NativeCaptureTargetKind;
}

export interface NativeAudioSupport {
  platform: string;
  nativeCaptureAvailable: boolean;
  supportsAppAudioCapture: boolean;
  supportsMicrophoneMix: boolean;
  recommendedMode: NativeCaptureMode;
  notes: string[];
}

export interface NativeCaptureSessionState {
  active: boolean;
  title: string | null;
  mode: NativeCaptureMode | null;
  selectedInput: NativeAudioDevice | null;
  selectedTarget: NativeCaptureTarget | null;
  includeMicrophone: boolean;
  status: string;
  outputPath: string | null;
  sampleRate: number;
  channels: number;
  lastError: string | null;
}

export interface StartNativeCaptureRequest {
  title: string;
  mode: NativeCaptureMode;
  inputDeviceId?: string | null;
  targetId?: string | null;
  includeMicrophone: boolean;
}

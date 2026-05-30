import { FormEvent, useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  deleteAllMeetings,
  deleteMeeting,
  fetchBackendStartupError,
  fetchHealth,
  fetchMeetings,
  fetchLiveSession,
  importMeetingFile,
  fetchRecap,
  fetchSegments,
  runRecap,
  runTranscription,
  startLiveSession
} from "./api";
import type {
  LiveSessionState,
  LiveSessionStartResponse,
  Meeting,
  RecapResponse,
  TranscriptSegment
} from "./types";

type MicrophonePermissionState = "checking" | "granted" | "prompt" | "denied" | "unsupported";
type AudioCaptureMode = "screen-share" | "audio-input";

interface AudioInputOption {
  deviceId: string;
  label: string;
}

type AudioInputPreset = "blackhole-only" | "aggregate-device";

function formatSeconds(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function downsampleTo16k(input: Float32Array, sourceRate: number): Int16Array {
  if (sourceRate === 16000) {
    const direct = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      direct[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return direct;
  }

  const ratio = sourceRate / 16000;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < output.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i += 1) {
      accum += input[i];
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, accum / Math.max(1, count)));
    output[offsetResult] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

function int16ToBase64(samples: Int16Array): string {
  const view = new Uint8Array(samples.buffer);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]);
  }
  return window.btoa(binary);
}

function permissionLabel(state: MicrophonePermissionState): string {
  switch (state) {
    case "granted":
      return "Da cap";
    case "prompt":
      return "Se hoi khi start";
    case "denied":
      return "Da bi tu choi";
    case "unsupported":
      return "Khong doc duoc";
    default:
      return "Dang kiem tra";
  }
}

function findAudioInputByPreset(
  inputs: AudioInputOption[],
  preset: AudioInputPreset
): AudioInputOption | null {
  const normalized = inputs.map((input) => ({
    ...input,
    search: input.label.toLowerCase()
  }));

  if (preset === "blackhole-only") {
    return (
      normalized.find(
        (input) => input.search.includes("blackhole") && !input.search.includes("aggregate")
      ) ?? null
    );
  }

  return (
    normalized.find(
      (input) =>
        input.search.includes("aggregate") &&
        (input.search.includes("blackhole") ||
          input.search.includes("microphone") ||
          input.search.includes("mic"))
    ) ?? normalized.find((input) => input.search.includes("aggregate")) ?? null
  );
}

function describePartialSource(
  captureMode: AudioCaptureMode,
  inputLabel: string,
  liveState: LiveSessionState | null
): string {
  if (captureMode === "audio-input") {
    return `Nguon live hien tai: audio input "${inputLabel}". Partial transcript dang nghe truc tiep tu input nay.`;
  }

  if (liveState?.has_system_audio) {
    return `Nguon live hien tai: mix giua microphone va system audio tu screen share.`;
  }

  return `Nguon live hien tai: microphone. Neu ban share Entire screen tren macOS thi system audio co the khong duoc cap.`;
}

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Ban da tu choi microphone hoac screen share. Hay cap quyen microphone va chon tab/window/screen co bat audio, sau do thu lai.";
      case "NotFoundError":
        return "Khong tim thay microphone phu hop. Hay kiem tra mic dang duoc ket noi va khong bi tat.";
      case "NotReadableError":
        return "Khong doc duoc microphone hoac system audio. Tren macOS, hay kiem tra quyen Screen & System Audio Recording cho app/browser.";
      case "AbortError":
        return "Qua trinh xin quyen bi huy giua chung. Hay bam Start live meeting va thu lai.";
      case "InvalidStateError":
        return "Browser yeu cau viec share man hinh phai bat dau tu thao tac nguoi dung. Hay bam Start live meeting lai.";
      default:
        return error.message || "Khong the truy cap microphone/system audio.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Khong the truy cap microphone/system audio.";
}

export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>("checking");
  const [audioCaptureMode, setAudioCaptureMode] = useState<AudioCaptureMode>("screen-share");
  const [audioInputs, setAudioInputs] = useState<AudioInputOption[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("");
  const [activeCaptureMode, setActiveCaptureMode] = useState<AudioCaptureMode | null>(null);
  const [activeInputLabel, setActiveInputLabel] = useState<string>("");
  const [liveState, setLiveState] = useState<LiveSessionState | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>("Dang khoi dong backend local...");
  const [partialTranscript, setPartialTranscript] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const pollingRef = useRef<number | null>(null);

  async function refreshMediaPermissions() {
    if (!navigator.permissions?.query) {
      setMicrophonePermission("unsupported");
      return;
    }

    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName
      });
      setMicrophonePermission(status.state as MicrophonePermissionState);
      status.onchange = () => {
        setMicrophonePermission(status.state as MicrophonePermissionState);
      };
    } catch {
      setMicrophonePermission("unsupported");
    }
  }

  async function refreshAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputs([]);
      setSelectedAudioInputId("");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio input ${index + 1}`
        }));

      setAudioInputs(nextInputs);
      setSelectedAudioInputId((current) => {
        if (current && nextInputs.some((input) => input.deviceId === current)) {
          return current;
        }
        return nextInputs[0]?.deviceId ?? "";
      });
    } catch {
      setAudioInputs([]);
    }
  }

  async function refreshMeetings(selectFirst = false) {
    const next = await fetchMeetings();
    setMeetings(next);
    if ((selectFirst || !selectedMeetingId) && next.length > 0) {
      setSelectedMeetingId(next[0].id);
    }
    return next;
  }

  async function refreshMeetingArtifacts(meeting: Meeting) {
    const nextSegments = await fetchSegments(meeting.id).catch(() => []);
    setSegments(nextSegments);
    if (meeting.status === "recap_ready") {
      const nextRecap = await fetchRecap(meeting.id).catch(() => null);
      setRecap(nextRecap);
      return;
    }
    setRecap(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setError(null);
      setLiveMessage("Dang khoi dong backend local...");

      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          await fetchHealth();
          if (cancelled) return;
          setBackendReady(true);
          setLiveMessage("Backend local da san sang.");
          await refreshMeetings(true);
          return;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 750));
        }
      }

      if (!cancelled) {
        setBackendReady(false);
        const startupError = await fetchBackendStartupError();
        setError(
          startupError ||
            "Backend local chua san sang. Kiem tra Tauri sidecar hoac backend/.venv."
        );
      }
    }

    bootstrap().catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshMediaPermissions().catch(() => setMicrophonePermission("unsupported"));
    refreshAudioInputs().catch(() => setAudioInputs([]));

    const handleFocus = () => {
      refreshMediaPermissions().catch(() => setMicrophonePermission("unsupported"));
      refreshAudioInputs().catch(() => setAudioInputs([]));
    };

    window.addEventListener("focus", handleFocus);
    navigator.mediaDevices?.addEventListener?.("devicechange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!selectedMeetingId) {
      setSegments([]);
      setRecap(null);
      setPartialTranscript("");
      return;
    }
    const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId);
    if (!selectedMeeting) {
      setSegments([]);
      setRecap(null);
      return;
    }
    refreshMeetingArtifacts(selectedMeeting).catch(() => {
      setSegments([]);
      setRecap(null);
    });
  }, [meetings, selectedMeetingId]);

  useEffect(() => {
    return () => {
      cleanupRealtimeResources();
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, []);

  function cleanupRealtimeResources() {
    processorRef.current?.disconnect();
    destinationRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => undefined);
    processorRef.current = null;
    destinationRef.current = null;
    audioContextRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    displayStreamRef.current = null;
  }

  function applyAudioInputPreset(preset: AudioInputPreset) {
    const matched = findAudioInputByPreset(audioInputs, preset);
    setAudioCaptureMode("audio-input");
    if (!matched) {
      setError(
        preset === "blackhole-only"
          ? "Khong tim thay input BlackHole. Hay kiem tra BlackHole da duoc cai va xuat hien trong Audio MIDI Setup."
          : "Khong tim thay Aggregate Device phu hop. Hay tao Aggregate Device gom BlackHole va microphone truoc."
      );
      return;
    }

    setError(null);
    setSelectedAudioInputId(matched.deviceId);
    setLiveMessage(
      preset === "blackhole-only"
        ? `Da chon preset BlackHole only: ${matched.label}`
        : `Da chon preset Aggregate Device: ${matched.label}`
    );
  }

  async function onCreateMeeting(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Chon file truoc khi tao file-based session.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meeting = await importMeetingFile({ title, file: selectedFile });
      setTitle("");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refreshMeetings(true);
      setSelectedMeetingId(meeting.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRunTranscription() {
    if (!selectedMeetingId) return;
    setBusy(true);
    setError(null);
    try {
      await runTranscription(selectedMeetingId);
      const nextMeetings = await refreshMeetings();
      const meeting = nextMeetings.find((item) => item.id === selectedMeetingId);
      if (meeting) {
        await refreshMeetingArtifacts(meeting);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRunRecap() {
    if (!selectedMeetingId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runRecap(selectedMeetingId);
      setRecap(result);
      await refreshMeetings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteMeeting() {
    if (!selectedMeetingId || !selectedMeeting) return;
    const confirmed = await ask(`Xoa session "${selectedMeeting.title}"?`, {
      title: "Confirm delete",
      kind: "warning"
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      await deleteMeeting(selectedMeetingId);
      if (liveState?.meeting_id === selectedMeetingId) {
        cleanupRealtimeResources();
        setLiveState(null);
        setActiveCaptureMode(null);
        setActiveInputLabel("");
        setLiveMessage("Da xoa session vua chon.");
        setPartialTranscript("");
      }
      setSegments([]);
      setRecap(null);
      setSelectedMeetingId(null);
      await refreshMeetings(true);
      setLiveMessage("Da xoa session.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAllMeetings() {
    if (meetings.length === 0) return;
    const confirmed = await ask(`Xoa toan bo ${meetings.length} session?`, {
      title: "Confirm delete all",
      kind: "warning"
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      cleanupRealtimeResources();
      await deleteAllMeetings();
      setLiveState(null);
      setActiveCaptureMode(null);
      setActiveInputLabel("");
      setLiveMessage("Da xoa toan bo session.");
      setPartialTranscript("");
      setSegments([]);
      setRecap(null);
      setSelectedMeetingId(null);
      await refreshMeetings(true);
      setLiveMessage("Da xoa tat ca session.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function beginLiveCapture(
    liveSession: LiveSessionStartResponse,
    micStream: MediaStream,
    displayStream: MediaStream | null,
    captureMode: AudioCaptureMode,
    inputLabel: string
  ) {
    const hasDisplayAudio = Boolean(displayStream?.getAudioTracks().length);

    micStreamRef.current = micStream;
    displayStreamRef.current = displayStream;

    const audioContext = new AudioContext({ sampleRate: 48000 });
    audioContextRef.current = audioContext;
    const destination = audioContext.createMediaStreamDestination();
    destinationRef.current = destination;

    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
    if (displayStream && hasDisplayAudio) {
      const displaySource = audioContext.createMediaStreamSource(displayStream);
      displaySource.connect(destination);
    } else if (captureMode === "screen-share") {
      setLiveMessage(
        "Dang ghi mic-only. macOS thuong khong tra system audio khi share Entire screen; neu can tieng tu may, hay share tab/window co audio."
      );
    } else {
      setLiveMessage(`Dang ghi realtime tu audio input: ${inputLabel}.`);
    }

    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const mixedSource = audioContext.createMediaStreamSource(destination.stream);
    mixedSource.connect(processor);
    processor.connect(audioContext.destination);

    const websocket = new WebSocket(liveSession.websocket_url);
    wsRef.current = websocket;

    websocket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as
        | {
            type: string;
            detail?: string;
            phase?: string;
            message?: string;
            text?: string;
            secondsRecorded?: number;
            chunkCount?: number;
            hasMicrophone?: boolean;
            hasSystemAudio?: boolean;
            state?: LiveSessionState;
          }
        | undefined;

      if (!message) return;
      if (message.type === "session_ready") {
        setLiveMessage(
          captureMode === "audio-input"
            ? `Dang ghi realtime tu audio input: ${inputLabel}.`
            : "Dang ghi am va stream du lieu realtime len backend..."
        );
      }
      if (message.type === "recording_progress") {
        setLiveState({
          meeting_id: liveSession.meeting.id,
          title: liveSession.meeting.title,
          status: "recording",
          seconds_recorded: message.secondsRecorded ?? 0,
          chunk_count: message.chunkCount ?? 0,
          has_microphone: message.hasMicrophone ?? true,
          has_system_audio: message.hasSystemAudio ?? true,
          transcript_ready: false,
          recap_ready: false,
          partial_transcript: null,
          partial_updated_at: null,
          last_error: null
        });
      }
      if (message.type === "partial_transcript" && message.state) {
        setLiveState(message.state);
        setPartialTranscript(message.text ?? "");
        setLiveMessage("Dang cap nhat partial transcript moi 3 giay...");
      }
      if (message.type === "processing_started") {
        setLiveMessage("Da stop ghi am. Backend dang transcribe va tao recap...");
      }
      if (message.type === "processing_update" && message.state) {
        setLiveState(message.state);
        setLiveMessage(message.message ?? "Dang xu ly sau khi stop meeting...");
      }
      if (message.type === "processing_finished" && message.state) {
        setLiveState(message.state);
        setLiveMessage("Da hoan tat transcript va recap.");
        if (pollingRef.current) {
          window.clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        const nextMeetings = await refreshMeetings();
        const meeting = nextMeetings.find((item) => item.id === message.state?.meeting_id);
        if (meeting) {
          await refreshMeetingArtifacts(meeting);
        }
        setPartialTranscript("");
        setBusy(false);
      }
      if (message.type === "error") {
        setError(message.detail ?? "Live session error");
        setLiveMessage("Session bi loi.");
      }
    };

    processor.onaudioprocess = (event) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const floatData = event.inputBuffer.getChannelData(0);
      const pcm16 = downsampleTo16k(floatData, event.inputBuffer.sampleRate);
      wsRef.current.send(
        JSON.stringify({
          type: "audio_chunk",
          source: "mixed",
          payload: int16ToBase64(pcm16)
        })
      );
    };

    const displayTrack = displayStream?.getVideoTracks()[0];
    if (displayTrack) {
      displayTrack.addEventListener("ended", () => {
        setLiveMessage("Screen share da dung. Bam Stop Meeting de chot transcript.");
      });
    }
  }

  async function onStartLiveMeeting() {
    if (!title.trim()) {
      setError("Nhap title truoc khi Start.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Webview hien tai khong ho tro navigator.mediaDevices.getUserMedia. Tren macOS, hay rebuild app sau khi them quyen microphone vao Tauri Info.plist."
      );
      return;
    }
    if (audioCaptureMode === "screen-share" && !navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Webview hien tai khong ho tro navigator.mediaDevices.getDisplayMedia. System audio va screen share hien chua san sang trong app nay."
      );
      return;
    }
    if (microphonePermission === "denied") {
      setError(
        "Quyen microphone dang bi tu choi. Hay mo quyen microphone cho app/browser roi thu lai."
      );
      return;
    }
    setBusy(true);
    setError(null);
    setLiveMessage(
      audioCaptureMode === "audio-input"
        ? "Dang xin quyen audio input tu macOS..."
        : "Dang xin quyen microphone va share audio tu may..."
    );
    try {
      const audioConstraints: MediaTrackConstraints =
        audioCaptureMode === "audio-input"
          ? {
              deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 1
            }
          : {
              deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            };

      const micStreamPromise = navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const displayStreamPromise =
        audioCaptureMode === "screen-share"
          ? navigator.mediaDevices.getDisplayMedia({
              audio: true,
              video: true
            })
          : Promise.resolve<MediaStream | null>(null);

      const [micStream, displayStream] = await Promise.all([micStreamPromise, displayStreamPromise]);
      const liveSession = await startLiveSession({ title });
      const inputLabel =
        audioInputs.find((input) => input.deviceId === selectedAudioInputId)?.label || "macOS default";
      setActiveCaptureMode(audioCaptureMode);
      setActiveInputLabel(inputLabel);
      setSelectedMeetingId(liveSession.meeting.id);
      setLiveState({
        meeting_id: liveSession.meeting.id,
        title: liveSession.meeting.title,
        status: "recording",
        seconds_recorded: 0,
        chunk_count: 0,
        has_microphone: false,
        has_system_audio: false,
        transcript_ready: false,
        recap_ready: false,
        partial_transcript: null,
        partial_updated_at: null,
        last_error: null
      });
      setPartialTranscript("");
      await refreshMeetings(true);
      await beginLiveCapture(liveSession, micStream, displayStream, audioCaptureMode, inputLabel);
      await refreshMediaPermissions();
      await refreshAudioInputs();
    } catch (err) {
      cleanupRealtimeResources();
      setActiveCaptureMode(null);
      setActiveInputLabel("");
      setError(describeMediaError(err));
      setLiveMessage("Khong the bat realtime meeting.");
    } finally {
      setBusy(false);
    }
  }

  async function onStopLiveMeeting() {
    if (!wsRef.current || !selectedMeetingId) return;
    setBusy(true);
    setLiveMessage("Dang dong session va gui xu ly transcript...");
    try {
      cleanupRealtimeResources();
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
      pollingRef.current = window.setInterval(async () => {
        const nextState = await fetchLiveSession(selectedMeetingId).catch(() => null);
        if (!nextState) return;
        setLiveState(nextState);
        if (nextState.recap_ready || nextState.status === "failed") {
          if (pollingRef.current) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          const nextMeetings = await refreshMeetings();
          const meeting = nextMeetings.find((item) => item.id === selectedMeetingId);
          if (meeting) {
            await refreshMeetingArtifacts(meeting);
          }
          setBusy(false);
        }
      }, 2000);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null;
  const selectedAudioInputLabel =
    audioInputs.find((input) => input.deviceId === selectedAudioInputId)?.label ?? "macOS default";
  const effectiveCaptureMode = activeCaptureMode ?? audioCaptureMode;
  const effectiveInputLabel = activeInputLabel || selectedAudioInputLabel;
  const partialSourceDescription = describePartialSource(
    effectiveCaptureMode,
    effectiveInputLabel,
    liveState
  );
  const isRecording = liveState?.status === "recording";
  const isProcessingLive =
    liveState?.status === "finalizing" ||
    liveState?.status === "transcribing" ||
    liveState?.status === "generating_recap";
  const canRunTranscript = Boolean(
    backendReady && selectedMeetingId && selectedMeeting?.source_path && !isRecording
  );
  const canRunRecap = Boolean(backendReady && !busy && segments.length > 0);
  const canDeleteMeeting = Boolean(
    selectedMeetingId &&
      !busy &&
      !(liveState?.meeting_id === selectedMeetingId && (isRecording || isProcessingLive))
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Meeting Recap</p>
          <h1>Sessions</h1>
        </div>
        <div className="button-row top-actions">
          <button
            className="danger-button"
            disabled={busy || meetings.length === 0 || isRecording || isProcessingLive}
            onClick={onDeleteAllMeetings}
            type="button"
          >
            Xoa tat ca
          </button>
        </div>

        <div className="card form-stack">
          <div className="permission-header">
            <strong>Media permissions</strong>
            <button disabled={busy} onClick={() => refreshMediaPermissions()} type="button">
              Kiem tra quyen
            </button>
          </div>
          <div className="permission-grid">
            <div className="permission-item">
              <span>Microphone</span>
              <strong
                className={`permission-badge permission-${microphonePermission}`}
              >
                {permissionLabel(microphonePermission)}
              </strong>
            </div>
            <div className="permission-item">
              <span>System audio</span>
              <strong className="permission-badge permission-prompt">Chon khi Start</strong>
            </div>
          </div>
          <p className="muted">
            Tren macOS, hay cap quyen microphone va Screen & System Audio Recording cho app/browser.
            Khi share, uu tien Chrome tab hoac window co bat audio.
          </p>
        </div>

        <div className="card form-stack">
          <label>
            Meeting title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Capture mode
            <select
              value={audioCaptureMode}
              onChange={(event) => setAudioCaptureMode(event.target.value as AudioCaptureMode)}
            >
              <option value="screen-share">Microphone + screen share audio</option>
              <option value="audio-input">Audio input device (BlackHole / Aggregate Device)</option>
            </select>
          </label>
          <label>
            Audio input device
            <select
              value={selectedAudioInputId}
              onChange={(event) => setSelectedAudioInputId(event.target.value)}
              disabled={audioInputs.length === 0}
            >
              {audioInputs.length === 0 ? (
                <option value="">Khong tim thay audio input</option>
              ) : null}
              {audioInputs.map((input) => (
                <option key={input.deviceId} value={input.deviceId}>
                  {input.label}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              disabled={busy || audioInputs.length === 0}
              onClick={() => applyAudioInputPreset("blackhole-only")}
              type="button"
            >
              Preset: BlackHole only
            </button>
            <button
              disabled={busy || audioInputs.length === 0}
              onClick={() => applyAudioInputPreset("aggregate-device")}
              type="button"
            >
              Preset: Aggregate Device
            </button>
          </div>
          <div className="button-row">
            <button
              disabled={busy || isRecording || !backendReady}
              onClick={onStartLiveMeeting}
              type="button"
            >
              Start live meeting
            </button>
            <button disabled={busy || !isRecording} onClick={onStopLiveMeeting} type="button">
              Stop meeting
            </button>
          </div>
          <div className="source-chip-row">
            <span className="source-chip">
              Mode: {effectiveCaptureMode === "audio-input" ? "Audio input" : "Screen share mix"}
            </span>
            <span className="source-chip">Input: {effectiveInputLabel}</span>
          </div>
          <p className="muted">
            {audioCaptureMode === "audio-input"
              ? `Dang chon input: ${selectedAudioInputLabel}. Tren macOS, neu muon vua lay system audio vua lay mic, hay tao Aggregate Device gom BlackHole va microphone roi chon no o day.`
              : "Web se xin quyen microphone va yeu cau ban share tab/window/screen co bat audio."}
          </p>
        </div>

        <form className="card form-stack" onSubmit={onCreateMeeting}>
          <label>
            Import source file
            <input
              ref={fileInputRef}
              accept="audio/*,video/*,.mkv,.mp4,.mov,.mp3,.wav,.m4a"
              className="file-input"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <div className="file-picker-row">
            <button
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Chọn file
            </button>
            <span className="file-name">{selectedFile?.name ?? "Chưa chọn file nào"}</span>
          </div>
          <p className="muted">
            File sẽ được upload vào backend local. Nếu để trống title, app sẽ dùng tên file.
          </p>
          <button disabled={busy || !backendReady} type="submit">
            Create file-based session
          </button>
        </form>

        <div className="session-list">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              className={`session-item ${meeting.id === selectedMeetingId ? "active" : ""}`}
              onClick={() => setSelectedMeetingId(meeting.id)}
            >
              <strong>{meeting.title}</strong>
              <span>{meeting.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="main-pane">
        {error ? <div className="error-banner">{error}</div> : null}
        <section className="hero card">
          <div>
            <p className="eyebrow">Realtime status</p>
            <h2>{selectedMeeting?.title ?? "Chua chon session"}</h2>
            <p className="muted">{liveMessage}</p>
          </div>
          <div className="metrics">
            <div>
              <strong>{liveState ? formatSeconds(liveState.seconds_recorded) : "00:00"}</strong>
              <span>Recorded</span>
            </div>
            <div>
              <strong>{liveState?.chunk_count ?? 0}</strong>
              <span>Chunks</span>
            </div>
            <div>
              <strong>{liveState?.has_system_audio ? "Yes" : "No"}</strong>
              <span>System audio</span>
            </div>
            <div>
              <strong>{effectiveCaptureMode === "audio-input" ? "Input" : "Mix"}</strong>
              <span>Capture mode</span>
            </div>
            <div>
              <strong>{liveState?.status ?? "idle"}</strong>
              <span>Phase</span>
            </div>
          </div>
        </section>

        {selectedMeeting ? (
          <>
            <section className="hero card compact">
              <div>
                <p className="eyebrow">Selected session</p>
                <h2>{selectedMeeting.title}</h2>
                <p className="muted">
                  {selectedMeeting.source_path ??
                    "Realtime capture session. Bam Stop meeting de finalize audio truoc khi chay transcript."}
                </p>
              </div>
              <div className="actions">
                <button disabled={busy || isProcessingLive || !canRunTranscript} onClick={onRunTranscription}>
                  Run transcript
                </button>
                <button disabled={isProcessingLive || !canRunRecap} onClick={onRunRecap}>
                  Generate recap
                </button>
                <button
                  className="danger-button"
                  disabled={!canDeleteMeeting}
                  onClick={onDeleteMeeting}
                  type="button"
                >
                  Delete session
                </button>
              </div>
            </section>

            <section className="content-stack">
              <div className="card transcript-card">
                <div className="section-header">
                  <h3>Transcript</h3>
                  <span>{segments.length} segments</span>
                </div>
                <div className="partial-box">
                  <div className="section-header">
                    <h4>Partial live transcript</h4>
                    <span>{liveState?.partial_updated_at ? "live" : "waiting"}</span>
                  </div>
                  <p className="muted source-note">{partialSourceDescription}</p>
                  <p>
                    {partialTranscript ||
                      "Chua co partial transcript. Sau khi ghi du khoang 3 giay audio, text live se hien o day."}
                  </p>
                </div>
                <div className="segment-list">
                  {segments.length === 0 ? (
                    <p className="muted">Chua co transcript.</p>
                  ) : (
                    segments.map((segment, index) => (
                      <div className="segment" key={`${segment.start_sec}-${index}`}>
                        <span className="time">
                          {formatSeconds(segment.start_sec)} - {formatSeconds(segment.end_sec)}
                        </span>
                        <p>{segment.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card recap-card">
                <div className="section-header">
                  <h3>Recap</h3>
                  <span>{recap ? "ready" : "not generated"}</span>
                </div>
                {recap ? (
                  <div className="recap-stack">
                    <section>
                      <h4>Summary</h4>
                      <p>{recap.recap.summary}</p>
                    </section>
                    <section>
                      <h4>Key points</h4>
                      <ul>
                        {recap.recap.key_points.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h4>Decisions</h4>
                      <ul>
                        {recap.recap.decisions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h4>Action items</h4>
                      <ul>
                        {recap.recap.action_items.map((item) => (
                          <li key={item.task}>{item.task}</li>
                        ))}
                      </ul>
                    </section>
                  </div>
                ) : (
                  <p className="muted">Chua co recap cho session nay.</p>
                )}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state card">
            <h2>Chua co session nao</h2>
            <p>Bat dau meeting realtime hoac tao session file-based de tiep tuc.</p>
          </div>
        )}
      </main>
    </div>
  );
}

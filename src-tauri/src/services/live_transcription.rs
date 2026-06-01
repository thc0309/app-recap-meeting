use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::{
    services::transcription::{resample_linear, WHISPER_SAMPLE_RATE},
    state::transcript::TranscriptSegment,
};

const MIN_LIVE_SAMPLES: usize = WHISPER_SAMPLE_RATE as usize * 2;
const LIVE_POLL_SECONDS: u64 = 5;

static WHISPER_CACHE: Mutex<Option<(String, WhisperContext)>> = Mutex::new(None);

#[derive(Clone, Debug)]
pub struct LiveTranscriptionSession {
    pub session_id: String,
    pub mic_audio_path: PathBuf,
    pub system_audio_path: PathBuf,
    pub segments: Vec<TranscriptSegment>,
    pub mic_samples_processed: u64,
    pub system_samples_processed: u64,
}

impl LiveTranscriptionSession {
    pub fn new(session_id: String, mic_audio_path: PathBuf, system_audio_path: PathBuf) -> Self {
        Self {
            session_id,
            mic_audio_path,
            system_audio_path,
            segments: Vec::new(),
            mic_samples_processed: 0,
            system_samples_processed: 0,
        }
    }
}

pub fn poll_interval_seconds() -> u64 {
    LIVE_POLL_SECONDS
}

pub fn poll_live_session(
    live: &mut LiveTranscriptionSession,
    model_path: &Path,
) -> Result<(), String> {
    if !model_path.exists() {
        return Ok(());
    }

    let mic_audio_path = live.mic_audio_path.clone();
    let system_audio_path = live.system_audio_path.clone();

    with_whisper_context(model_path, |context| {
        poll_source(live, context, &mic_audio_path, "mic_local", "LOCAL", true)?;
        poll_source(
            live,
            context,
            &system_audio_path,
            "system_audio",
            "SYSTEM",
            false,
        )?;
        live.segments.sort_by_key(|segment| segment.start_time_ms);
        Ok(())
    })
}

fn poll_source(
    live: &mut LiveTranscriptionSession,
    context: &WhisperContext,
    audio_path: &Path,
    source_type: &str,
    speaker_label: &str,
    is_mic: bool,
) -> Result<(), String> {
    if !audio_path.exists() {
        return Ok(());
    }

    let processed = if is_mic {
        live.mic_samples_processed
    } else {
        live.system_samples_processed
    };

    let (new_samples, total_samples, offset_ms) =
        read_new_mono_samples(audio_path, processed, WHISPER_SAMPLE_RATE)?;

    if is_mic {
        live.mic_samples_processed = total_samples;
    } else {
        live.system_samples_processed = total_samples;
    }

    if new_samples.len() < MIN_LIVE_SAMPLES {
        return Ok(());
    }

    let mut new_segments = transcribe_pcm_buffer(
        &live.session_id,
        context,
        &new_samples,
        source_type,
        speaker_label,
        offset_ms,
    )?;

    live.segments
        .retain(|segment| segment.source_type != source_type);
    live.segments.append(&mut new_segments);

    Ok(())
}

fn with_whisper_context<F, T>(model_path: &Path, action: F) -> Result<T, String>
where
    F: FnOnce(&WhisperContext) -> Result<T, String>,
{
    let path_key = model_path.display().to_string();
    let mut cache = WHISPER_CACHE
        .lock()
        .map_err(|_| "whisper cache lock poisoned".to_string())?;

    let reload = cache
        .as_ref()
        .map(|(cached_path, _)| cached_path != &path_key)
        .unwrap_or(true);

    if reload {
        let context = WhisperContext::new_with_params(
            model_path
                .to_str()
                .ok_or_else(|| "invalid whisper model path".to_string())?,
            WhisperContextParameters::default(),
        )
        .map_err(|error| format!("failed to load whisper model: {error}"))?;
        *cache = Some((path_key, context));
    }

    let (_, context) = cache
        .as_ref()
        .ok_or_else(|| "failed to cache whisper model".to_string())?;

    action(context)
}

fn transcribe_pcm_buffer(
    session_id: &str,
    context: &WhisperContext,
    audio: &[f32],
    source_type: &str,
    speaker_label: &str,
    time_offset_ms: i64,
) -> Result<Vec<TranscriptSegment>, String> {
    let mut state = context
        .create_state()
        .map_err(|error| format!("failed to create whisper state: {error}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(4);
    params.set_translate(false);
    // whisper-rs defaults to "en"; None keeps Whisper in source-language auto-detect mode.
    params.set_language(None);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, audio)
        .map_err(|error| format!("live whisper transcription failed: {error}"))?;

    let mut segments = Vec::new();
    for (index, segment) in state.as_iter().enumerate() {
        let text = segment.to_string().trim().to_string();
        if text.is_empty() {
            continue;
        }

        segments.push(TranscriptSegment {
            id: format!("{session_id}-live-{source_type}-{time_offset_ms}-{index}"),
            source_type: source_type.to_string(),
            speaker_label: speaker_label.to_string(),
            start_time_ms: time_offset_ms + i64::from(segment.start_timestamp()) * 10,
            end_time_ms: time_offset_ms + i64::from(segment.end_timestamp()) * 10,
            text,
        });
    }

    Ok(segments)
}

struct WavDataInfo {
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    data_offset: usize,
}

fn read_new_mono_samples(
    path: &Path,
    from_sample: u64,
    target_rate: u32,
) -> Result<(Vec<f32>, u64, i64), String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read wav {}: {error}", path.display()))?;
    if bytes.len() < 44 {
        return Ok((
            Vec::new(),
            from_sample,
            sample_offset_to_ms(from_sample, target_rate),
        ));
    }

    let info = parse_wav_info(&bytes)
        .ok_or_else(|| format!("unsupported wav layout in {}", path.display()))?;

    let bytes_per_frame = (info.bits_per_sample / 8) as usize * info.channels as usize;
    if bytes_per_frame == 0 {
        return Ok((
            Vec::new(),
            from_sample,
            sample_offset_to_ms(from_sample, target_rate),
        ));
    }

    let available_bytes = bytes.len().saturating_sub(info.data_offset);
    let total_samples = (available_bytes / bytes_per_frame) as u64;
    if from_sample >= total_samples {
        return Ok((
            Vec::new(),
            total_samples,
            sample_offset_to_ms(from_sample, target_rate),
        ));
    }

    let start_byte = info.data_offset + from_sample as usize * bytes_per_frame;
    if start_byte >= bytes.len() {
        return Ok((
            Vec::new(),
            total_samples,
            sample_offset_to_ms(from_sample, target_rate),
        ));
    }

    let pcm_bytes = &bytes[start_byte..];
    let mut mono = decode_mono_samples(pcm_bytes, &info)?;
    if info.sample_rate != target_rate {
        mono = resample_linear(&mono, info.sample_rate, target_rate);
    }

    let offset_ms = sample_offset_to_ms(from_sample, target_rate);
    Ok((mono, total_samples, offset_ms))
}

fn sample_offset_to_ms(sample: u64, sample_rate: u32) -> i64 {
    ((sample as f64 / sample_rate as f64) * 1000.0) as i64
}

fn decode_mono_samples(pcm_bytes: &[u8], info: &WavDataInfo) -> Result<Vec<f32>, String> {
    match info.bits_per_sample {
        32 => {
            let mut samples = Vec::with_capacity(pcm_bytes.len() / 4);
            for chunk in pcm_bytes.chunks_exact(4) {
                let value = f32::from_le_bytes(chunk.try_into().expect("chunk length"));
                samples.push(value);
            }
            Ok(downmix_to_mono(samples, info.channels))
        }
        16 => {
            let mut samples = Vec::with_capacity(pcm_bytes.len() / 2);
            for chunk in pcm_bytes.chunks_exact(2) {
                let value = i16::from_le_bytes(chunk.try_into().expect("chunk length"));
                samples.push(value as f32 / i16::MAX as f32);
            }
            Ok(downmix_to_mono(samples, info.channels))
        }
        other => Err(format!("unsupported wav bit depth {other}")),
    }
}

fn downmix_to_mono(samples: Vec<f32>, channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples;
    }

    let channels = channels as usize;
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn parse_wav_info(bytes: &[u8]) -> Option<WavDataInfo> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" {
        return None;
    }

    let mut sample_rate = WHISPER_SAMPLE_RATE;
    let mut channels = 1_u16;
    let mut bits_per_sample = 16_u16;
    let mut data_offset = None;

    let mut pos = 12_usize;
    while pos + 8 <= bytes.len() {
        let chunk_id = &bytes[pos..pos + 4];
        let chunk_size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        pos += 8;
        if pos + chunk_size > bytes.len() {
            if chunk_id == b"data" {
                data_offset = Some(pos);
            }
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            channels = u16::from_le_bytes(bytes[pos + 2..pos + 4].try_into().ok()?);
            sample_rate = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?);
            bits_per_sample = u16::from_le_bytes(bytes[pos + 14..pos + 16].try_into().ok()?);
        } else if chunk_id == b"data" {
            data_offset = Some(pos);
        }

        pos += chunk_size + (chunk_size % 2);
    }

    Some(WavDataInfo {
        sample_rate,
        channels,
        bits_per_sample,
        data_offset: data_offset?,
    })
}

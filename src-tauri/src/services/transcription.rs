use std::{fs, path::Path};

use hound::WavReader;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::state::transcript::TranscriptSegment;

pub const WHISPER_SAMPLE_RATE: u32 = 16_000;

pub fn transcribe_session(
    session_id: &str,
    model_path: &Path,
    mic_audio_path: &Path,
    system_audio_path: &Path,
) -> Result<Vec<TranscriptSegment>, String> {
    let context = WhisperContext::new_with_params(
        model_path
            .to_str()
            .ok_or_else(|| "invalid whisper model path".to_string())?,
        WhisperContextParameters::default(),
    )
    .map_err(|error| format!("failed to load whisper model: {error}"))?;

    let mut segments = Vec::new();
    segments.extend(transcribe_one_source(
        &context,
        session_id,
        mic_audio_path,
        "mic_local",
        "LOCAL",
    )?);
    segments.extend(transcribe_one_source(
        &context,
        session_id,
        system_audio_path,
        "system_audio",
        "Speaker 1",
    )?);
    segments.sort_by_key(|segment| segment.start_time_ms);
    Ok(segments)
}

fn transcribe_one_source(
    context: &WhisperContext,
    session_id: &str,
    audio_path: &Path,
    source_type: &str,
    speaker_label: &str,
) -> Result<Vec<TranscriptSegment>, String> {
    if !audio_path.exists() {
        return Ok(Vec::new());
    }

    let metadata = fs::metadata(audio_path).map_err(|error| {
        format!(
            "failed to read audio metadata {}: {error}",
            audio_path.display()
        )
    })?;
    if metadata.len() == 0 {
        return Ok(Vec::new());
    }

    let mut state = context
        .create_state()
        .map_err(|error| format!("failed to create whisper state: {error}"))?;

    let audio = read_wav_as_f32(audio_path)?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(4);
    params.set_translate(false);
    // whisper-rs defaults to "en"; None keeps Whisper in source-language auto-detect mode.
    params.set_language(None);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state.full(params, &audio).map_err(|error| {
        format!(
            "whisper transcription failed for {}: {error}",
            audio_path.display()
        )
    })?;

    let mut segments = Vec::new();
    for (index, segment) in state.as_iter().enumerate() {
        let text = segment.to_string().trim().to_string();
        if text.is_empty() {
            continue;
        }

        segments.push(TranscriptSegment {
            id: format!("{session_id}-segment-{source_type}-{index}"),
            source_type: source_type.to_string(),
            speaker_label: speaker_label.to_string(),
            start_time_ms: i64::from(segment.start_timestamp()) * 10,
            end_time_ms: i64::from(segment.end_timestamp()) * 10,
            text,
        });
    }

    Ok(segments)
}

fn read_wav_as_f32(audio_path: &Path) -> Result<Vec<f32>, String> {
    let mut reader = WavReader::open(audio_path)
        .map_err(|error| format!("failed to open wav file {}: {error}", audio_path.display()))?;
    let spec = reader.spec();

    if spec.channels > 2 {
        return Err(format!(
            "wav file {} has unsupported channel count {}",
            audio_path.display(),
            spec.channels
        ));
    }

    let audio = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|sample| sample.map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => {
            let samples = reader
                .samples::<i16>()
                .map(|sample| sample.map_err(|error| error.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            let mut output = vec![0.0_f32; samples.len()];
            whisper_rs::convert_integer_to_float_audio(&samples, &mut output)
                .map_err(|error| format!("failed to convert integer wav samples: {error}"))?;
            output
        }
    };

    let mono = if spec.channels == 2 {
        let mut output = vec![0.0_f32; audio.len() / 2];
        whisper_rs::convert_stereo_to_mono_audio(&audio, &mut output)
            .map_err(|error| format!("failed to convert stereo wav to mono: {error}"))?;
        output
    } else {
        audio
    };

    if spec.sample_rate == WHISPER_SAMPLE_RATE {
        return Ok(mono);
    }

    Ok(resample_linear(
        &mono,
        spec.sample_rate,
        WHISPER_SAMPLE_RATE,
    ))
}

/// Linear interpolation resampling (e.g. 24 kHz mic capture -> 16 kHz for Whisper).
pub fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }
    if samples.is_empty() {
        return Vec::new();
    }

    let output_len = ((samples.len() as u64) * (to_rate as u64) / (from_rate as u64)) as usize;
    let output_len = output_len.max(1);
    let mut output = Vec::with_capacity(output_len);
    let step = from_rate as f64 / to_rate as f64;

    for i in 0..output_len {
        let src_pos = i as f64 * step;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let s0 = samples.get(idx).copied().unwrap_or(0.0);
        let s1 = samples.get(idx + 1).copied().unwrap_or(s0);
        output.push(s0 + (s1 - s0) * frac);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_24k_to_16k_preserves_duration() {
        let input: Vec<f32> = (0..24_000).map(|i| i as f32).collect();
        let output = resample_linear(&input, 24_000, 16_000);
        assert_eq!(output.len(), 16_000);
    }
}

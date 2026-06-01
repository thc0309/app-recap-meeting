use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub screen_recording_granted: bool,
    pub microphone_granted: bool,
}

pub struct NativeCaptureProcess {
    child: Child,
    stdin: ChildStdin,
}

impl NativeCaptureProcess {
    pub fn start(mic_output_path: &str, system_output_path: &str) -> Result<Self, String> {
        let helper_path = resolve_helper_binary()?;

        let mut child = Command::new(helper_path)
            .args([
                "capture",
                "--mic-output",
                mic_output_path,
                "--system-output",
                system_output_path,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to spawn macOS capture helper: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "capture helper stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "capture helper stdout is unavailable".to_string())?;

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|error| format!("failed to read capture helper readiness line: {error}"))?;

        if !line.contains("\"ready\"") {
            return Err(format!(
                "capture helper failed to become ready. first line: {}",
                line.trim()
            ));
        }

        Ok(Self { child, stdin })
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.stdin
            .write_all(b"stop\n")
            .map_err(|error| format!("failed to send stop signal to capture helper: {error}"))?;
        self.stdin
            .flush()
            .map_err(|error| format!("failed to flush capture helper stop signal: {error}"))?;

        let status = self
            .child
            .wait()
            .map_err(|error| format!("failed to wait for capture helper to exit: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("capture helper exited with status {status}"))
        }
    }
}

pub fn request_permissions() -> Result<PermissionStatus, String> {
    let helper_path = resolve_helper_binary()?;
    let output = Command::new(helper_path)
        .arg("request-permissions")
        .output()
        .map_err(|error| format!("failed to request macOS capture permissions: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "permission helper exited with status {}",
            output.status
        ));
    }

    serde_json::from_slice::<PermissionStatus>(&output.stdout)
        .map_err(|error| format!("failed to parse permission helper output: {error}"))
}

fn resolve_helper_binary() -> Result<PathBuf, String> {
    let current_exe = env::current_exe()
        .map_err(|error| format!("failed to resolve current executable path: {error}"))?;
    let current_dir = current_exe
        .parent()
        .ok_or_else(|| "failed to resolve current executable directory".to_string())?;

    let target = env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".to_string());
    let candidates = [
        current_dir.join("macos-capture-helper"),
        current_dir.join(format!("macos-capture-helper-{target}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("macos-capture-helper-{target}")),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "failed to resolve bundled macOS capture helper binary".to_string())
}

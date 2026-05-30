mod native_audio;

use std::path::PathBuf;
use std::sync::Mutex;

use native_audio::commands::{
    native_audio_inputs, native_audio_state, native_audio_support, native_audio_targets,
    start_native_audio_capture, stop_native_audio_capture,
};
use native_audio::runtime::NativeAudioRuntime;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct BackendRuntimeState {
    child: Mutex<Option<CommandChild>>,
    startup_error: Mutex<Option<String>>,
}

#[tauri::command]
fn get_backend_startup_error(state: tauri::State<BackendRuntimeState>) -> Option<String> {
    state
        .startup_error
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn resolve_project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("MEETING_RECAP_PROJECT_ROOT") {
        return Ok(PathBuf::from(value));
    }

    let mut candidates = Vec::new();
    let source_project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.to_path_buf());

    if let Some(path) = source_project_root {
        candidates.push(path);
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.clone());
        if current_dir.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
            if let Some(parent) = current_dir.parent() {
                candidates.push(parent.to_path_buf());
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir);
    }

    candidates
        .into_iter()
        .find(|path| path.join("backend").exists() && path.join("frontend").exists())
        .ok_or_else(|| "Khong the xac dinh project root cho backend sidecar.".to_string())
}

fn spawn_backend_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let project_root = resolve_project_root(app)?;
    let port = std::env::var("MEETING_RECAP_BACKEND_PORT").unwrap_or_else(|_| "8000".to_string());

    let sidecar = app
        .shell()
        .sidecar("backend-sidecar")
        .map_err(|error| format!("Khong tao duoc sidecar backend: {error}"))?;

    let command = sidecar
        .env(
            "MEETING_RECAP_PROJECT_ROOT",
            project_root.to_string_lossy().to_string(),
        )
        .env("MEETING_RECAP_BACKEND_PORT", &port);

    let (mut rx, child) = command
        .spawn()
        .map_err(|error| format!("Khong the start backend sidecar: {error}"))?;

    let state: tauri::State<BackendRuntimeState> = app.state();
    if let Ok(mut guard) = state.child.lock() {
        *guard = Some(child);
    }
    if let Ok(mut guard) = state.startup_error.lock() {
        *guard = None;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = handle.emit("backend-log", line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !line.is_empty() {
                        let _ = handle.emit("backend-error", line);
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let _ = handle.emit(
                        "backend-terminated",
                        format!(
                            "Backend sidecar da dung. code={:?}, signal={:?}",
                            payload.code, payload.signal
                        ),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn stop_backend_sidecar(app: &tauri::AppHandle) {
    let state: tauri::State<BackendRuntimeState> = app.state();
    {
        if let Ok(mut guard) = state.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendRuntimeState {
            child: Mutex::new(None),
            startup_error: Mutex::new(None),
        })
        .manage(NativeAudioRuntime::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_startup_error,
            native_audio_support,
            native_audio_inputs,
            native_audio_targets,
            native_audio_state,
            start_native_audio_capture,
            stop_native_audio_capture
        ])
        .setup(|app| {
            if let Err(error) = spawn_backend_sidecar(app.handle()) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("backend-error", error.clone());
                }
                let state: tauri::State<BackendRuntimeState> = app.state();
                if let Ok(mut guard) = state.startup_error.lock() {
                    *guard = Some(error.clone());
                }
                eprintln!("Backend sidecar startup error: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_backend_sidecar(&window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

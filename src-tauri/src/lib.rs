mod audio;
mod commands;
mod env;
mod services;
mod state;
mod storage;

use std::sync::Mutex;

use state::app::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env::load_dotenv();
    let app_state = AppState::bootstrap().expect("failed to bootstrap application state");

    tauri::Builder::default()
        .manage(Mutex::new(app_state))
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::get_app_state,
            commands::get_capture_overview,
            commands::get_model_status,
            commands::create_session,
            commands::recover_active_session,
            commands::finalize_session,
            commands::delete_session,
            commands::clear_history,
            commands::request_system_audio_permission,
            commands::simulate_device_loss,
            commands::recover_capture_device,
            commands::update_settings,
            commands::save_openai_api_key,
            commands::download_default_model,
            commands::generate_recap,
            commands::export_session_markdown,
            commands::get_session_detail
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Meeting Transcriber core");
}

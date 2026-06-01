use std::path::PathBuf;

/// Loads `.env` from the repo root during local development.
pub fn load_dotenv() {
    if dotenvy::dotenv().is_ok() {
        return;
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for ancestor in current_dir.ancestors() {
            let env_path = ancestor.join(".env");
            if env_path.is_file() && dotenvy::from_path(&env_path).is_ok() {
                return;
            }
            if ancestor.join("src-tauri").is_dir() {
                break;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = dotenvy::from_path(dir.join(".env"));
            let _ = dotenvy::from_path(PathBuf::from(dir).join("../.env"));
        }
    }
}

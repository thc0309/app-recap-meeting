use std::{
    fs,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub root_dir: PathBuf,
    pub sessions_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub models_dir: PathBuf,
    pub db_path: PathBuf,
    pub config_path: PathBuf,
}

impl AppPaths {
    pub fn detect() -> Result<Self, String> {
        let project_dirs = ProjectDirs::from("com", "chuongtong", "MeetingTranscriber")
            .ok_or_else(|| {
                "failed to resolve platform application support directory".to_string()
            })?;

        Ok(Self::new(project_dirs.data_local_dir().to_path_buf()))
    }

    pub fn new(root_dir: PathBuf) -> Self {
        Self {
            sessions_dir: root_dir.join("sessions"),
            exports_dir: root_dir.join("exports"),
            models_dir: root_dir.join("models"),
            db_path: root_dir.join("sessions.db"),
            config_path: root_dir.join("config.json"),
            root_dir,
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        for directory in [
            &self.root_dir,
            &self.sessions_dir,
            &self.exports_dir,
            &self.models_dir,
        ] {
            fs::create_dir_all(directory).map_err(|error| {
                format!(
                    "failed to create directory {}: {error}",
                    directory.display()
                )
            })?;
        }

        Ok(())
    }

    pub fn session_dir(&self, session_id: &str) -> PathBuf {
        self.sessions_dir.join(session_id)
    }

    pub fn ensure_session_dir(&self, session_id: &str) -> Result<PathBuf, String> {
        let path = self.session_dir(session_id);
        fs::create_dir_all(&path).map_err(|error| {
            format!(
                "failed to create session directory {}: {error}",
                path.display()
            )
        })?;
        Ok(path)
    }

    pub fn remove_session_dir(&self, session_id: &str) -> Result<(), String> {
        let path = self.session_dir(session_id);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!(
                    "failed to delete session directory {}: {error}",
                    path.display()
                )
            })?;
        }
        Ok(())
    }

    pub fn write_string(&self, path: &Path, contents: &str) -> Result<(), String> {
        fs::write(path, contents)
            .map_err(|error| format!("failed to write {}: {error}", path.display()))
    }
}

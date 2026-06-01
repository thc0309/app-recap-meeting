fn main() {
    #[cfg(target_os = "macos")]
    compile_mac_capture_helper();

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn compile_mac_capture_helper() {
    use std::{env, fs, path::PathBuf, process::Command};

    println!("cargo:rerun-if-changed=native/MacCaptureHelper.swift");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing manifest dir"));
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir).expect("failed to create binaries directory");

    let target = env::var("TARGET").expect("missing target triple");
    let output_path = binaries_dir.join(format!("macos-capture-helper-{target}"));
    let source_path = manifest_dir.join("native").join("MacCaptureHelper.swift");

    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            source_path.to_str().expect("invalid swift source path"),
            "-framework",
            "AVFoundation",
            "-framework",
            "CoreGraphics",
            "-framework",
            "CoreMedia",
            "-framework",
            "ScreenCaptureKit",
            "-o",
            output_path.to_str().expect("invalid swift output path"),
        ])
        .status()
        .expect("failed to invoke swiftc for mac capture helper");

    if !status.success() {
        panic!("swiftc failed while compiling macOS capture helper");
    }
}

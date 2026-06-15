//! Standalone engine lifecycle management for the web server.
//!
//! Uses `std::process::Command` directly — no Tauri dependency.
//! Reuses the existing `engine::args` module for CLI argument construction.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::engine::build_start_args_with_ed2k_bootstrap;
use crate::engine::path_to_safe_string;
#[allow(unused_imports)]
use crate::engine::SUPPORTED_ENGINE_KEYS;

const ENGINE_RESOURCE_NAME: &str = "motrix-next-engine";

/// Holds the running engine child process.
#[derive(Default)]
pub struct EngineHandle {
    child: Option<Child>,
}

impl EngineHandle {
    /// Returns `true` if the engine process is currently alive.
    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    /// Kill the engine process if running.
    pub fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            log::info!("engine: killing process (pid={:?})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub type WebEngineState = Arc<Mutex<EngineHandle>>;

/// Resolve the engine binary path for the current platform.
///
/// Looks for `binaries/motrix-next-engine-{target}` relative to the binary
/// directory, falling back to the current working directory.
pub fn resolve_engine_binary() -> PathBuf {
    let target_suffix = if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") {
            "x86_64-pc-windows-msvc.exe"
        } else {
            "aarch64-pc-windows-msvc.exe"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "x86_64") {
            "x86_64-apple-darwin"
        } else {
            "aarch64-apple-darwin"
        }
    } else {
        // Linux
        if cfg!(target_arch = "x86_64") {
            "x86_64-unknown-linux-gnu"
        } else {
            "aarch64-unknown-linux-gnu"
        }
    };

    let binary_name = format!("{}-{}", ENGINE_RESOURCE_NAME, target_suffix);

    // Try alongside the executable first
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("binaries").join(&binary_name);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // Try project root (for cargo run)
    let candidate = PathBuf::from("src-tauri/binaries").join(&binary_name);
    if candidate.exists() {
        return candidate;
    }

    // Fallback
    PathBuf::from("binaries").join(&binary_name)
}

#[allow(dead_code)]
const DEFAULT_RPC_PORT: &str = "29100";
const DEFAULT_ARIA2_LOG_LEVEL: &str = "info";

/// Start the aria2 engine process.
///
/// Arguments are built from `system_config` using the same `build_start_args`
/// that the Tauri version uses.
pub fn start_engine(
    engine_handle: &Mutex<EngineHandle>,
    data_dir: &PathBuf,
    _rpc_port: u16,
    system_config: &serde_json::Value,
) -> Result<(), String> {
    let mut guard = engine_handle.lock().map_err(|e| e.to_string())?;

    if guard.is_running() {
        return Ok(());
    }

    // Ensure download directory exists
    let download_dir = system_config
        .get("dir")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            let d = dirs::download_dir()
                .unwrap_or_else(|| PathBuf::from("."));
            Box::leak(d.to_string_lossy().to_string().into_boxed_str())
        });
    std::fs::create_dir_all(download_dir)
        .map_err(|e| format!("Failed to create download dir '{}': {}", download_dir, e))?;

    // Resolve paths
    let engine_binary = resolve_engine_binary();
    if !engine_binary.exists() {
        return Err(format!(
            "Engine binary not found at: {}",
            engine_binary.display()
        ));
    }

    // Try multiple locations for aria2.conf:
    // - ./binaries/aria2.conf (Docker /app/binaries/)
    // - src-tauri/binaries/aria2.conf (cargo run development)
    let conf_path = if PathBuf::from("binaries/aria2.conf").exists() {
        PathBuf::from("binaries/aria2.conf")
    } else {
        PathBuf::from("src-tauri/binaries/aria2.conf")
    };
    let conf_str = if conf_path.exists() {
        Some(path_to_safe_string(&conf_path))
    } else {
        None
    };

    let session_path = data_dir.join("download.session");
    let session_str = path_to_safe_string(&session_path);
    let session_exists = session_path.exists();

    if let Some(parent) = session_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Log configuration
    let log_path = data_dir.join("logs").join("aria2-next.log");
    let log_str = path_to_safe_string(&log_path);
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let log_level = system_config
        .get("aria2LogLevel")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_ARIA2_LOG_LEVEL);

    // Build CLI args
    let args = build_start_args_with_ed2k_bootstrap(
        system_config,
        conf_str.as_deref(),
        &session_str,
        session_exists,
        &log_str,
        log_level,
        None, // No ED2K bootstrap for web mode (simplified)
    );

    log::info!("engine: spawning {} with {} args", engine_binary.display(), args.len());

    let child = Command::new(&engine_binary)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn engine: {e}"))?;

    log::info!("engine: started (pid={:?})", child.id());

    guard.child = Some(child);
    drop(guard);

    Ok(())
}

/// Stop the engine process.
pub fn stop_engine(engine_handle: &Mutex<EngineHandle>) {
    let mut guard = engine_handle.lock().unwrap();
    guard.kill();
}

/// Wait for the engine to become responsive on its RPC port.
pub async fn wait_for_engine_ready(
    aria2_client: &crate::aria2::client::Aria2Client,
    max_retries: u32,
) -> Result<(), String> {
    for i in 0..max_retries {
        match aria2_client.get_version().await {
            Ok(version) => {
                log::info!("engine: ready — version: {}", version);
                return Ok(());
            }
            Err(_) if i + 1 < max_retries => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            Err(e) => {
                return Err(format!("Engine probe failed after {max_retries} retries: {e}"));
            }
        }
    }

    Err(format!(
        "Engine still not ready after {max_retries} retries"
    ))
}
//! Engine management for the bundled Motrix Next engine sidecar.
//!
//! Split into focused sub-modules:
//! - [`state`] — `EngineState` struct, ANSI stripping, log routing
//! - [`lifecycle`] — `start_engine`, `stop_engine`, `restart_engine`
//! - [`args`] — CLI argument builder for Aria2 Next
//! - [`cleanup`] — Port cleanup and process identification

mod args;
#[cfg(feature = "desktop")]
mod cleanup;
#[cfg(feature = "desktop")]
mod lifecycle;
mod log_level;
mod state;

pub(crate) use args::SUPPORTED_ENGINE_KEYS;
pub(crate) use args::build_start_args_with_ed2k_bootstrap;
#[cfg(feature = "desktop")]
pub use lifecycle::{restart_engine, start_engine, stop_engine};
#[cfg(feature = "desktop")]
pub(crate) use log_level::{valid_aria2_log_level, DEFAULT_ARIA2_LOG_LEVEL};
pub(crate) use state::path_to_safe_string;
#[cfg(feature = "desktop")]
pub use state::EngineState;
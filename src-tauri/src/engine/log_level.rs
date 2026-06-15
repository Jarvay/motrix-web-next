#[cfg(feature = "desktop")]
pub(crate) const DEFAULT_ARIA2_LOG_LEVEL: &str = "notice";

#[cfg(feature = "desktop")]
pub(crate) fn valid_aria2_log_level(level: &str) -> bool {
    matches!(level, "error" | "warn" | "notice" | "info" | "debug")
}
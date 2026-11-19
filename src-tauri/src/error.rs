use std::fmt;

/// Only stable codes cross IPC; database, filesystem and crypto diagnostics may contain secrets.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(transparent)]
pub struct Error(pub &'static str);
pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self("DATABASE_ERROR")
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self("INVALID_DATA")
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self("FILE_OPERATION_FAILED")
    }
}

pub fn ensure(condition: bool, code: &'static str) -> Result<()> {
    if condition { Ok(()) } else { Err(Error(code)) }
}

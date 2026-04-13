use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Request(String),
    #[error("{0}")]
    Storage(String),
    #[error("{0}")]
    Internal(String),
}

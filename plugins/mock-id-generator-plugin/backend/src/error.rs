use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("{0}")]
    InvalidInput(String),
}

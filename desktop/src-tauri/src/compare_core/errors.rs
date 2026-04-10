use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("参数校验失败: {0}")]
    Validation(String),
    #[error("数据库访问失败: {0}")]
    Database(String),
    #[error("文件处理失败: {0}")]
    Io(String),
    #[error("数据解析失败: {0}")]
    Parse(String),
    #[error("加解密失败: {0}")]
    Crypto(String),
    #[error("任务已取消: {0}")]
    Cancelled(String),
}

impl AppError {
    pub fn from_mysql(error: mysql_async::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error.to_string())
    }
}

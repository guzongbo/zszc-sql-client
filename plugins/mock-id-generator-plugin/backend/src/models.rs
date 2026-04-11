use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: JsonValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<JsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcError {
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct RandomProfileResponse {
    pub name: String,
    pub uscc: String,
    pub id_card: String,
    pub bank_card: String,
    pub mobile: String,
    pub email: String,
    pub address: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GeneratedTextResponse {
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strength_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeneratePasswordParams {
    #[serde(default = "default_password_length")]
    pub length: usize,
    #[serde(default = "default_true")]
    pub include_uppercase: bool,
    #[serde(default = "default_true")]
    pub include_lowercase: bool,
    #[serde(default = "default_true")]
    pub include_numbers: bool,
    #[serde(default = "default_true")]
    pub include_symbols: bool,
    #[serde(default = "default_min_numbers")]
    pub min_numbers: usize,
    #[serde(default = "default_min_symbols")]
    pub min_symbols: usize,
    #[serde(default)]
    pub avoid_ambiguous: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeneratePassphraseParams {
    #[serde(default = "default_word_count")]
    pub word_count: usize,
    #[serde(default = "default_passphrase_separator")]
    pub separator: String,
    #[serde(default = "default_true")]
    pub capitalize_words: bool,
    #[serde(default)]
    pub append_number: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GenerateUsernameParams {
    #[serde(default = "default_username_length")]
    pub length: usize,
    #[serde(default)]
    pub separator: String,
    #[serde(default)]
    pub append_number: bool,
    #[serde(default)]
    pub avoid_ambiguous: bool,
    #[serde(default)]
    pub style: UsernameStyle,
}

#[derive(Debug, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum UsernameStyle {
    #[default]
    WordCombo,
    PinyinStyle,
    TechStyle,
}

fn default_true() -> bool {
    true
}

fn default_password_length() -> usize {
    14
}

fn default_min_numbers() -> usize {
    1
}

fn default_min_symbols() -> usize {
    1
}

fn default_word_count() -> usize {
    4
}

fn default_passphrase_separator() -> String {
    "-".to_string()
}

fn default_username_length() -> usize {
    12
}

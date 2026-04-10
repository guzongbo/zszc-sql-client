use std::collections::BTreeMap;

use mysql_async::Value;
use serde_json::{Map, Number, Value as JsonValue};

pub type RowMap = BTreeMap<String, Value>;

fn escape_sql_string(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\0', "\\0")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\u{001a}', "\\Z")
}

pub fn value_signature(value: &Value) -> String {
    match value {
        Value::NULL => "NULL".to_string(),
        Value::Bytes(bytes) => format!("B:{}", hex::encode(bytes)),
        Value::Int(v) => format!("I:{v}"),
        Value::UInt(v) => format!("U:{v}"),
        Value::Float(v) => format!("F:{}", v.to_bits()),
        Value::Double(v) => format!("D:{}", v.to_bits()),
        Value::Date(year, month, day, hour, minute, second, micros) => {
            format!(
                "DATE:{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{micros:06}"
            )
        }
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => {
            let sign = if *is_negative { "-" } else { "" };
            format!("TIME:{sign}{days}:{hours:02}:{minutes:02}:{seconds:02}.{micros:06}")
        }
    }
}

pub fn values_equal(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (Some(Value::NULL), Some(Value::NULL)) => true,
        (Some(Value::Bytes(left)), Some(Value::Bytes(right))) => left == right,
        (Some(Value::Int(left)), Some(Value::Int(right))) => left == right,
        (Some(Value::UInt(left)), Some(Value::UInt(right))) => left == right,
        (Some(Value::Float(left)), Some(Value::Float(right))) => left.to_bits() == right.to_bits(),
        (Some(Value::Double(left)), Some(Value::Double(right))) => {
            left.to_bits() == right.to_bits()
        }
        (
            Some(Value::Date(ly, lm, ld, lh, lmin, ls, lmicros)),
            Some(Value::Date(ry, rm, rd, rh, rmin, rs, rmicros)),
        ) => (ly, lm, ld, lh, lmin, ls, lmicros) == (ry, rm, rd, rh, rmin, rs, rmicros),
        (
            Some(Value::Time(ln, ld, lh, lmin, ls, lmicros)),
            Some(Value::Time(rn, rd, rh, rmin, rs, rmicros)),
        ) => (ln, ld, lh, lmin, ls, lmicros) == (rn, rd, rh, rmin, rs, rmicros),
        (None, None) => true,
        _ => false,
    }
}

pub fn row_signature(row: &RowMap, columns: &[String]) -> String {
    let mut signature_parts = Vec::with_capacity(columns.len());
    for column in columns {
        let value = row.get(column).unwrap_or(&Value::NULL);
        signature_parts.push(value_signature(value));
    }
    signature_parts.join("|")
}

pub fn row_to_json(row: &RowMap) -> JsonValue {
    let mut object = Map::new();
    for (key, value) in row {
        object.insert(key.clone(), mysql_value_to_json(value));
    }
    JsonValue::Object(object)
}

pub fn row_to_json_values(row: &RowMap, columns: &[String]) -> Vec<JsonValue> {
    columns
        .iter()
        .map(|column| mysql_value_to_json(row.get(column).unwrap_or(&Value::NULL)))
        .collect()
}

pub fn key_to_json(row: &RowMap, key_columns: &[String]) -> JsonValue {
    let mut object = Map::new();
    for key in key_columns {
        let value = row.get(key).unwrap_or(&Value::NULL);
        object.insert(key.clone(), mysql_value_to_json(value));
    }
    JsonValue::Object(object)
}

pub fn mysql_value_to_json(value: &Value) -> JsonValue {
    match value {
        Value::NULL => JsonValue::Null,
        Value::Bytes(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => JsonValue::String(text.to_string()),
            Err(_) => JsonValue::String(format!("0x{}", hex::encode(bytes))),
        },
        Value::Int(v) => JsonValue::Number(Number::from(*v)),
        Value::UInt(v) => JsonValue::Number(Number::from(*v)),
        Value::Float(v) => Number::from_f64(*v as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::String(v.to_string())),
        Value::Double(v) => Number::from_f64(*v)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::String(v.to_string())),
        Value::Date(year, month, day, hour, minute, second, micros) => JsonValue::String(format!(
            "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{:06}",
            micros
        )),
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => {
            let sign = if *is_negative { "-" } else { "" };
            let total_hours = days * 24 + u32::from(*hours);
            JsonValue::String(format!(
                "{sign}{total_hours:02}:{minutes:02}:{seconds:02}.{:06}",
                micros
            ))
        }
    }
}

pub fn sql_literal(value: &Value) -> String {
    match value {
        Value::NULL => "NULL".to_string(),
        Value::Bytes(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => format!("'{}'", escape_sql_string(text)),
            Err(_) => format!("X'{}'", hex::encode(bytes)),
        },
        Value::Int(v) => v.to_string(),
        Value::UInt(v) => v.to_string(),
        Value::Float(v) => {
            if v.is_finite() {
                v.to_string()
            } else {
                "NULL".to_string()
            }
        }
        Value::Double(v) => {
            if v.is_finite() {
                v.to_string()
            } else {
                "NULL".to_string()
            }
        }
        Value::Date(year, month, day, hour, minute, second, micros) => {
            format!(
                "'{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{:06}'",
                micros
            )
        }
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => {
            let sign = if *is_negative { "-" } else { "" };
            let total_hours = days * 24 + u32::from(*hours);
            format!(
                "'{sign}{total_hours:02}:{minutes:02}:{seconds:02}.{:06}'",
                micros
            )
        }
    }
}

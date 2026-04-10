use super::{
    MysqlService, TableDataContext, build_table_data_row, collect_page_window, json_to_mysql_value,
    normalize_raw_clause, quote_identifier, validate_raw_clause,
};
use crate::models::{
    ApplyTableDataChangesPayload, ConnectionProfile, DeletedRowPayload, InsertedRowPayload,
    JsonRecord, LoadTableDataPayload, MutationResult, SqlPreview, TableColumn, TableDataColumn,
    TableDataPage, UpdatedRowPayload,
};
use anyhow::{Context, Result, anyhow, ensure};
use mysql::prelude::Queryable;
use mysql::{TxOpts, Value};
use serde_json::Value as JsonValue;

impl MysqlService {
    pub fn load_table_data(
        &self,
        profile: &ConnectionProfile,
        payload: &LoadTableDataPayload,
    ) -> Result<TableDataPage> {
        let normalized_where_clause = normalize_raw_clause(payload.where_clause.as_deref());
        let normalized_order_by_clause = normalize_raw_clause(payload.order_by_clause.as_deref());

        validate_raw_clause(normalized_where_clause.as_deref())?;
        validate_raw_clause(normalized_order_by_clause.as_deref())?;

        let limit = payload.limit.unwrap_or(100).clamp(1, 500);
        let offset = payload.offset.unwrap_or(0);
        let table_context =
            self.load_table_data_context(profile, &payload.database_name, &payload.table_name)?;
        let primary_keys = table_context.primary_keys.clone();

        let mut data_sql = format!(
            "SELECT * FROM {}.{}",
            quote_identifier(&payload.database_name),
            quote_identifier(&payload.table_name)
        );

        if let Some(where_clause) = normalized_where_clause
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            data_sql.push_str(" WHERE ");
            data_sql.push_str(where_clause.trim());
        }

        if let Some(order_by_clause) = normalized_order_by_clause
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            data_sql.push_str(" ORDER BY ");
            data_sql.push_str(order_by_clause.trim());
        }

        // 额外多取一行，用于判断是否还有下一页，避免默认执行昂贵的 COUNT(*)
        data_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit + 1, offset));

        self.with_conn(profile, |connection| {
            let result = connection.query_iter(data_sql).context("读取表数据失败")?;

            let column_names = result
                .columns()
                .as_ref()
                .iter()
                .map(|column| column.name_str().to_string())
                .collect::<Vec<_>>();

            let page_window = collect_page_window(
                result.map(|row_result| {
                    let row = row_result?;
                    build_table_data_row(row, &column_names, &primary_keys)
                }),
                limit,
            )?;

            Ok(TableDataPage {
                profile_id: profile.id.clone(),
                database_name: payload.database_name.clone(),
                table_name: payload.table_name.clone(),
                columns: table_context.columns.clone(),
                rows: page_window.rows,
                primary_keys: primary_keys.clone(),
                offset,
                limit,
                total_rows: offset + page_window.total_rows,
                row_count_exact: page_window.row_count_exact,
                editable: !primary_keys.is_empty(),
            })
        })
    }

    pub fn apply_table_data_changes(
        &self,
        profile: &ConnectionProfile,
        payload: &ApplyTableDataChangesPayload,
    ) -> Result<MutationResult> {
        let design =
            self.load_table_design(profile, &payload.database_name, &payload.table_name)?;
        let primary_keys = design
            .columns
            .iter()
            .filter(|column| column.primary_key)
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        ensure!(
            !primary_keys.is_empty(),
            "当前表未定义主键，为保证数据可靠性，本轮仅支持主键表编辑"
        );

        let statements = preview_data_statements(payload, &design.columns)?;

        self.with_conn(profile, |connection| {
            let mut transaction = connection
                .start_transaction(TxOpts::default())
                .context("开启事务失败")?;

            for deleted_row in &payload.deleted_rows {
                let (statement, params) = build_delete_statement(
                    &payload.database_name,
                    &payload.table_name,
                    &primary_keys,
                    deleted_row,
                )?;
                transaction
                    .exec_drop(statement, params)
                    .context("删除数据行失败")?;
            }

            for updated_row in &payload.updated_rows {
                let (statement, params) = build_update_statement(
                    &payload.database_name,
                    &payload.table_name,
                    &design.columns,
                    &primary_keys,
                    updated_row,
                )?;
                if !statement.is_empty() {
                    transaction
                        .exec_drop(statement, params)
                        .context("更新数据行失败")?;
                }
            }

            for inserted_row in &payload.inserted_rows {
                let (statement, params) = build_insert_statement(
                    &payload.database_name,
                    &payload.table_name,
                    &design.columns,
                    inserted_row,
                )?;
                transaction
                    .exec_drop(statement, params)
                    .context("新增数据行失败")?;
            }

            transaction.commit().context("提交事务失败")?;

            Ok(MutationResult {
                affected_rows: (payload.deleted_rows.len()
                    + payload.updated_rows.len()
                    + payload.inserted_rows.len()) as u64,
                statements,
            })
        })
    }

    pub fn preview_table_data_changes(
        &self,
        profile: &ConnectionProfile,
        payload: &ApplyTableDataChangesPayload,
    ) -> Result<SqlPreview> {
        let design =
            self.load_table_design(profile, &payload.database_name, &payload.table_name)?;
        let primary_keys = design
            .columns
            .iter()
            .filter(|column| column.primary_key)
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        ensure!(
            !primary_keys.is_empty(),
            "当前表未定义主键，为保证数据可靠性，本轮仅支持主键表编辑"
        );

        Ok(SqlPreview {
            statements: preview_data_statements(payload, &design.columns)?,
        })
    }

    pub(super) fn load_table_data_context(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
    ) -> Result<TableDataContext> {
        let columns = self.load_columns(profile, database_name, table_name)?;
        let primary_keys = columns
            .iter()
            .filter(|column| column.primary_key)
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        Ok(TableDataContext {
            columns: columns
                .into_iter()
                .map(|column| TableDataColumn {
                    name: column.name,
                    data_type: column.full_data_type,
                    nullable: column.nullable,
                    primary_key: column.primary_key,
                    auto_increment: column.auto_increment,
                    default_value: column.default_value,
                    comment: column.comment,
                })
                .collect(),
            primary_keys,
        })
    }
}

fn preview_data_statements(
    payload: &ApplyTableDataChangesPayload,
    columns: &[TableColumn],
) -> Result<Vec<String>> {
    let primary_keys = columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let mut statements = Vec::new();

    for deleted_row in &payload.deleted_rows {
        let (statement, params) = build_delete_statement(
            &payload.database_name,
            &payload.table_name,
            &primary_keys,
            deleted_row,
        )?;
        statements.push(render_statement_with_params(&statement, &params)?);
    }

    for updated_row in &payload.updated_rows {
        let (statement, params) = build_update_statement(
            &payload.database_name,
            &payload.table_name,
            columns,
            &primary_keys,
            updated_row,
        )?;
        if !statement.is_empty() {
            statements.push(render_statement_with_params(&statement, &params)?);
        }
    }

    for inserted_row in &payload.inserted_rows {
        let (statement, params) = build_insert_statement(
            &payload.database_name,
            &payload.table_name,
            columns,
            inserted_row,
        )?;
        statements.push(render_statement_with_params(&statement, &params)?);
    }

    Ok(statements)
}

fn build_delete_statement(
    database_name: &str,
    table_name: &str,
    primary_keys: &[String],
    deleted_row: &DeletedRowPayload,
) -> Result<(String, Vec<Value>)> {
    let where_clause = build_primary_key_where_clause(primary_keys, &deleted_row.row_key)?;
    let params = primary_keys
        .iter()
        .map(|primary_key| {
            deleted_row
                .row_key
                .get(primary_key)
                .ok_or_else(|| anyhow!("缺少主键字段: {primary_key}"))
                .and_then(json_to_mysql_value)
        })
        .collect::<Result<Vec<_>>>()?;

    Ok((
        format!(
            "DELETE FROM {}.{} WHERE {}",
            quote_identifier(database_name),
            quote_identifier(table_name),
            where_clause
        ),
        params,
    ))
}

fn build_update_statement(
    database_name: &str,
    table_name: &str,
    columns: &[TableColumn],
    primary_keys: &[String],
    updated_row: &UpdatedRowPayload,
) -> Result<(String, Vec<Value>)> {
    let set_columns = columns
        .iter()
        .map(|column| column.name.clone())
        .filter(|column_name| updated_row.values.contains_key(column_name))
        .collect::<Vec<_>>();

    if set_columns.is_empty() {
        return Ok((String::new(), vec![]));
    }

    let set_clause = set_columns
        .iter()
        .map(|column_name| format!("{} = ?", quote_identifier(column_name)))
        .collect::<Vec<_>>()
        .join(", ");

    let mut params = set_columns
        .iter()
        .map(|column_name| {
            updated_row
                .values
                .get(column_name)
                .ok_or_else(|| anyhow!("缺少更新字段: {column_name}"))
                .and_then(json_to_mysql_value)
        })
        .collect::<Result<Vec<_>>>()?;

    let where_clause = build_primary_key_where_clause(primary_keys, &updated_row.row_key)?;
    let key_params = primary_keys
        .iter()
        .map(|primary_key| {
            updated_row
                .row_key
                .get(primary_key)
                .ok_or_else(|| anyhow!("缺少主键字段: {primary_key}"))
                .and_then(json_to_mysql_value)
        })
        .collect::<Result<Vec<_>>>()?;

    params.extend(key_params);

    Ok((
        format!(
            "UPDATE {}.{} SET {} WHERE {}",
            quote_identifier(database_name),
            quote_identifier(table_name),
            set_clause,
            where_clause
        ),
        params,
    ))
}

fn build_insert_statement(
    database_name: &str,
    table_name: &str,
    columns: &[TableColumn],
    inserted_row: &InsertedRowPayload,
) -> Result<(String, Vec<Value>)> {
    let insertable_columns = columns
        .iter()
        .filter(|column| {
            inserted_row.values.contains_key(&column.name)
                && !(column.auto_increment
                    && inserted_row
                        .values
                        .get(&column.name)
                        .is_some_and(JsonValue::is_null))
        })
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    if insertable_columns.is_empty() {
        return Ok((
            format!(
                "INSERT INTO {}.{} () VALUES ()",
                quote_identifier(database_name),
                quote_identifier(table_name)
            ),
            vec![],
        ));
    }

    let placeholders = vec!["?"; insertable_columns.len()].join(", ");
    let params = insertable_columns
        .iter()
        .map(|column_name| {
            inserted_row
                .values
                .get(column_name)
                .ok_or_else(|| anyhow!("缺少新增字段: {column_name}"))
                .and_then(json_to_mysql_value)
        })
        .collect::<Result<Vec<_>>>()?;

    Ok((
        format!(
            "INSERT INTO {}.{} ({}) VALUES ({})",
            quote_identifier(database_name),
            quote_identifier(table_name),
            insertable_columns
                .iter()
                .map(|column_name| quote_identifier(column_name))
                .collect::<Vec<_>>()
                .join(", "),
            placeholders
        ),
        params,
    ))
}

fn build_primary_key_where_clause(primary_keys: &[String], row_key: &JsonRecord) -> Result<String> {
    ensure!(!primary_keys.is_empty(), "当前表没有主键");
    ensure!(!row_key.is_empty(), "主键值不能为空");

    Ok(primary_keys
        .iter()
        .map(|primary_key| {
            ensure!(
                row_key.contains_key(primary_key),
                "缺少主键字段: {primary_key}"
            );
            Ok(format!("{} = ?", quote_identifier(primary_key)))
        })
        .collect::<Result<Vec<_>>>()?
        .join(" AND "))
}

fn render_statement_with_params(statement: &str, params: &[Value]) -> Result<String> {
    let placeholder_count = statement.matches('?').count();
    ensure!(
        placeholder_count == params.len(),
        "SQL 模板参数数量不匹配: 期望 {placeholder_count}，实际 {}",
        params.len()
    );

    if params.is_empty() {
        return Ok(statement.to_string());
    }

    let mut rendered = String::with_capacity(statement.len() + params.len() * 24);
    let mut parts = statement.split('?');

    if let Some(first_part) = parts.next() {
        rendered.push_str(first_part);
    }

    for (index, part) in parts.enumerate() {
        rendered.push_str(&render_mysql_value(&params[index]));
        rendered.push_str(part);
    }

    Ok(rendered)
}

fn render_mysql_value(value: &Value) -> String {
    match value {
        Value::NULL => "NULL".to_string(),
        Value::Bytes(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(text) => quote_sql_string_literal(&text),
            Err(_) => format!("X'{}'", encode_hex(bytes)),
        },
        Value::Int(integer) => integer.to_string(),
        Value::UInt(unsigned) => unsigned.to_string(),
        Value::Float(float) => float.to_string(),
        Value::Double(double) => double.to_string(),
        Value::Date(year, month, day, hour, minute, second, micros) => quote_sql_string_literal(
            &format_mysql_date_value(*year, *month, *day, *hour, *minute, *second, *micros),
        ),
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => {
            quote_sql_string_literal(&format_mysql_time_value(
                *is_negative,
                *days,
                *hours,
                *minutes,
                *seconds,
                *micros,
            ))
        }
    }
}

fn quote_sql_string_literal(raw: &str) -> String {
    format!("'{}'", raw.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>()
}

fn format_mysql_date_value(
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    micros: u32,
) -> String {
    if hour == 0 && minute == 0 && second == 0 && micros == 0 {
        return format!("{year:04}-{month:02}-{day:02}");
    }

    if micros == 0 {
        return format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}");
    }

    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{micros:06}")
}

fn format_mysql_time_value(
    is_negative: bool,
    days: u32,
    hours: u8,
    minutes: u8,
    seconds: u8,
    micros: u32,
) -> String {
    let sign = if is_negative { "-" } else { "" };
    let total_hours = days * 24 + hours as u32;

    if micros == 0 {
        return format!("{sign}{total_hours:02}:{minutes:02}:{seconds:02}");
    }

    format!("{sign}{total_hours:02}:{minutes:02}:{seconds:02}.{micros:06}")
}

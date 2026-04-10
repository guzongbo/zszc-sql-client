use super::{
    MysqlService, build_table_data_row, normalize_console_sql, normalize_identifier_name,
    normalize_raw_clause, quote_identifier, validate_raw_clause,
};
use crate::models::{
    ConnectionProfile, ExportDataFileResponse, ExportFileFormat, ExportQueryResultFileRequest,
    ExportQueryResultSqlTextRequest, ExportScope, ExportSqlTextResponse,
    ExportTableDataFileRequest, ExportTableDataSqlTextRequest, JsonRecord, TableDataColumn,
    TableDataRow,
};
use anyhow::{Context, Result, ensure};
use mysql::prelude::Queryable;
use serde_json::{Map, Value as JsonValue};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

impl MysqlService {
    pub fn export_table_data_file(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportTableDataFileRequest,
    ) -> Result<ExportDataFileResponse> {
        if matches!(payload.export_format, ExportFileFormat::Sql) {
            let sql_text = self.export_table_data_sql_text(
                profile,
                &ExportTableDataSqlTextRequest {
                    load_payload: payload.load_payload.clone(),
                    scope: payload.scope,
                    columns: payload.columns.clone(),
                    rows: payload.rows.clone(),
                },
            )?;
            write_text_to_file(&payload.file_path, &sql_text.content)?;

            return Ok(ExportDataFileResponse {
                file_path: payload.file_path.clone(),
                row_count: sql_text.row_count,
                export_format: ExportFileFormat::Sql,
                scope: payload.scope,
            });
        }

        match payload.scope {
            ExportScope::AllRows => self.export_all_table_rows(profile, payload),
            ExportScope::CurrentPage | ExportScope::SelectedRows => write_rows_to_file(
                &payload.file_path,
                payload.export_format,
                payload.scope,
                &payload.columns,
                &payload.rows,
            ),
        }
    }

    pub fn export_query_result_file(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportQueryResultFileRequest,
    ) -> Result<ExportDataFileResponse> {
        if matches!(payload.export_format, ExportFileFormat::Sql) {
            let sql_text = self.export_query_result_sql_text(
                profile,
                &ExportQueryResultSqlTextRequest {
                    execute_payload: payload.execute_payload.clone(),
                    scope: payload.scope,
                    columns: payload.columns.clone(),
                    rows: payload.rows.clone(),
                },
            )?;
            write_text_to_file(&payload.file_path, &sql_text.content)?;

            return Ok(ExportDataFileResponse {
                file_path: payload.file_path.clone(),
                row_count: sql_text.row_count,
                export_format: ExportFileFormat::Sql,
                scope: payload.scope,
            });
        }

        match payload.scope {
            ExportScope::AllRows => self.export_all_query_rows(profile, payload),
            ExportScope::CurrentPage | ExportScope::SelectedRows => write_rows_to_file(
                &payload.file_path,
                payload.export_format,
                payload.scope,
                &payload.columns,
                &payload.rows,
            ),
        }
    }

    pub fn export_table_data_sql_text(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportTableDataSqlTextRequest,
    ) -> Result<ExportSqlTextResponse> {
        let (columns, rows) = match payload.scope {
            ExportScope::AllRows => {
                self.load_all_table_export_rows(profile, &payload.load_payload)?
            }
            ExportScope::CurrentPage | ExportScope::SelectedRows => {
                (payload.columns.clone(), payload.rows.clone())
            }
        };

        let content = build_table_data_sql_text(
            &payload.load_payload.database_name,
            &payload.load_payload.table_name,
            &columns,
            &rows,
        );

        Ok(ExportSqlTextResponse {
            content,
            row_count: rows.len() as u64,
            scope: payload.scope,
        })
    }

    pub fn export_query_result_sql_text(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportQueryResultSqlTextRequest,
    ) -> Result<ExportSqlTextResponse> {
        let (columns, rows) = match payload.scope {
            ExportScope::AllRows => {
                self.load_all_query_export_rows(profile, &payload.execute_payload)?
            }
            ExportScope::CurrentPage | ExportScope::SelectedRows => {
                (payload.columns.clone(), payload.rows.clone())
            }
        };

        let content = build_query_result_sql_text(&columns, &rows);
        Ok(ExportSqlTextResponse {
            content,
            row_count: rows.len() as u64,
            scope: payload.scope,
        })
    }

    fn export_all_table_rows(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportTableDataFileRequest,
    ) -> Result<ExportDataFileResponse> {
        let normalized_where_clause =
            normalize_raw_clause(payload.load_payload.where_clause.as_deref());
        let normalized_order_by_clause =
            normalize_raw_clause(payload.load_payload.order_by_clause.as_deref());

        validate_raw_clause(normalized_where_clause.as_deref())?;
        validate_raw_clause(normalized_order_by_clause.as_deref())?;

        let table_context = self.load_table_data_context(
            profile,
            &payload.load_payload.database_name,
            &payload.load_payload.table_name,
        )?;
        let sql = build_full_table_export_sql(
            &payload.load_payload.database_name,
            &payload.load_payload.table_name,
            normalized_where_clause.as_deref(),
            normalized_order_by_clause.as_deref(),
        );

        self.with_conn(profile, |connection| {
            let result = connection
                .query_iter(sql.as_str())
                .context("导出表数据失败")?;
            write_query_result_to_file(
                result,
                &payload.file_path,
                payload.export_format,
                ExportScope::AllRows,
                &table_context.columns,
            )
        })
    }

    fn export_all_query_rows(
        &self,
        profile: &ConnectionProfile,
        payload: &ExportQueryResultFileRequest,
    ) -> Result<ExportDataFileResponse> {
        let normalized_sql = normalize_console_sql(&payload.execute_payload.sql)?;

        self.with_conn(profile, |connection| {
            prepare_query_result_connection(
                connection,
                payload.execute_payload.database_name.as_deref(),
            )?;

            let result = connection
                .query_iter(normalized_sql.as_str())
                .context("导出查询结果失败")?;
            let columns = extract_query_result_columns(&result);

            ensure!(!columns.is_empty(), "当前 SQL 没有结果集，无法导出");

            write_query_result_to_file(
                result,
                &payload.file_path,
                payload.export_format,
                ExportScope::AllRows,
                &columns,
            )
        })
    }

    fn load_all_table_export_rows(
        &self,
        profile: &ConnectionProfile,
        payload: &crate::models::LoadTableDataPayload,
    ) -> Result<(Vec<TableDataColumn>, Vec<TableDataRow>)> {
        let normalized_where_clause = normalize_raw_clause(payload.where_clause.as_deref());
        let normalized_order_by_clause = normalize_raw_clause(payload.order_by_clause.as_deref());

        validate_raw_clause(normalized_where_clause.as_deref())?;
        validate_raw_clause(normalized_order_by_clause.as_deref())?;

        let table_context =
            self.load_table_data_context(profile, &payload.database_name, &payload.table_name)?;
        let sql = build_full_table_export_sql(
            &payload.database_name,
            &payload.table_name,
            normalized_where_clause.as_deref(),
            normalized_order_by_clause.as_deref(),
        );

        self.with_conn(profile, |connection| {
            let result = connection
                .query_iter(sql.as_str())
                .context("导出表数据失败")?;
            let rows = collect_query_rows(result, &table_context.columns)?;
            Ok((table_context.columns.clone(), rows))
        })
    }

    fn load_all_query_export_rows(
        &self,
        profile: &ConnectionProfile,
        payload: &crate::models::ExecuteSqlPayload,
    ) -> Result<(Vec<TableDataColumn>, Vec<TableDataRow>)> {
        let normalized_sql = normalize_console_sql(&payload.sql)?;

        self.with_conn(profile, |connection| {
            prepare_query_result_connection(connection, payload.database_name.as_deref())?;

            let result = connection
                .query_iter(normalized_sql.as_str())
                .context("导出查询结果失败")?;
            let columns = extract_query_result_columns(&result);

            ensure!(!columns.is_empty(), "当前 SQL 没有结果集，无法导出");
            let rows = collect_query_rows(result, &columns)?;
            Ok((columns, rows))
        })
    }
}

fn build_full_table_export_sql(
    database_name: &str,
    table_name: &str,
    where_clause: Option<&str>,
    order_by_clause: Option<&str>,
) -> String {
    let mut sql = format!(
        "SELECT * FROM {}.{}",
        quote_identifier(database_name),
        quote_identifier(table_name)
    );

    if let Some(where_clause) = where_clause.filter(|value| !value.trim().is_empty()) {
        sql.push_str(" WHERE ");
        sql.push_str(where_clause.trim());
    }

    if let Some(order_by_clause) = order_by_clause.filter(|value| !value.trim().is_empty()) {
        sql.push_str(" ORDER BY ");
        sql.push_str(order_by_clause.trim());
    }

    sql
}

fn prepare_query_result_connection(
    connection: &mut mysql::PooledConn,
    database_name: Option<&str>,
) -> Result<()> {
    if let Some(database_name) = database_name {
        let normalized_database_name = normalize_identifier_name(database_name, "数据库名")?;
        connection
            .query_drop(format!(
                "USE {}",
                quote_identifier(&normalized_database_name)
            ))
            .context("切换数据库失败")?;
    }

    Ok(())
}

fn extract_query_result_columns(
    result: &mysql::QueryResult<'_, '_, '_, mysql::Text>,
) -> Vec<TableDataColumn> {
    result
        .columns()
        .as_ref()
        .iter()
        .map(|column| TableDataColumn {
            name: column.name_str().to_string(),
            data_type: format!("{:?}", column.column_type()).to_ascii_lowercase(),
            nullable: true,
            primary_key: false,
            auto_increment: false,
            default_value: None,
            comment: String::new(),
        })
        .collect::<Vec<_>>()
}

fn collect_query_rows(
    result: mysql::QueryResult<'_, '_, '_, mysql::Text>,
    columns: &[TableDataColumn],
) -> Result<Vec<TableDataRow>> {
    let column_names = columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let mut rows = Vec::new();

    for row_result in result {
        rows.push(build_table_data_row(row_result?, &column_names, &[])?);
    }

    Ok(rows)
}

fn write_query_result_to_file(
    result: mysql::QueryResult<'_, '_, '_, mysql::Text>,
    file_path: &str,
    export_format: ExportFileFormat,
    scope: ExportScope,
    columns: &[TableDataColumn],
) -> Result<ExportDataFileResponse> {
    let column_names = result
        .columns()
        .as_ref()
        .iter()
        .map(|column| column.name_str().to_string())
        .collect::<Vec<_>>();
    let mut writer = ExportFileWriter::create(file_path, export_format, columns)?;
    let mut row_count = 0_u64;

    for row_result in result {
        let row = build_table_data_row(row_result?, &column_names, &[])?;
        writer.write_row(&row.values)?;
        row_count += 1;
    }

    writer.finish()?;
    Ok(ExportDataFileResponse {
        file_path: file_path.to_string(),
        row_count,
        export_format,
        scope,
    })
}

fn write_rows_to_file(
    file_path: &str,
    export_format: ExportFileFormat,
    scope: ExportScope,
    columns: &[TableDataColumn],
    rows: &[TableDataRow],
) -> Result<ExportDataFileResponse> {
    let mut writer = ExportFileWriter::create(file_path, export_format, columns)?;
    for row in rows {
        writer.write_row(&row.values)?;
    }
    writer.finish()?;

    Ok(ExportDataFileResponse {
        file_path: file_path.to_string(),
        row_count: rows.len() as u64,
        export_format,
        scope,
    })
}

fn write_text_to_file(file_path: &str, content: &str) -> Result<()> {
    let path = Path::new(file_path);
    if let Some(parent) = path.parent().filter(|item| !item.as_os_str().is_empty()) {
        fs::create_dir_all(parent)
            .with_context(|| format!("无法创建导出目录: {}", parent.display()))?;
    }

    fs::write(path, content).with_context(|| format!("无法写入导出文件: {}", path.display()))
}

fn build_table_data_sql_text(
    database_name: &str,
    table_name: &str,
    columns: &[TableDataColumn],
    rows: &[TableDataRow],
) -> String {
    let mut output = String::new();
    output.push_str("-- ZSZC SQL Client 表数据导出\n");
    output.push_str(&format!(
        "-- source: {}.{}\n",
        quote_identifier(database_name),
        quote_identifier(table_name)
    ));
    output.push_str(&format!("-- rows: {}\n\n", rows.len()));

    if columns.is_empty() || rows.is_empty() {
        output.push_str("-- 当前范围没有可导出的数据行\n");
        return output;
    }

    let column_names = columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Vec<_>>();

    // 分块输出 INSERT，避免单条语句过长难以复制或执行。
    for chunk in rows.chunks(200) {
        output.push_str(&format!(
            "INSERT INTO {}.{} ({}) VALUES\n",
            quote_identifier(database_name),
            quote_identifier(table_name),
            column_names.join(", ")
        ));

        for (index, row) in chunk.iter().enumerate() {
            output.push_str("  (");
            output.push_str(
                &columns
                    .iter()
                    .map(|column| render_sql_literal(row.values.get(&column.name), column))
                    .collect::<Vec<_>>()
                    .join(", "),
            );
            output.push(')');
            output.push_str(if index + 1 == chunk.len() {
                ";\n\n"
            } else {
                ",\n"
            });
        }
    }

    output
}

fn build_query_result_sql_text(columns: &[TableDataColumn], rows: &[TableDataRow]) -> String {
    let mut output = String::new();
    output.push_str("-- ZSZC SQL Client 查询结果导出\n");
    output.push_str("-- 结果以 SELECT ... UNION ALL 形式保留，便于复制或二次加工\n");
    output.push_str(&format!("-- rows: {}\n\n", rows.len()));

    if columns.is_empty() || rows.is_empty() {
        output.push_str("-- 当前范围没有可导出的查询结果\n");
        return output;
    }

    for (row_index, row) in rows.iter().enumerate() {
        output.push_str("SELECT\n");

        for (column_index, column) in columns.iter().enumerate() {
            let literal = render_sql_literal(row.values.get(&column.name), column);
            let suffix = if row_index == 0 {
                format!(" AS {}", quote_identifier(&column.name))
            } else {
                String::new()
            };
            output.push_str("  ");
            output.push_str(&literal);
            output.push_str(&suffix);
            output.push_str(if column_index + 1 == columns.len() {
                "\n"
            } else {
                ",\n"
            });
        }

        output.push_str(if row_index + 1 == rows.len() {
            ";\n"
        } else {
            "UNION ALL\n"
        });
    }

    output
}

struct ExportFileWriter {
    format: ExportFileFormat,
    writer: BufWriter<File>,
    column_names: Vec<String>,
    first_json_row: bool,
}

impl ExportFileWriter {
    fn create(
        file_path: &str,
        format: ExportFileFormat,
        columns: &[TableDataColumn],
    ) -> Result<Self> {
        let path = Path::new(file_path);
        if let Some(parent) = path.parent().filter(|item| !item.as_os_str().is_empty()) {
            fs::create_dir_all(parent)
                .with_context(|| format!("无法创建导出目录: {}", parent.display()))?;
        }

        let file =
            File::create(path).with_context(|| format!("无法创建导出文件: {}", path.display()))?;
        let mut writer = BufWriter::new(file);
        let column_names = columns
            .iter()
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        match format {
            ExportFileFormat::Csv => write_csv_line(&mut writer, &column_names)?,
            ExportFileFormat::Json => writer.write_all(b"[\n")?,
            ExportFileFormat::Sql => unreachable!("SQL 导出走文本写入分支"),
        }

        Ok(Self {
            format,
            writer,
            column_names,
            first_json_row: true,
        })
    }

    fn write_row(&mut self, values: &JsonRecord) -> Result<()> {
        match self.format {
            ExportFileFormat::Csv => {
                let fields = self
                    .column_names
                    .iter()
                    .map(|name| escape_csv_field(&json_value_to_export_text(values.get(name))))
                    .collect::<Vec<_>>();
                write_csv_line(&mut self.writer, &fields)?;
            }
            ExportFileFormat::Json => {
                if !self.first_json_row {
                    self.writer.write_all(b",\n")?;
                }

                let mut object = Map::new();
                for name in &self.column_names {
                    object.insert(
                        name.clone(),
                        values.get(name).cloned().unwrap_or(JsonValue::Null),
                    );
                }

                serde_json::to_writer(&mut self.writer, &JsonValue::Object(object))
                    .context("写入 JSON 导出文件失败")?;
                self.first_json_row = false;
            }
            ExportFileFormat::Sql => unreachable!("SQL 导出走文本写入分支"),
        }

        Ok(())
    }

    fn finish(mut self) -> Result<()> {
        if matches!(self.format, ExportFileFormat::Json) {
            if !self.first_json_row {
                self.writer.write_all(b"\n")?;
            }
            self.writer.write_all(b"]\n")?;
        }

        self.writer.flush().context("刷新导出文件失败")
    }
}

fn json_value_to_export_text(value: Option<&JsonValue>) -> String {
    match value {
        None | Some(JsonValue::Null) => String::new(),
        Some(JsonValue::Bool(boolean)) => boolean.to_string(),
        Some(JsonValue::Number(number)) => number.to_string(),
        Some(JsonValue::String(text)) => text.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn escape_csv_field(raw: &str) -> String {
    if raw.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw.to_string()
    }
}

fn write_csv_line(writer: &mut BufWriter<File>, fields: &[String]) -> Result<()> {
    writer
        .write_all(fields.join(",").as_bytes())
        .context("写入 CSV 导出文件失败")?;
    writer.write_all(b"\n").context("写入 CSV 导出文件失败")
}

fn render_sql_literal(value: Option<&JsonValue>, column: &TableDataColumn) -> String {
    match value {
        None | Some(JsonValue::Null) => "NULL".to_string(),
        Some(JsonValue::Bool(boolean)) => {
            if *boolean {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        Some(JsonValue::Number(number)) => number.to_string(),
        Some(JsonValue::String(text)) => render_string_sql_literal(text, column),
        Some(other) => quote_sql_string(&serde_json::to_string(other).unwrap_or_default()),
    }
}

fn quote_sql_string(raw: &str) -> String {
    format!("'{}'", raw.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn render_string_sql_literal(text: &str, column: &TableDataColumn) -> String {
    if is_bit_like_type(&column.data_type) && contains_unprintable_control_chars(text) {
        return render_bit_literal(text.as_bytes(), &column.data_type);
    }

    if is_binary_like_type(&column.data_type) && contains_unprintable_control_chars(text) {
        return render_hex_literal(text.as_bytes());
    }

    quote_sql_string(text)
}

fn is_bit_like_type(data_type: &str) -> bool {
    data_type.trim().to_ascii_lowercase().starts_with("bit")
}

fn is_binary_like_type(data_type: &str) -> bool {
    let normalized = data_type.trim().to_ascii_lowercase();
    normalized.starts_with("binary")
        || normalized.starts_with("varbinary")
        || normalized.contains("blob")
}

fn contains_unprintable_control_chars(text: &str) -> bool {
    text.chars()
        .any(|char| char.is_control() && !matches!(char, '\n' | '\r' | '\t'))
}

fn render_bit_literal(bytes: &[u8], data_type: &str) -> String {
    let declared_width = parse_bit_width(data_type);

    if declared_width == Some(1) && bytes.len() == 1 {
        return if bytes[0] == 0 {
            "0".to_string()
        } else {
            "1".to_string()
        };
    }

    let bit_string = bytes
        .iter()
        .flat_map(|byte| {
            (0..8)
                .rev()
                .map(move |offset| if (byte >> offset) & 1 == 1 { '1' } else { '0' })
        })
        .collect::<String>();

    let normalized_bit_string = if let Some(width) = declared_width {
        if bit_string.len() > width {
            bit_string[bit_string.len() - width..].to_string()
        } else if bit_string.len() < width {
            format!("{}{}", "0".repeat(width - bit_string.len()), bit_string)
        } else {
            bit_string
        }
    } else {
        bit_string
    };

    format!("b'{}'", normalized_bit_string)
}

fn parse_bit_width(data_type: &str) -> Option<usize> {
    let start = data_type.find('(')?;
    let end = data_type[start + 1..].find(')')?;
    data_type[start + 1..start + 1 + end].trim().parse().ok()
}

fn render_hex_literal(bytes: &[u8]) -> String {
    format!("x'{}'", hex::encode_upper(bytes))
}

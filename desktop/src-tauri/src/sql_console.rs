use super::{
    MysqlService, build_query_page_message, build_table_data_row, collect_offset_page_window,
    collect_page_window, is_pageable_console_query, normalize_console_sql, quote_identifier,
};
use crate::models::{ConnectionProfile, ExecuteSqlPayload, SqlConsoleResult, TableDataColumn};
use anyhow::{Context, Result};
use mysql::PooledConn;
use mysql::prelude::Queryable;

impl MysqlService {
    pub fn execute_sql(
        &self,
        profile: &ConnectionProfile,
        payload: &ExecuteSqlPayload,
    ) -> Result<SqlConsoleResult> {
        let limit = payload.limit.unwrap_or(200).clamp(1, 500);
        let offset = payload.offset.unwrap_or(0);
        let normalized_sql = normalize_console_sql(&payload.sql)?;

        self.with_conn(profile, |connection| {
            if let Some(database_name) = payload.database_name.as_deref() {
                let normalized_database_name =
                    super::normalize_identifier_name(database_name, "数据库名")?;
                connection
                    .query_drop(format!(
                        "USE {}",
                        quote_identifier(&normalized_database_name)
                    ))
                    .context("切换数据库失败")?;
            }

            if is_pageable_console_query(&normalized_sql) {
                return execute_pageable_console_query(
                    connection,
                    profile,
                    payload,
                    &normalized_sql,
                    offset,
                    limit,
                );
            }

            execute_direct_console_query(
                connection,
                profile,
                payload,
                &normalized_sql,
                offset,
                limit,
            )
        })
    }
}

fn execute_pageable_console_query(
    connection: &mut PooledConn,
    profile: &ConnectionProfile,
    payload: &ExecuteSqlPayload,
    normalized_sql: &str,
    offset: u64,
    limit: u64,
) -> Result<SqlConsoleResult> {
    let page_sql = format!(
        "SELECT * FROM ({normalized_sql}) __zszc_console_page LIMIT {} OFFSET {offset}",
        limit + 1
    );
    let mut result = connection
        .query_iter(page_sql.as_str())
        .context("执行 SQL 失败")?;

    let columns = result
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
        .collect::<Vec<_>>();
    let column_names = columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let page_window = collect_page_window(
        result.by_ref().map(|row_result| {
            let row = row_result?;
            build_table_data_row(row, &column_names, &[])
        }),
        limit,
    )?;
    let total_rows = offset + page_window.total_rows;
    let range_start = if page_window.rows.is_empty() {
        0
    } else {
        offset + 1
    };
    let range_end = if page_window.rows.is_empty() {
        0
    } else {
        offset + page_window.rows.len() as u64
    };

    Ok(SqlConsoleResult {
        profile_id: profile.id.clone(),
        database_name: payload.database_name.clone(),
        executed_sql: normalized_sql.to_string(),
        result_kind: "query".to_string(),
        columns,
        rows: page_window.rows,
        affected_rows: 0,
        offset,
        limit,
        total_rows,
        row_count_exact: page_window.row_count_exact,
        truncated: page_window.truncated,
        message: build_query_page_message(
            range_start,
            range_end,
            total_rows,
            page_window.row_count_exact,
        ),
    })
}

fn execute_direct_console_query(
    connection: &mut PooledConn,
    profile: &ConnectionProfile,
    payload: &ExecuteSqlPayload,
    normalized_sql: &str,
    offset: u64,
    limit: u64,
) -> Result<SqlConsoleResult> {
    let mut result = connection
        .query_iter(normalized_sql)
        .context("执行 SQL 失败")?;

    let columns = result
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
        .collect::<Vec<_>>();

    if columns.is_empty() {
        let affected_rows = result.affected_rows();
        let info = result.info_str().to_string();

        return Ok(SqlConsoleResult {
            profile_id: profile.id.clone(),
            database_name: payload.database_name.clone(),
            executed_sql: normalized_sql.to_string(),
            result_kind: "mutation".to_string(),
            columns: vec![],
            rows: vec![],
            affected_rows,
            offset: 0,
            limit,
            total_rows: 0,
            row_count_exact: true,
            truncated: false,
            message: if info.trim().is_empty() {
                format!("语句执行成功，影响 {affected_rows} 行")
            } else {
                info
            },
        });
    }

    let column_names = columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let page_window = collect_offset_page_window(
        result.by_ref().map(|row_result| {
            let row = row_result?;
            build_table_data_row(row, &column_names, &[])
        }),
        offset,
        limit,
    )?;
    let range_start = if page_window.rows.is_empty() {
        0
    } else {
        offset + 1
    };
    let range_end = if page_window.rows.is_empty() {
        0
    } else {
        offset + page_window.rows.len() as u64
    };

    Ok(SqlConsoleResult {
        profile_id: profile.id.clone(),
        database_name: payload.database_name.clone(),
        executed_sql: normalized_sql.to_string(),
        result_kind: "query".to_string(),
        columns,
        rows: page_window.rows,
        affected_rows: 0,
        offset,
        limit,
        total_rows: page_window.total_rows,
        row_count_exact: page_window.row_count_exact,
        truncated: page_window.truncated,
        message: build_query_page_message(
            range_start,
            range_end,
            page_window.total_rows,
            page_window.row_count_exact,
        ),
    })
}

use crate::models::{
    ConnectionProfile, ConnectionTestResult, CreateTablePayload, DatabaseEntry, JsonRecord,
    MutationResult, SqlAutocompleteColumn, SqlAutocompleteSchema, SqlAutocompleteTable, SqlPreview,
    TableColumn, TableColumnSummary, TableDataColumn, TableDataRow, TableDdl, TableDesign,
    TableDesignMutationPayload, TableEntry,
};
use anyhow::{Context, Result, anyhow, ensure};
use mysql::prelude::Queryable;
use mysql::{Opts, OptsBuilder, Pool, PooledConn, Row, Value};
use serde_json::{Number, Value as JsonValue};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

#[path = "data_export.rs"]
mod data_export;
#[path = "sql_console.rs"]
mod sql_console;
#[path = "table_data.rs"]
mod table_data;

const SYSTEM_DATABASES: [&str; 4] = ["information_schema", "mysql", "performance_schema", "sys"];
const MYSQL_STATEMENT_CACHE_SIZE: usize = 128;
const MYSQL_IO_TIMEOUT_SECS: u64 = 30;
const MYSQL_TCP_KEEPALIVE_TIME_MS: u32 = 60_000;

#[derive(Debug)]
struct PageWindow<T> {
    rows: Vec<T>,
    total_rows: u64,
    row_count_exact: bool,
    truncated: bool,
}

#[derive(Debug)]
struct TableDataContext {
    columns: Vec<TableDataColumn>,
    primary_keys: Vec<String>,
}

#[derive(Debug, Default)]
pub struct MysqlService {
    pools: Mutex<HashMap<String, Pool>>,
}

impl MysqlService {
    pub fn test_connection(&self, profile: &ConnectionProfile) -> Result<ConnectionTestResult> {
        let mut connection = Self::create_pool(profile)?.get_conn()?;
        let server_version = connection
            .query_first::<String, _>("SELECT VERSION()")
            .context("读取 MySQL 版本失败")?
            .unwrap_or_else(|| "unknown".to_string());
        let current_database = connection
            .query_first::<Option<String>, _>("SELECT DATABASE()")
            .context("读取当前数据库失败")?;

        Ok(ConnectionTestResult {
            server_version,
            current_database: current_database.flatten(),
        })
    }

    pub fn disconnect(&self, profile_id: &str) -> Result<()> {
        self.pools
            .lock()
            .map_err(|_| anyhow!("连接池状态不可用"))?
            .remove(profile_id);

        Ok(())
    }

    pub fn disconnect_all(&self) -> Result<()> {
        self.pools
            .lock()
            .map_err(|_| anyhow!("连接池状态不可用"))?
            .clear();

        Ok(())
    }

    pub fn list_databases(&self, profile: &ConnectionProfile) -> Result<Vec<DatabaseEntry>> {
        self.with_conn(profile, |connection| {
            let table_counts: HashMap<String, u64> = connection
                .query_map(
                    "
                    SELECT TABLE_SCHEMA, COUNT(*)
                    FROM information_schema.TABLES
                    WHERE TABLE_TYPE = 'BASE TABLE'
                    GROUP BY TABLE_SCHEMA
                    ",
                    |(schema, count)| (schema, count),
                )
                .context("读取数据库表数量失败")?
                .into_iter()
                .collect();

            let databases = connection
                .query_map("SHOW DATABASES", |database_name: String| database_name)
                .context("读取数据库列表失败")?
                .into_iter()
                .filter(|database_name| !SYSTEM_DATABASES.contains(&database_name.as_str()))
                .map(|database_name| DatabaseEntry {
                    table_count: table_counts.get(&database_name).copied().unwrap_or(0),
                    name: database_name,
                })
                .collect::<Vec<_>>();

            Ok(databases)
        })
    }

    pub fn create_database(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
    ) -> Result<MutationResult> {
        let normalized_database_name = normalize_identifier_name(database_name, "数据库名")?;
        let statement = format!(
            "CREATE DATABASE {}",
            quote_identifier(&normalized_database_name)
        );

        self.with_conn(profile, |connection| {
            connection
                .query_drop(statement.as_str())
                .context("创建数据库失败")?;

            Ok(MutationResult {
                affected_rows: 1,
                statements: vec![statement],
            })
        })
    }

    pub fn list_tables(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
    ) -> Result<Vec<TableEntry>> {
        let sql = "
            SELECT
                t.TABLE_NAME,
                t.TABLE_ROWS,
                COUNT(c.COLUMN_NAME) AS column_count
            FROM information_schema.TABLES t
            LEFT JOIN information_schema.COLUMNS c
                ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
               AND c.TABLE_NAME = t.TABLE_NAME
            WHERE t.TABLE_SCHEMA = ?
              AND t.TABLE_TYPE = 'BASE TABLE'
            GROUP BY t.TABLE_NAME, t.TABLE_ROWS
            ORDER BY t.TABLE_NAME
        ";

        self.with_conn(profile, |connection| {
            connection
                .exec_map(
                    sql,
                    (database_name,),
                    |(name, table_rows, column_count): (String, Option<u64>, Option<u64>)| {
                        TableEntry {
                            name,
                            table_rows,
                            column_count,
                        }
                    },
                )
                .context("读取数据表列表失败")
        })
    }

    pub fn load_sql_autocomplete(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
    ) -> Result<SqlAutocompleteSchema> {
        let sql = "
            SELECT
                TABLE_NAME,
                COLUMN_NAME,
                COLUMN_TYPE,
                IS_NULLABLE,
                COLUMN_KEY,
                EXTRA,
                COLUMN_COMMENT
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ?
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        ";

        self.with_conn(profile, |connection| {
            let rows = connection
                .exec_map(
                    sql,
                    (database_name,),
                    |(
                        table_name,
                        column_name,
                        column_type,
                        is_nullable,
                        column_key,
                        extra,
                        column_comment,
                    ): (
                        String,
                        String,
                        String,
                        String,
                        String,
                        String,
                        String,
                    )| {
                        (
                            table_name,
                            SqlAutocompleteColumn {
                                name: column_name,
                                data_type: column_type,
                                nullable: is_nullable.eq_ignore_ascii_case("YES"),
                                primary_key: column_key.eq_ignore_ascii_case("PRI"),
                                auto_increment: extra
                                    .to_ascii_lowercase()
                                    .contains("auto_increment"),
                                comment: column_comment,
                            },
                        )
                    },
                )
                .context("读取 SQL 自动补全元数据失败")?;

            let mut grouped = BTreeMap::<String, Vec<SqlAutocompleteColumn>>::new();
            for (table_name, column) in rows {
                grouped.entry(table_name).or_default().push(column);
            }

            let tables = grouped
                .into_iter()
                .map(|(name, columns)| SqlAutocompleteTable { name, columns })
                .collect();

            Ok(SqlAutocompleteSchema {
                profile_id: profile.id.clone(),
                database_name: database_name.to_string(),
                tables,
            })
        })
    }

    pub fn list_table_columns(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
    ) -> Result<Vec<TableColumnSummary>> {
        let columns = self.load_columns(profile, database_name, table_name)?;
        Ok(columns
            .into_iter()
            .map(|column| TableColumnSummary {
                name: column.name,
                data_type: column.full_data_type,
            })
            .collect())
    }

    pub fn load_table_design(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
    ) -> Result<TableDesign> {
        let columns = self.load_columns(profile, database_name, table_name)?;
        let ddl = self.get_table_ddl(profile, database_name, table_name)?.ddl;

        Ok(TableDesign {
            profile_id: profile.id.clone(),
            database_name: database_name.to_string(),
            table_name: table_name.to_string(),
            columns,
            ddl,
        })
    }

    pub fn preview_table_design_sql(
        &self,
        profile: &ConnectionProfile,
        payload: &TableDesignMutationPayload,
    ) -> Result<SqlPreview> {
        let current_columns =
            self.load_columns(profile, &payload.database_name, &payload.table_name)?;
        let statements = build_alter_table_statements(
            &payload.database_name,
            &payload.table_name,
            &current_columns,
            &payload.columns,
        )?;

        Ok(SqlPreview { statements })
    }

    pub fn preview_create_table_sql(
        &self,
        _profile: &ConnectionProfile,
        payload: &CreateTablePayload,
    ) -> Result<SqlPreview> {
        Ok(SqlPreview {
            statements: vec![build_create_table_statement(
                &payload.database_name,
                &payload.table_name,
                &payload.columns,
            )?],
        })
    }

    pub fn apply_table_design_changes(
        &self,
        profile: &ConnectionProfile,
        payload: &TableDesignMutationPayload,
    ) -> Result<MutationResult> {
        let preview = self.preview_table_design_sql(profile, payload)?;

        if preview.statements.is_empty() {
            return Ok(MutationResult {
                affected_rows: 0,
                statements: vec![],
            });
        }

        self.with_conn(profile, |connection| {
            for statement in &preview.statements {
                connection
                    .query_drop(statement.as_str())
                    .with_context(|| format!("执行表结构变更失败: {statement}"))?;
            }

            Ok(MutationResult {
                affected_rows: preview.statements.len() as u64,
                statements: preview.statements,
            })
        })
    }

    pub fn create_table(
        &self,
        profile: &ConnectionProfile,
        payload: &CreateTablePayload,
    ) -> Result<MutationResult> {
        let statement = build_create_table_statement(
            &payload.database_name,
            &payload.table_name,
            &payload.columns,
        )?;

        self.with_conn(profile, |connection| {
            connection
                .query_drop(statement.as_str())
                .context("创建数据表失败")?;

            Ok(MutationResult {
                affected_rows: 1,
                statements: vec![statement],
            })
        })
    }

    pub fn get_table_ddl(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
    ) -> Result<TableDdl> {
        let sql = format!(
            "SHOW CREATE TABLE {}.{}",
            quote_identifier(database_name),
            quote_identifier(table_name)
        );

        self.with_conn(profile, |connection| {
            let (_, ddl): (String, String) = connection
                .query_first(sql)
                .context("读取 DDL 失败")?
                .context("表不存在或无权限读取 DDL")?;

            Ok(TableDdl { ddl })
        })
    }

    #[allow(dead_code)]
    pub fn load_all_table_rows(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
        key_columns: &[String],
    ) -> Result<Vec<TableDataRow>> {
        let sql = format!(
            "SELECT * FROM {}.{}",
            quote_identifier(database_name),
            quote_identifier(table_name)
        );

        self.with_conn(profile, |connection| {
            let result = connection
                .query_iter(sql.as_str())
                .context("读取全量表数据失败")?;
            let column_names = result
                .columns()
                .as_ref()
                .iter()
                .map(|column| column.name_str().to_string())
                .collect::<Vec<_>>();

            result
                .map(|row_result| {
                    let row = row_result?;
                    build_table_data_row(row, &column_names, key_columns)
                })
                .collect::<Result<Vec<_>>>()
        })
    }

    #[allow(dead_code)]
    pub fn preview_table_sync_sql(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
        source_columns: Vec<TableColumn>,
    ) -> Result<SqlPreview> {
        let current_columns = self.load_columns(profile, database_name, table_name)?;
        let statements = build_alter_table_statements(
            database_name,
            table_name,
            &current_columns,
            &source_columns,
        )?;
        Ok(SqlPreview { statements })
    }

    fn load_columns(
        &self,
        profile: &ConnectionProfile,
        database_name: &str,
        table_name: &str,
    ) -> Result<Vec<TableColumn>> {
        let sql = format!(
            "SHOW FULL COLUMNS FROM {} FROM {}",
            quote_identifier(table_name),
            quote_identifier(database_name)
        );

        self.with_conn(profile, |connection| {
            connection
                .query_map(
                    sql,
                    |(
                        field,
                        column_type,
                        _collation,
                        null_flag,
                        key,
                        default_value,
                        extra,
                        _privileges,
                        comment,
                    ): (
                        String,
                        String,
                        Option<String>,
                        String,
                        String,
                        Option<String>,
                        String,
                        String,
                        String,
                    )| {
                        let (data_type, length, scale) = parse_type_details(&column_type);
                        TableColumn {
                            name: field,
                            data_type,
                            full_data_type: column_type,
                            length,
                            scale,
                            nullable: null_flag.eq_ignore_ascii_case("YES"),
                            primary_key: key.eq_ignore_ascii_case("PRI"),
                            auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
                            default_value,
                            comment,
                            ordinal_position: 0,
                        }
                    },
                )
                .context("读取字段列表失败")
                .map(|columns| {
                    columns
                        .into_iter()
                        .enumerate()
                        .map(|(index, mut column)| {
                            column.ordinal_position = index as u32 + 1;
                            column
                        })
                        .collect()
                })
        })
    }

    fn with_conn<T>(
        &self,
        profile: &ConnectionProfile,
        handler: impl FnOnce(&mut PooledConn) -> Result<T>,
    ) -> Result<T> {
        let pool = self.get_or_create_pool(profile)?;
        let mut connection = pool.get_conn().context("获取数据库连接失败")?;
        handler(&mut connection)
    }

    fn get_or_create_pool(&self, profile: &ConnectionProfile) -> Result<Pool> {
        let mut pools = self.pools.lock().map_err(|_| anyhow!("连接池状态不可用"))?;

        if let Some(pool) = pools.get(&profile.id) {
            return Ok(pool.clone());
        }

        let pool = Self::create_pool(profile)?;
        pools.insert(profile.id.clone(), pool.clone());
        Ok(pool)
    }

    fn create_pool(profile: &ConnectionProfile) -> Result<Pool> {
        let mut builder = OptsBuilder::new();
        builder = builder
            .ip_or_hostname(Some(profile.host.clone()))
            .tcp_port(profile.port)
            .user(Some(profile.username.clone()))
            .pass(Some(profile.password.clone()))
            .read_timeout(Some(Duration::from_secs(MYSQL_IO_TIMEOUT_SECS)))
            .write_timeout(Some(Duration::from_secs(MYSQL_IO_TIMEOUT_SECS)))
            .tcp_keepalive_time_ms(Some(MYSQL_TCP_KEEPALIVE_TIME_MS))
            .stmt_cache_size(Some(MYSQL_STATEMENT_CACHE_SIZE));

        Pool::new(Opts::from(builder)).context("初始化 MySQL 连接池失败")
    }
}

fn build_table_data_row(
    row: Row,
    column_names: &[String],
    primary_keys: &[String],
) -> Result<TableDataRow> {
    let values = row.unwrap();
    let json_values = column_names
        .iter()
        .cloned()
        .zip(values.into_iter().map(mysql_value_to_json))
        .collect::<JsonRecord>();

    let row_key = (!primary_keys.is_empty()).then(|| {
        primary_keys
            .iter()
            .filter_map(|primary_key| {
                json_values
                    .get(primary_key)
                    .cloned()
                    .map(|value| (primary_key.clone(), value))
            })
            .collect::<JsonRecord>()
    });

    Ok(TableDataRow {
        row_key,
        values: json_values,
    })
}

fn collect_page_window<T>(
    rows: impl IntoIterator<Item = Result<T>>,
    limit: u64,
) -> Result<PageWindow<T>> {
    let mut collected_rows = Vec::new();

    for row in rows {
        collected_rows.push(row?);
        if collected_rows.len() as u64 > limit {
            let total_rows = collected_rows.len() as u64;
            collected_rows.truncate(limit as usize);
            return Ok(PageWindow {
                rows: collected_rows,
                total_rows,
                row_count_exact: false,
                truncated: true,
            });
        }
    }

    Ok(PageWindow {
        total_rows: collected_rows.len() as u64,
        rows: collected_rows,
        row_count_exact: true,
        truncated: false,
    })
}

fn collect_offset_page_window<T>(
    rows: impl IntoIterator<Item = Result<T>>,
    offset: u64,
    limit: u64,
) -> Result<PageWindow<T>> {
    let mut total_rows = 0_u64;
    let mut page_rows = Vec::new();

    for row in rows {
        let row = row?;
        if total_rows < offset {
            total_rows += 1;
            continue;
        }

        if page_rows.len() as u64 >= limit {
            total_rows += 1;
            return Ok(PageWindow {
                rows: page_rows,
                total_rows,
                row_count_exact: false,
                truncated: true,
            });
        }

        total_rows += 1;
        page_rows.push(row);
    }

    Ok(PageWindow {
        rows: page_rows,
        total_rows,
        row_count_exact: true,
        truncated: false,
    })
}

fn build_query_page_message(
    range_start: u64,
    range_end: u64,
    total_rows: u64,
    row_count_exact: bool,
) -> String {
    if row_count_exact {
        return format!("查询成功，当前展示 {range_start}-{range_end} 行，共 {total_rows} 行");
    }

    format!("查询成功，当前展示 {range_start}-{range_end} 行，结果总数未统计")
}

fn validate_raw_clause(raw_clause: Option<&str>) -> Result<()> {
    if let Some(raw_clause) = raw_clause {
        ensure!(
            !raw_clause.contains(';') && !raw_clause.contains('；'),
            "查询条件中不允许出现分号，避免拼接多条 SQL"
        );
    }
    Ok(())
}

fn normalize_identifier_name(raw: &str, field_name: &str) -> Result<String> {
    let normalized = raw.trim();
    ensure!(!normalized.is_empty(), "{field_name}不能为空");
    ensure!(
        !normalized.contains('.')
            && !normalized.contains(' ')
            && !normalized.contains('`')
            && !normalized.contains('\n')
            && !normalized.contains('\r')
            && !normalized.contains('\t'),
        "{field_name}不能包含空格、点号或反引号"
    );
    Ok(normalized.to_string())
}

fn normalize_raw_clause(raw_clause: Option<&str>) -> Option<String> {
    raw_clause.map(|raw| {
        raw.chars()
            .map(|character| match character {
                '‘' | '’' | '＇' => '\'',
                '“' | '”' => '"',
                '\u{3000}' => ' ',
                _ => character,
            })
            .collect::<String>()
    })
}

fn normalize_console_sql(raw_sql: &str) -> Result<String> {
    let normalized = normalize_raw_clause(Some(raw_sql))
        .unwrap_or_default()
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string();

    ensure!(!normalized.is_empty(), "SQL 不能为空");
    ensure!(
        !normalized.contains(';') && !normalized.contains('；'),
        "控制台当前仅支持执行单条 SQL"
    );

    Ok(normalized)
}

fn is_pageable_console_query(normalized_sql: &str) -> bool {
    let lower = normalized_sql.trim_start().to_ascii_lowercase();
    lower.starts_with("select ") || lower.starts_with("with ")
}

fn quote_identifier(raw: &str) -> String {
    format!("`{}`", raw.replace('`', "``"))
}

fn parse_type_details(column_type: &str) -> (String, Option<u32>, Option<u32>) {
    let lower = column_type.trim().to_ascii_lowercase();
    let data_type = lower
        .split(|character: char| character == '(' || character.is_whitespace())
        .next()
        .unwrap_or("")
        .to_string();

    if let Some(start) = lower.find('(')
        && let Some(end_offset) = lower[start + 1..].find(')')
    {
        let inner = &lower[start + 1..start + 1 + end_offset];
        let parts = inner
            .split(',')
            .map(|part| part.trim().parse::<u32>().ok())
            .collect::<Vec<_>>();

        match parts.as_slice() {
            [Some(length)] => return (data_type, Some(*length), None),
            [Some(length), Some(scale)] => return (data_type, Some(*length), Some(*scale)),
            _ => {}
        }
    }

    (data_type, None, None)
}

fn build_alter_table_statements(
    database_name: &str,
    table_name: &str,
    current_columns: &[TableColumn],
    draft_columns: &[TableColumn],
) -> Result<Vec<String>> {
    validate_draft_columns(draft_columns)?;

    let current_map = current_columns
        .iter()
        .map(|column| (column.name.clone(), column))
        .collect::<BTreeMap<_, _>>();
    let draft_map = draft_columns
        .iter()
        .map(|column| (column.name.clone(), column))
        .collect::<BTreeMap<_, _>>();

    let mut clauses = Vec::new();

    for current_column in current_columns {
        if !draft_map.contains_key(&current_column.name) {
            clauses.push(format!(
                "DROP COLUMN {}",
                quote_identifier(&current_column.name)
            ));
        }
    }

    for draft_column in draft_columns {
        if let Some(current_column) = current_map.get(&draft_column.name) {
            if current_column_changed(current_column, draft_column) {
                clauses.push(format!(
                    "MODIFY COLUMN {}",
                    build_column_definition(draft_column)?
                ));
            }
        } else {
            clauses.push(format!(
                "ADD COLUMN {}",
                build_column_definition(draft_column)?
            ));
        }
    }

    let current_primary_keys = current_columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let draft_primary_keys = draft_columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    if current_primary_keys != draft_primary_keys {
        if !current_primary_keys.is_empty() {
            clauses.push("DROP PRIMARY KEY".to_string());
        }

        if !draft_primary_keys.is_empty() {
            clauses.push(format!(
                "ADD PRIMARY KEY ({})",
                draft_primary_keys
                    .iter()
                    .map(|column_name| quote_identifier(column_name))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }

    if clauses.is_empty() {
        return Ok(vec![]);
    }

    let sql = format!(
        "ALTER TABLE {}.{} {}",
        quote_identifier(database_name),
        quote_identifier(table_name),
        clauses.join(", ")
    );

    Ok(vec![sql])
}

fn build_create_table_statement(
    database_name: &str,
    table_name: &str,
    columns: &[TableColumn],
) -> Result<String> {
    let normalized_database_name = normalize_identifier_name(database_name, "数据库名")?;
    let normalized_table_name = normalize_identifier_name(table_name, "表名")?;
    validate_draft_columns(columns)?;

    let column_clauses = columns
        .iter()
        .map(build_column_definition)
        .collect::<Result<Vec<_>>>()?;

    let primary_key_clause = {
        let primary_keys = columns
            .iter()
            .filter(|column| column.primary_key)
            .map(|column| quote_identifier(&column.name))
            .collect::<Vec<_>>();

        if primary_keys.is_empty() {
            None
        } else {
            Some(format!("PRIMARY KEY ({})", primary_keys.join(", ")))
        }
    };

    let mut all_clauses = column_clauses;
    if let Some(primary_key_clause) = primary_key_clause {
        all_clauses.push(primary_key_clause);
    }

    Ok(format!(
        "CREATE TABLE {}.{} (\n  {}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        quote_identifier(&normalized_database_name),
        quote_identifier(&normalized_table_name),
        all_clauses.join(",\n  ")
    ))
}

fn validate_draft_columns(columns: &[TableColumn]) -> Result<()> {
    ensure!(!columns.is_empty(), "至少保留一个字段");

    let mut names = HashSet::new();
    for column in columns {
        ensure!(!column.name.trim().is_empty(), "字段名不能为空");
        ensure!(!column.data_type.trim().is_empty(), "字段类型不能为空");
        ensure!(
            names.insert(column.name.trim().to_string()),
            "字段名不能重复: {}",
            column.name
        );
    }

    Ok(())
}

fn current_column_changed(current: &TableColumn, draft: &TableColumn) -> bool {
    current.data_type != draft.data_type
        || current.length != draft.length
        || current.scale != draft.scale
        || current.nullable != draft.nullable
        || current.auto_increment != draft.auto_increment
        || current.default_value != draft.default_value
        || current.comment != draft.comment
}

fn build_column_definition(column: &TableColumn) -> Result<String> {
    let mut definition = format!(
        "{} {}",
        quote_identifier(column.name.trim()),
        build_data_type_sql(column)
    );

    if column.primary_key || !column.nullable {
        definition.push_str(" NOT NULL");
    } else {
        definition.push_str(" NULL");
    }

    if let Some(default_value) = column.default_value.as_ref() {
        definition.push_str(" DEFAULT ");
        definition.push_str(&render_default_value(&column.data_type, default_value));
    }

    if column.auto_increment {
        definition.push_str(" AUTO_INCREMENT");
    }

    if !column.comment.trim().is_empty() {
        definition.push_str(" COMMENT ");
        definition.push_str(&quote_string_literal(column.comment.trim()));
    }

    Ok(definition)
}

fn build_data_type_sql(column: &TableColumn) -> String {
    let data_type = column.data_type.trim().to_ascii_lowercase();

    match (column.length, column.scale) {
        (Some(length), Some(scale)) => format!("{data_type}({length},{scale})"),
        (Some(length), None) => format!("{data_type}({length})"),
        _ => data_type,
    }
}

fn render_default_value(data_type: &str, default_value: &str) -> String {
    let raw = default_value.trim();
    let upper = raw.to_ascii_uppercase();

    if upper == "NULL" {
        return "NULL".to_string();
    }

    if upper == "CURRENT_TIMESTAMP" || upper == "CURRENT_TIMESTAMP()" {
        return upper;
    }

    let numeric_types = [
        "int",
        "integer",
        "tinyint",
        "smallint",
        "mediumint",
        "bigint",
        "decimal",
        "numeric",
        "float",
        "double",
        "real",
    ];

    if numeric_types.contains(&data_type) && raw.parse::<f64>().is_ok() {
        return raw.to_string();
    }

    quote_string_literal(raw)
}

fn quote_string_literal(raw: &str) -> String {
    format!("'{}'", raw.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn json_to_mysql_value(value: &JsonValue) -> Result<Value> {
    match value {
        JsonValue::Null => Ok(Value::NULL),
        JsonValue::Bool(boolean) => Ok(Value::Int(i64::from(*boolean))),
        JsonValue::Number(number) => {
            if let Some(integer) = number.as_i64() {
                Ok(Value::Int(integer))
            } else if let Some(unsigned) = number.as_u64() {
                Ok(Value::UInt(unsigned))
            } else if let Some(float) = number.as_f64() {
                Ok(Value::Double(float))
            } else {
                Err(anyhow!("不支持的数字类型"))
            }
        }
        JsonValue::String(text) => Ok(Value::Bytes(text.clone().into_bytes())),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            Ok(Value::Bytes(serde_json::to_string(value)?.into_bytes()))
        }
    }
}

fn mysql_value_to_json(value: Value) -> JsonValue {
    match value {
        Value::NULL => JsonValue::Null,
        Value::Bytes(bytes) => JsonValue::String(String::from_utf8_lossy(&bytes).to_string()),
        Value::Int(integer) => JsonValue::Number(Number::from(integer)),
        Value::UInt(unsigned) => JsonValue::Number(Number::from(unsigned)),
        Value::Float(float) => Number::from_f64(float as f64)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        Value::Double(double) => Number::from_f64(double)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        Value::Date(year, month, day, hour, minute, second, micros) => JsonValue::String(
            format_mysql_date(year, month, day, hour, minute, second, micros),
        ),
        Value::Time(is_negative, days, hours, minutes, seconds, micros) => JsonValue::String(
            format_mysql_time(is_negative, days, hours, minutes, seconds, micros),
        ),
    }
}

fn format_mysql_date(
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

fn format_mysql_time(
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

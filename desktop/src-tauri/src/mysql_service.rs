use crate::models::{
    ApplyTableDataChangesPayload, ConnectionProfile, ConnectionTestResult, CreateTablePayload,
    DatabaseEntry, DeletedRowPayload, ExecuteSqlPayload, InsertedRowPayload, JsonRecord,
    LoadTableDataPayload, MutationResult, SqlConsoleResult, SqlPreview, TableColumn,
    TableColumnSummary, TableDataColumn, TableDataPage, TableDataRow, TableDdl, TableDesign,
    TableDesignMutationPayload, TableEntry, UpdatedRowPayload,
};
use anyhow::{Context, Result, anyhow, ensure};
use mysql::prelude::Queryable;
use mysql::{Opts, OptsBuilder, Pool, PooledConn, Row, TxOpts, Value};
use serde_json::{Number, Value as JsonValue};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;

const SYSTEM_DATABASES: [&str; 4] = ["information_schema", "mysql", "performance_schema", "sys"];

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
        let statement = format!("CREATE DATABASE {}", quote_identifier(&normalized_database_name));

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
        let statement =
            build_create_table_statement(&payload.database_name, &payload.table_name, &payload.columns)?;

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

    pub fn load_table_data(
        &self,
        profile: &ConnectionProfile,
        payload: &LoadTableDataPayload,
    ) -> Result<TableDataPage> {
        let normalized_where_clause = normalize_raw_clause(payload.where_clause.as_deref());
        let normalized_order_by_clause =
            normalize_raw_clause(payload.order_by_clause.as_deref());

        validate_raw_clause(normalized_where_clause.as_deref())?;
        validate_raw_clause(normalized_order_by_clause.as_deref())?;

        let limit = payload.limit.unwrap_or(100).clamp(1, 500);
        let offset = payload.offset.unwrap_or(0);
        let table_design =
            self.load_table_design(profile, &payload.database_name, &payload.table_name)?;
        let primary_keys = table_design
            .columns
            .iter()
            .filter(|column| column.primary_key)
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();

        let mut count_sql = format!(
            "SELECT COUNT(*) FROM {}.{}",
            quote_identifier(&payload.database_name),
            quote_identifier(&payload.table_name)
        );
        let mut data_sql = format!(
            "SELECT * FROM {}.{}",
            quote_identifier(&payload.database_name),
            quote_identifier(&payload.table_name)
        );

        if let Some(where_clause) = normalized_where_clause
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            count_sql.push_str(" WHERE ");
            count_sql.push_str(where_clause.trim());
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

        data_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

        self.with_conn(profile, |connection| {
            let total_rows = connection
                .query_first::<u64, _>(count_sql)
                .context("读取数据总数失败")?
                .unwrap_or(0);

            let result = connection.query_iter(data_sql).context("读取表数据失败")?;

            let column_names = result
                .columns()
                .as_ref()
                .iter()
                .map(|column| column.name_str().to_string())
                .collect::<Vec<_>>();

            let rows = result
                .map(|row_result| {
                    let row = row_result?;
                    build_table_data_row(row, &column_names, &primary_keys)
                })
                .collect::<Result<Vec<_>, _>>()?;

            let columns = table_design
                .columns
                .iter()
                .map(|column| TableDataColumn {
                    name: column.name.clone(),
                    data_type: column.full_data_type.clone(),
                    nullable: column.nullable,
                    primary_key: column.primary_key,
                    auto_increment: column.auto_increment,
                    default_value: column.default_value.clone(),
                    comment: column.comment.clone(),
                })
                .collect();

            Ok(TableDataPage {
                profile_id: profile.id.clone(),
                database_name: payload.database_name.clone(),
                table_name: payload.table_name.clone(),
                columns,
                rows,
                primary_keys: primary_keys.clone(),
                offset,
                limit,
                total_rows,
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
                let normalized_database_name = normalize_identifier_name(database_name, "数据库名")?;
                connection
                    .query_drop(format!("USE {}", quote_identifier(&normalized_database_name)))
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
            .pass(Some(profile.password.clone()));

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

fn execute_pageable_console_query(
    connection: &mut PooledConn,
    profile: &ConnectionProfile,
    payload: &ExecuteSqlPayload,
    normalized_sql: &str,
    offset: u64,
    limit: u64,
) -> Result<SqlConsoleResult> {
    let count_sql = format!(
        "SELECT COUNT(*) FROM ({normalized_sql}) __zszc_console_count"
    );
    let total_rows = connection
        .query_first::<u64, _>(count_sql)
        .context("统计 SQL 结果失败")?
        .unwrap_or(0);

    let page_sql = format!(
        "SELECT * FROM ({normalized_sql}) __zszc_console_page LIMIT {limit} OFFSET {offset}"
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

    let mut rows = Vec::new();
    for row_result in result.by_ref() {
        rows.push(build_table_data_row(row_result?, &column_names, &[])?);
    }

    let range_start = if total_rows == 0 { 0 } else { offset + 1 };
    let range_end = if total_rows == 0 {
        0
    } else {
        offset + rows.len() as u64
    };

    Ok(SqlConsoleResult {
        profile_id: profile.id.clone(),
        database_name: payload.database_name.clone(),
        executed_sql: normalized_sql.to_string(),
        result_kind: "query".to_string(),
        columns,
        rows,
        affected_rows: 0,
        offset,
        limit,
        total_rows,
        truncated: range_end < total_rows,
        message: format!("查询成功，当前展示 {range_start}-{range_end} 行，共 {total_rows} 行"),
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
    let mut all_rows = Vec::new();

    for row_result in result.by_ref() {
        all_rows.push(build_table_data_row(row_result?, &column_names, &[])?);
    }

    let total_rows = all_rows.len() as u64;
    let rows = all_rows
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect::<Vec<_>>();
    let range_start = if total_rows == 0 { 0 } else { offset + 1 };
    let range_end = if total_rows == 0 {
        0
    } else {
        offset + rows.len() as u64
    };

    Ok(SqlConsoleResult {
        profile_id: profile.id.clone(),
        database_name: payload.database_name.clone(),
        executed_sql: normalized_sql.to_string(),
        result_kind: "query".to_string(),
        columns,
        rows,
        affected_rows: 0,
        offset,
        limit,
        total_rows,
        truncated: range_end < total_rows,
        message: format!("查询成功，当前展示 {range_start}-{range_end} 行，共 {total_rows} 行"),
    })
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

    if let Some(start) = lower.find('(') {
        if let Some(end_offset) = lower[start + 1..].find(')') {
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
        let (statement, _) = build_delete_statement(
            &payload.database_name,
            &payload.table_name,
            &primary_keys,
            deleted_row,
        )?;
        statements.push(statement);
    }

    for updated_row in &payload.updated_rows {
        let (statement, _) = build_update_statement(
            &payload.database_name,
            &payload.table_name,
            columns,
            &primary_keys,
            updated_row,
        )?;
        if !statement.is_empty() {
            statements.push(statement);
        }
    }

    for inserted_row in &payload.inserted_rows {
        let (statement, _) = build_insert_statement(
            &payload.database_name,
            &payload.table_name,
            columns,
            inserted_row,
        )?;
        statements.push(statement);
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

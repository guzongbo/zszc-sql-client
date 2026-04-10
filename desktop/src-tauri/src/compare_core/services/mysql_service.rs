use mysql_async::{Conn, OptsBuilder, Pool, Row, Value, prelude::Queryable};

use crate::{
    compare_core::errors::AppError,
    compare_core::models::api::{DataSourceConnectionConfig, DbConnectionConfig},
    compare_core::utils::{
        sql_builder::quote_identifier,
        value::{RowMap, sql_literal},
    },
};

pub struct MySqlServerInspection {
    pub server_version: String,
    pub databases: Vec<String>,
}

pub struct TableKeyColumns {
    pub columns: Vec<String>,
    pub safe_for_streaming: bool,
}

#[derive(Clone)]
pub struct TableColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub column_type: String,
}

pub struct MySqlServerSession {
    pool: Pool,
}

#[derive(Clone)]
pub struct MySqlSession {
    pool: Pool,
    database: String,
}

impl MySqlServerSession {
    pub fn new(config: &DataSourceConnectionConfig) -> Self {
        let opts = OptsBuilder::default()
            .ip_or_hostname(config.host.clone())
            .tcp_port(config.port)
            .user(Some(config.username.clone()))
            .pass(Some(config.password.clone()));

        Self {
            pool: Pool::new(opts),
        }
    }

    pub async fn inspect(&self) -> Result<MySqlServerInspection, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;

        // 先执行轻量查询确认连接可用，再读取当前账号可见的数据库清单。
        let server_version: Option<String> = conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(AppError::from_mysql)?;

        let mut databases: Vec<String> = conn
            .query_map("SHOW DATABASES", |database: String| database)
            .await
            .map_err(AppError::from_mysql)?;
        databases.sort();

        Ok(MySqlServerInspection {
            server_version: server_version.unwrap_or_else(|| "unknown".to_string()),
            databases,
        })
    }
}

impl MySqlSession {
    pub fn new(config: &DbConnectionConfig) -> Self {
        let opts = OptsBuilder::default()
            .ip_or_hostname(config.host.clone())
            .tcp_port(config.port)
            .user(Some(config.username.clone()))
            .pass(Some(config.password.clone()))
            .db_name(Some(config.database.clone()));

        Self {
            pool: Pool::new(opts),
            database: config.database.clone(),
        }
    }

    pub async fn list_tables(&self) -> Result<Vec<String>, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let sql = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME";
        conn.exec_map(sql, (&self.database,), |table_name: String| table_name)
            .await
            .map_err(AppError::from_mysql)
    }

    pub async fn list_columns(&self, table: &str) -> Result<Vec<String>, AppError> {
        self.list_column_definitions(table)
            .await
            .map(|columns| columns.into_iter().map(|column| column.name).collect())
    }

    pub async fn list_column_definitions(
        &self,
        table: &str,
    ) -> Result<Vec<TableColumnDefinition>, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let sql = "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
        conn.exec_map(
            sql,
            (&self.database, table),
            |(name, data_type, column_type): (String, String, String)| TableColumnDefinition {
                name,
                data_type,
                column_type,
            },
        )
        .await
        .map_err(AppError::from_mysql)
    }

    pub async fn fetch_rows_by_keys(
        &self,
        table: &str,
        columns: &[String],
        key_columns: &[String],
        key_rows: &[RowMap],
    ) -> Result<Vec<RowMap>, AppError> {
        if columns.is_empty() || key_columns.is_empty() || key_rows.is_empty() {
            return Ok(Vec::new());
        }

        let select_columns = columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");

        let where_clause = key_rows
            .iter()
            .map(|row| {
                let predicates = key_columns
                    .iter()
                    .map(|column| {
                        let value = row.get(column).unwrap_or(&mysql_async::Value::NULL);
                        format!("{} <=> {}", quote_identifier(column), sql_literal(value))
                    })
                    .collect::<Vec<_>>()
                    .join(" AND ");
                format!("({predicates})")
            })
            .collect::<Vec<_>>()
            .join(" OR ");

        let order_clause = key_columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT {} FROM {}.{} WHERE {} ORDER BY {}",
            select_columns,
            quote_identifier(&self.database),
            quote_identifier(table),
            where_clause,
            order_clause
        );

        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let rows: Vec<Row> = conn.query(sql).await.map_err(AppError::from_mysql)?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            result.push(row_to_map(row));
        }

        Ok(result)
    }

    pub fn build_select_row_hashes_sql(
        &self,
        table: &str,
        columns: &[TableColumnDefinition],
        key_columns: &[String],
        hash_alias: &str,
    ) -> String {
        self.build_select_row_hashes_sql_with_filter(table, columns, key_columns, hash_alias, None)
    }

    pub fn build_select_row_hashes_sql_with_filter(
        &self,
        table: &str,
        columns: &[TableColumnDefinition],
        key_columns: &[String],
        hash_alias: &str,
        filter: Option<&str>,
    ) -> String {
        let mut select_parts = key_columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>();
        select_parts.push(format!(
            "{} AS {}",
            build_row_hash_expression(columns),
            quote_identifier(hash_alias)
        ));

        let order_clause = key_columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");

        let mut sql = format!(
            "SELECT {} FROM {}.{}",
            select_parts.join(", "),
            quote_identifier(&self.database),
            quote_identifier(table)
        );

        if let Some(filter) = filter {
            sql.push_str(" WHERE ");
            sql.push_str(filter);
        }

        sql.push_str(" ORDER BY ");
        sql.push_str(&order_clause);
        sql
    }

    pub fn build_chunk_hash_sql(
        &self,
        table: &str,
        columns: &[TableColumnDefinition],
        order_column: &str,
        count_alias: &str,
        hash_alias: &str,
        filter: Option<&str>,
    ) -> String {
        let aggregate_hash = format!(
            "COALESCE(SHA2(GROUP_CONCAT({row_hash} ORDER BY {order_column} SEPARATOR '#'), 256), '')",
            row_hash = build_row_hash_expression(columns),
            order_column = quote_identifier(order_column)
        );

        let mut sql = format!(
            "SELECT COUNT(*) AS {count_alias}, {aggregate_hash} AS {hash_alias} FROM {database}.{table}",
            count_alias = quote_identifier(count_alias),
            aggregate_hash = aggregate_hash,
            hash_alias = quote_identifier(hash_alias),
            database = quote_identifier(&self.database),
            table = quote_identifier(table)
        );

        if let Some(filter) = filter {
            sql.push_str(" WHERE ");
            sql.push_str(filter);
        }

        sql
    }

    pub async fn load_key_columns(&self, table: &str) -> Result<TableKeyColumns, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;

        let primary_sql = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION";
        let primary_keys: Vec<String> = conn
            .exec_map(
                primary_sql,
                (&self.database, table),
                |column_name: String| column_name,
            )
            .await
            .map_err(AppError::from_mysql)?;

        if !primary_keys.is_empty() {
            return Ok(TableKeyColumns {
                columns: primary_keys,
                safe_for_streaming: true,
            });
        }

        let unique_sql = "SELECT s.INDEX_NAME, s.COLUMN_NAME, s.SEQ_IN_INDEX, c.IS_NULLABLE FROM INFORMATION_SCHEMA.STATISTICS s INNER JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME AND c.COLUMN_NAME = s.COLUMN_NAME WHERE s.TABLE_SCHEMA = ? AND s.TABLE_NAME = ? AND s.NON_UNIQUE = 0 AND s.INDEX_NAME <> 'PRIMARY' ORDER BY s.INDEX_NAME, s.SEQ_IN_INDEX";
        let unique_index_columns: Vec<(String, String, u64, String)> = conn
            .exec_map(
                unique_sql,
                (&self.database, table),
                |(index_name, column_name, seq_in_index, is_nullable): (
                    String,
                    String,
                    u64,
                    String,
                )| { (index_name, column_name, seq_in_index, is_nullable) },
            )
            .await
            .map_err(AppError::from_mysql)?;

        let mut selected_index = String::new();
        let mut columns = Vec::new();
        let mut safe_for_streaming = true;

        for (index_name, column_name, _, is_nullable) in unique_index_columns {
            if selected_index.is_empty() {
                selected_index = index_name.clone();
            }

            if index_name == selected_index {
                if !is_nullable.eq_ignore_ascii_case("NO") {
                    safe_for_streaming = false;
                }
                columns.push(column_name);
                continue;
            }

            break;
        }

        Ok(TableKeyColumns {
            safe_for_streaming: !columns.is_empty() && safe_for_streaming,
            columns,
        })
    }

    pub async fn list_key_columns(&self, table: &str) -> Result<Vec<String>, AppError> {
        self.load_key_columns(table)
            .await
            .map(|result| result.columns)
    }

    pub async fn show_create_table(&self, table: &str) -> Result<String, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let sql = format!("SHOW CREATE TABLE {}", quote_identifier(table));
        let row: Option<(String, String)> =
            conn.query_first(sql).await.map_err(AppError::from_mysql)?;

        row.map(|(_, create_table_sql)| create_table_sql)
            .ok_or_else(|| AppError::Parse(format!("未读取到表 {} 的建表语句", table)))
    }

    pub async fn get_table_checksum(&self, table: &str) -> Result<Option<u64>, AppError> {
        let mut conn = self.get_conn().await?;
        let sql = format!("CHECKSUM TABLE {}", quote_identifier(table));
        let row: Option<Row> = conn.query_first(sql).await.map_err(AppError::from_mysql)?;

        let Some(row) = row else {
            return Ok(None);
        };

        let mut mapped = row_to_map(row);
        match mapped.remove("Checksum") {
            Some(Value::UInt(value)) => Ok(Some(value)),
            Some(Value::Int(value)) if value >= 0 => Ok(Some(value as u64)),
            Some(Value::Bytes(bytes)) => {
                let text = std::str::from_utf8(&bytes)
                    .map_err(|error| AppError::Parse(format!("表级校验和解析失败: {error}")))?;
                let value = text
                    .parse::<u64>()
                    .map_err(|error| AppError::Parse(format!("表级校验和解析失败: {error}")))?;
                Ok(Some(value))
            }
            Some(Value::NULL) | None => Ok(None),
            Some(other) => Err(AppError::Parse(format!(
                "表级校验和字段类型异常: {:?}",
                other
            ))),
        }
    }

    pub async fn get_key_range_values(
        &self,
        table: &str,
        key_column: &str,
    ) -> Result<(Option<Value>, Option<Value>), AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let sql = format!(
            "SELECT MIN({column}) AS min_key, MAX({column}) AS max_key FROM {database}.{table}",
            column = quote_identifier(key_column),
            database = quote_identifier(&self.database),
            table = quote_identifier(table)
        );
        let row: Option<Row> = conn.query_first(sql).await.map_err(AppError::from_mysql)?;

        match row {
            Some(row) => {
                let mut mapped = row_to_map(row);
                let min_value = mapped.remove("min_key").unwrap_or(Value::NULL);
                let max_value = mapped.remove("max_key").unwrap_or(Value::NULL);

                Ok((
                    if matches!(min_value, Value::NULL) {
                        None
                    } else {
                        Some(min_value)
                    },
                    if matches!(max_value, Value::NULL) {
                        None
                    } else {
                        Some(max_value)
                    },
                ))
            }
            None => Ok((None, None)),
        }
    }

    pub async fn get_table_row_estimate(&self, table: &str) -> Result<Option<u64>, AppError> {
        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let sql = "SELECT TABLE_ROWS AS row_estimate FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
        let row: Option<Row> = conn
            .exec_first(sql, (&self.database, table))
            .await
            .map_err(AppError::from_mysql)?;

        let Some(row) = row else {
            return Ok(None);
        };

        let mut mapped = row_to_map(row);
        match mapped.remove("row_estimate") {
            Some(Value::UInt(value)) => Ok(Some(value)),
            Some(Value::Int(value)) if value >= 0 => Ok(Some(value as u64)),
            Some(Value::Bytes(bytes)) => {
                let text = std::str::from_utf8(&bytes)
                    .map_err(|error| AppError::Parse(format!("表行数估算解析失败: {error}")))?;
                let value = text
                    .trim()
                    .parse::<u64>()
                    .map_err(|error| AppError::Parse(format!("表行数估算解析失败: {error}")))?;
                Ok(Some(value))
            }
            Some(Value::NULL) | None => Ok(None),
            Some(other) => Err(AppError::Parse(format!(
                "表行数估算字段类型异常: {:?}",
                other
            ))),
        }
    }

    pub async fn fetch_rows(
        &self,
        table: &str,
        columns: &[String],
    ) -> Result<Vec<RowMap>, AppError> {
        if columns.is_empty() {
            return Ok(Vec::new());
        }

        let select_columns = columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT {} FROM {}.{}",
            select_columns,
            quote_identifier(&self.database),
            quote_identifier(table)
        );

        let mut conn = self.pool.get_conn().await.map_err(AppError::from_mysql)?;
        let rows: Vec<Row> = conn.query(sql).await.map_err(AppError::from_mysql)?;

        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            result.push(row_to_map(row));
        }

        Ok(result)
    }

    pub async fn get_conn(&self) -> Result<Conn, AppError> {
        self.pool.get_conn().await.map_err(AppError::from_mysql)
    }

    pub fn database_name(&self) -> &str {
        &self.database
    }

    pub fn build_select_rows_sql(
        &self,
        table: &str,
        columns: &[String],
        order_columns: &[String],
    ) -> String {
        let select_columns = columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");

        let mut sql = format!(
            "SELECT {} FROM {}.{}",
            select_columns,
            quote_identifier(&self.database),
            quote_identifier(table)
        );

        if !order_columns.is_empty() {
            let order_clause = order_columns
                .iter()
                .map(|column| quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(" ORDER BY ");
            sql.push_str(&order_clause);
        }

        sql
    }
}

fn build_row_hash_expression(columns: &[TableColumnDefinition]) -> String {
    if columns.is_empty() {
        return "SHA2('', 256)".to_string();
    }

    let hash_parts = columns
        .iter()
        .map(|column| {
            let family = hash_value_family(&column.data_type, &column.column_type);
            format!(
                "CONCAT('{}:', COALESCE(HEX(CAST({} AS BINARY)), 'NULL'))",
                family,
                quote_identifier(&column.name)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!("SHA2(CONCAT_WS('#', {}), 256)", hash_parts)
}

fn hash_value_family(data_type: &str, column_type: &str) -> &'static str {
    let normalized_data_type = data_type.to_ascii_lowercase();
    let normalized_column_type = column_type.to_ascii_lowercase();

    match normalized_data_type.as_str() {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" => {
            if normalized_column_type.contains("unsigned") {
                "uint"
            } else {
                "int"
            }
        }
        "float" => "float",
        "double" | "real" => "double",
        "date" | "datetime" | "timestamp" => "date",
        "time" => "time",
        _ => "bytes",
    }
}

pub fn row_to_map(row: Row) -> RowMap {
    let column_names = row
        .columns_ref()
        .iter()
        .map(|column| column.name_str().to_string())
        .collect::<Vec<_>>();

    let values = row.unwrap();
    let mut mapped = RowMap::new();

    for (name, value) in column_names.into_iter().zip(values.into_iter()) {
        mapped.insert(name, value);
    }

    mapped
}

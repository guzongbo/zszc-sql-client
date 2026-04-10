use crate::compare_core::utils::value::{RowMap, sql_literal};

pub fn quote_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn qualified_table(database: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(database), quote_identifier(table))
}

fn build_where_clause(columns: &[String], row: &RowMap) -> String {
    let mut clauses = Vec::with_capacity(columns.len());
    for column in columns {
        let value = row.get(column).unwrap_or(&mysql_async::Value::NULL);
        clauses.push(format!(
            "{} <=> {}",
            quote_identifier(column),
            sql_literal(value)
        ));
    }
    clauses.join(" AND ")
}

pub fn build_insert_sql(database: &str, table: &str, columns: &[String], row: &RowMap) -> String {
    let column_part = columns
        .iter()
        .map(|column| quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");

    let value_part = columns
        .iter()
        .map(|column| {
            let value = row.get(column).unwrap_or(&mysql_async::Value::NULL);
            sql_literal(value)
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "INSERT INTO {} ({}) VALUES ({});",
        qualified_table(database, table),
        column_part,
        value_part
    )
}

pub fn build_delete_by_keys_sql(
    database: &str,
    table: &str,
    key_columns: &[String],
    row: &RowMap,
) -> String {
    format!(
        "DELETE FROM {} WHERE {};",
        qualified_table(database, table),
        build_where_clause(key_columns, row)
    )
}

pub fn build_delete_by_row_sql(
    database: &str,
    table: &str,
    columns: &[String],
    row: &RowMap,
) -> String {
    format!(
        "DELETE FROM {} WHERE {} LIMIT 1;",
        qualified_table(database, table),
        build_where_clause(columns, row)
    )
}

pub fn build_update_sql(
    database: &str,
    table: &str,
    update_columns: &[String],
    key_columns: &[String],
    row: &RowMap,
) -> Option<String> {
    if update_columns.is_empty() {
        return None;
    }

    let set_clause = update_columns
        .iter()
        .map(|column| {
            let value = row.get(column).unwrap_or(&mysql_async::Value::NULL);
            format!("{} = {}", quote_identifier(column), sql_literal(value))
        })
        .collect::<Vec<_>>()
        .join(", ");

    Some(format!(
        "UPDATE {} SET {} WHERE {};",
        qualified_table(database, table),
        set_clause,
        build_where_clause(key_columns, row)
    ))
}

pub fn build_script(statements: &[String]) -> String {
    if statements.is_empty() {
        return "-- 未检测到数据差异，无需同步。".to_string();
    }

    let mut script = Vec::with_capacity(statements.len() + 4);
    script.push("SET FOREIGN_KEY_CHECKS = 0;".to_string());
    script.push("START TRANSACTION;".to_string());
    script.extend(statements.iter().cloned());
    script.push("COMMIT;".to_string());
    script.push("SET FOREIGN_KEY_CHECKS = 1;".to_string());

    script.join("\n")
}

use crate::compare_core::errors::AppError;
use crate::compare_core::models::api as core_api;
use crate::compare_core::services::compare_service as core_compare;
use crate::models::{
    CompareDetailPageRequest, CompareDetailPageResponse, CompareDetailType,
    CompareHistoryPerformance, CompareHistoryPerformanceStage, CompareSummary,
    CompareTableDiscoveryResponse, CompareTaskPhase, CompareTaskPhaseProgress, ConnectionProfile,
    DataCompareRequest, DataCompareResponse, ExportSqlFileRequest, ExportSqlFileResponse,
    JsonRecord, RowSample, SkippedTable, TableCompareResult, TableSqlSelection, UpdateSample,
};
use anyhow::{Result, anyhow};
use serde_json::Value as JsonValue;
use std::time::Instant;

#[derive(Clone, Default)]
pub struct CompareService {
    core: core_compare::CompareService,
}

impl std::fmt::Debug for CompareService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CompareService")
    }
}

#[derive(Clone)]
pub struct CompareExecutionUpdate {
    pub total_tables: usize,
    pub completed_tables: usize,
    pub current_table: Option<String>,
    pub current_phase: CompareTaskPhase,
    pub current_phase_progress: Option<CompareTaskPhaseProgress>,
}

#[derive(Clone, Copy, Default)]
pub struct CompareExecutionControl<'a> {
    pub compare_id: Option<&'a str>,
    pub on_progress: Option<&'a (dyn Fn(CompareExecutionUpdate) + Send + Sync)>,
    pub is_cancelled: Option<&'a (dyn Fn() -> bool + Send + Sync)>,
}

impl CompareService {
    pub fn cleanup_compare_cache(&self, compare_id: &str) -> Result<()> {
        self.core
            .cleanup_compare_cache(compare_id)
            .map_err(core_error_to_anyhow)
    }

    pub async fn discover_tables(
        &self,
        request: &crate::models::CompareTableDiscoveryRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<CompareTableDiscoveryResponse> {
        request.validate()?;
        let response = self
            .core
            .discover_tables(&core_api::TableDiscoveryRequest {
                source: to_core_db_config(source_profile, &request.source_database_name),
                target: to_core_db_config(target_profile, &request.target_database_name),
            })
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(CompareTableDiscoveryResponse {
            source_tables: response.source_tables,
            target_tables: response.target_tables,
            common_tables: response.common_tables,
        })
    }

    pub async fn compare(
        &self,
        request: &DataCompareRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<DataCompareResponse> {
        self.compare_with_control(request, source_profile, target_profile, None)
            .await
    }

    pub async fn compare_with_control(
        &self,
        request: &DataCompareRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
        control: Option<&CompareExecutionControl<'_>>,
    ) -> Result<DataCompareResponse> {
        request.validate()?;
        let started_at = Instant::now();
        let core_request = to_core_compare_request(request, source_profile, target_profile);

        let progress_callback = |update: core_compare::CompareExecutionUpdate| {
            if let Some(callback) = control.and_then(|item| item.on_progress) {
                callback(CompareExecutionUpdate {
                    total_tables: update.total_tables,
                    completed_tables: update.completed_tables,
                    current_table: update.current_table,
                    current_phase: map_core_compare_phase(update.current_phase),
                    current_phase_progress: update.current_phase_progress.map(|progress| {
                        CompareTaskPhaseProgress {
                            current: progress.current,
                            total: progress.total,
                        }
                    }),
                });
            }
        };
        let cancel_callback = || {
            control
                .and_then(|item| item.is_cancelled)
                .map(|checker| checker())
                .unwrap_or(false)
        };
        let core_control = core_compare::CompareExecutionControl {
            compare_id: control.and_then(|item| item.compare_id),
            on_progress: control.map(|_| {
                &progress_callback as &(dyn Fn(core_compare::CompareExecutionUpdate) + Send + Sync)
            }),
            is_cancelled: control.map(|_| &cancel_callback as &(dyn Fn() -> bool + Send + Sync)),
        };

        let response = self
            .core
            .compare_with_control(&core_request, control.map(|_| &core_control))
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(DataCompareResponse {
            compare_id: response.compare_id,
            summary: CompareSummary {
                total_tables: response.summary.total_tables,
                compared_tables: response.summary.compared_tables,
                skipped_tables: response.summary.skipped_tables,
                total_insert_count: response.summary.total_insert_count,
                total_update_count: response.summary.total_update_count,
                total_delete_count: response.summary.total_delete_count,
                total_sql_statements: response.summary.total_sql_statements,
            },
            skipped_tables: response
                .skipped_tables
                .into_iter()
                .map(|item| SkippedTable {
                    source_table: item.source_table,
                    target_table: item.target_table,
                    reason: item.reason,
                })
                .collect(),
            table_results: response
                .table_results
                .into_iter()
                .map(map_core_table_result)
                .collect(),
            performance: CompareHistoryPerformance {
                total_elapsed_ms: started_at.elapsed().as_millis() as u64,
                stages: vec![CompareHistoryPerformanceStage {
                    key: "compare_core".to_string(),
                    label: "对比引擎执行".to_string(),
                    elapsed_ms: started_at.elapsed().as_millis() as u64,
                    item_count: Some(response.summary.compared_tables),
                    note: Some(
                        "已启用表级校验和预筛、键控哈希扫描、整数键分块哈希与 SQLite 差异缓存"
                            .to_string(),
                    ),
                }],
                max_parallelism: Some(8),
            },
        })
    }

    pub async fn export_sql_file(
        &self,
        request: &ExportSqlFileRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<ExportSqlFileResponse> {
        request.compare_request.validate()?;
        let response = self
            .core
            .export_sql_file(&core_api::ExportSqlFileRequest {
                compare_id: request.compare_id.clone(),
                compare_request: to_core_compare_request(
                    &request.compare_request,
                    source_profile,
                    target_profile,
                ),
                table_selections: request
                    .table_selections
                    .iter()
                    .map(map_table_sql_selection)
                    .collect(),
                file_path: request.file_path.clone(),
            })
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(ExportSqlFileResponse {
            file_path: response.file_path,
            insert_count: response.insert_count,
            update_count: response.update_count,
            delete_count: response.delete_count,
        })
    }

    pub async fn load_detail_page(
        &self,
        request: &CompareDetailPageRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<CompareDetailPageResponse> {
        request.validate()?;
        let core_request = core_api::CompareDetailPageRequest {
            compare_id: request.compare_id.clone(),
            compare_request: to_core_compare_request(
                &request.compare_request,
                source_profile,
                target_profile,
            ),
            source_table: request.source_table.clone(),
            target_table: request.target_table.clone(),
            detail_type: map_compare_detail_type(request.detail_type),
            expected_total: request.normalized_expected_total().max(1),
            offset: request.normalized_offset(),
            limit: request.normalized_limit(),
        };

        let response = self
            .core
            .load_detail_page(&core_request)
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(CompareDetailPageResponse {
            source_table: response.source_table,
            target_table: response.target_table,
            detail_type: request.detail_type,
            total: response.total,
            offset: response.offset,
            limit: response.limit,
            has_more: response.has_more,
            row_columns: response.row_columns.clone(),
            row_items: response
                .row_items
                .into_iter()
                .map(|item| RowSample {
                    signature: item.signature,
                    row: row_values_to_record(&response.row_columns, item.values),
                })
                .collect(),
            update_items: response
                .update_items
                .into_iter()
                .map(map_core_update_sample)
                .collect(),
        })
    }
}

fn to_core_compare_request(
    request: &DataCompareRequest,
    source_profile: &ConnectionProfile,
    target_profile: &ConnectionProfile,
) -> core_api::CompareRequest {
    core_api::CompareRequest {
        source: to_core_db_config(source_profile, &request.source_database_name),
        target: to_core_db_config(target_profile, &request.target_database_name),
        table_mode: if request.table_mode == "selected" {
            core_api::TableMode::Selected
        } else {
            core_api::TableMode::All
        },
        selected_tables: request.selected_tables.clone(),
        table_mappings: vec![],
        options: core_api::CompareOptions {
            generate_insert: true,
            generate_update: true,
            generate_delete: true,
            preview_limit: request.normalized_preview_limit(),
        },
    }
}

fn to_core_db_config(
    profile: &ConnectionProfile,
    database_name: &str,
) -> core_api::DbConnectionConfig {
    core_api::DbConnectionConfig {
        host: profile.host.clone(),
        port: profile.port,
        username: profile.username.clone(),
        password: profile.password.clone(),
        database: database_name.to_string(),
    }
}

fn map_core_compare_phase(phase: core_api::CompareTaskPhase) -> CompareTaskPhase {
    match phase {
        core_api::CompareTaskPhase::Pending => CompareTaskPhase::Pending,
        core_api::CompareTaskPhase::DiscoverTables => CompareTaskPhase::DiscoverTables,
        core_api::CompareTaskPhase::PrepareTable => CompareTaskPhase::PrepareTable,
        core_api::CompareTaskPhase::TableChecksum => CompareTaskPhase::TableChecksum,
        core_api::CompareTaskPhase::KeyedHashScan => CompareTaskPhase::KeyedHashScan,
        core_api::CompareTaskPhase::ChunkHashScan => CompareTaskPhase::ChunkHashScan,
        core_api::CompareTaskPhase::SourceStageLoad => CompareTaskPhase::SourceStageLoad,
        core_api::CompareTaskPhase::TargetStageLoad => CompareTaskPhase::TargetStageLoad,
        core_api::CompareTaskPhase::FinalizeCache => CompareTaskPhase::FinalizeCache,
        core_api::CompareTaskPhase::Completed => CompareTaskPhase::Completed,
    }
}

fn map_compare_detail_type(detail_type: CompareDetailType) -> core_api::CompareDetailType {
    match detail_type {
        CompareDetailType::Insert => core_api::CompareDetailType::Insert,
        CompareDetailType::Update => core_api::CompareDetailType::Update,
        CompareDetailType::Delete => core_api::CompareDetailType::Delete,
    }
}

fn map_table_sql_selection(item: &TableSqlSelection) -> core_api::TableSqlSelection {
    core_api::TableSqlSelection {
        source_table: item.source_table.clone(),
        target_table: item.target_table.clone(),
        table_enabled: item.table_enabled,
        insert_enabled: item.insert_enabled,
        update_enabled: item.update_enabled,
        delete_enabled: item.delete_enabled,
        excluded_insert_signatures: item.excluded_insert_signatures.clone(),
        excluded_update_signatures: item.excluded_update_signatures.clone(),
        excluded_delete_signatures: item.excluded_delete_signatures.clone(),
    }
}

fn map_core_table_result(item: core_api::TableCompareResult) -> TableCompareResult {
    TableCompareResult {
        source_table: item.source_table,
        target_table: item.target_table,
        key_columns: item.key_columns,
        compared_columns: item.compared_columns,
        compare_mode: item.compare_mode,
        insert_count: item.insert_count,
        update_count: item.update_count,
        delete_count: item.delete_count,
        warnings: item.warnings,
        sample_inserts: item
            .sample_inserts
            .into_iter()
            .map(map_core_row_sample)
            .collect(),
        sample_updates: item
            .sample_updates
            .into_iter()
            .map(map_core_update_sample)
            .collect(),
        sample_deletes: item
            .sample_deletes
            .into_iter()
            .map(map_core_row_sample)
            .collect(),
    }
}

fn map_core_row_sample(item: core_api::RowSample) -> RowSample {
    RowSample {
        signature: item.signature,
        row: json_value_to_record(item.row),
    }
}

fn map_core_update_sample(item: core_api::UpdateSample) -> UpdateSample {
    UpdateSample {
        signature: item.signature,
        key: json_value_to_record(item.key),
        source_row: json_value_to_record(item.source_row),
        target_row: json_value_to_record(item.target_row),
        diff_columns: item.diff_columns,
    }
}

fn row_values_to_record(columns: &[String], values: Vec<JsonValue>) -> JsonRecord {
    columns.iter().cloned().zip(values).collect()
}

fn json_value_to_record(value: JsonValue) -> JsonRecord {
    match value {
        JsonValue::Object(object) => object.into_iter().collect(),
        _ => JsonRecord::new(),
    }
}

fn core_error_to_anyhow(error: AppError) -> anyhow::Error {
    anyhow!(error.to_string())
}

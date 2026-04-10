use crate::compare_core::errors::AppError;
use crate::compare_core::models::api as core_api;
use crate::compare_core::models::desktop as core_desktop;
use crate::compare_core::services::structure_compare_service as core_structure;
use crate::models::{
    CompareHistoryPerformance, CompareHistoryPerformanceStage, ConnectionProfile,
    StructureCompareDetailRequest, StructureCompareDetailResponse, StructureCompareRequest,
    StructureCompareResponse, StructureCompareSummary, StructureDetailCategory,
    StructureExportSqlFileRequest, StructureExportSqlFileResponse, StructureTableItem,
};
use anyhow::{Result, anyhow};

#[derive(Clone, Default)]
pub struct StructureCompareService {
    core: core_structure::StructureCompareService,
}

impl std::fmt::Debug for StructureCompareService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("StructureCompareService")
    }
}

impl StructureCompareService {
    pub async fn compare(
        &self,
        request: &StructureCompareRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<StructureCompareResponse> {
        request.validate()?;
        let response = self
            .core
            .compare(&core_api::StructureCompareRequest {
                source: to_core_db_config(source_profile, &request.source_database_name),
                target: to_core_db_config(target_profile, &request.target_database_name),
                options: core_api::StructureCompareOptions {
                    detail_concurrency: request.detail_concurrency,
                    preload_details: request.normalized_preload_details(),
                },
            })
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(StructureCompareResponse {
            summary: StructureCompareSummary {
                source_table_count: response.summary.source_table_count,
                target_table_count: response.summary.target_table_count,
                added_table_count: response.summary.added_table_count,
                modified_table_count: response.summary.modified_table_count,
                deleted_table_count: response.summary.deleted_table_count,
            },
            added_tables: response
                .added_tables
                .into_iter()
                .map(map_structure_table_item)
                .collect(),
            modified_tables: response
                .modified_tables
                .into_iter()
                .map(map_structure_table_item)
                .collect(),
            deleted_tables: response
                .deleted_tables
                .into_iter()
                .map(map_structure_table_item)
                .collect(),
            performance: map_core_performance(response.performance),
        })
    }

    pub async fn load_detail(
        &self,
        request: &StructureCompareDetailRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<StructureCompareDetailResponse> {
        request.validate()?;
        let response = self
            .core
            .load_detail(&core_api::StructureCompareDetailRequest {
                compare_request: core_api::StructureCompareRequest {
                    source: to_core_db_config(
                        source_profile,
                        &request.compare_request.source_database_name,
                    ),
                    target: to_core_db_config(
                        target_profile,
                        &request.compare_request.target_database_name,
                    ),
                    options: core_api::StructureCompareOptions {
                        detail_concurrency: request.compare_request.detail_concurrency,
                        preload_details: request.compare_request.normalized_preload_details(),
                    },
                },
                category: map_structure_detail_category(request.category),
                table_name: request.table_name.clone(),
            })
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(StructureCompareDetailResponse {
            category: request.category,
            table_name: response.table_name,
            detail: map_structure_table_item(response.detail),
            performance: map_core_performance(response.performance),
        })
    }

    pub async fn export_sql_file(
        &self,
        request: &StructureExportSqlFileRequest,
        source_profile: &ConnectionProfile,
        target_profile: &ConnectionProfile,
    ) -> Result<StructureExportSqlFileResponse> {
        request.compare_request.validate()?;
        let response = self
            .core
            .export_sql_file(&core_api::StructureExportSqlFileRequest {
                compare_request: core_api::StructureCompareRequest {
                    source: to_core_db_config(
                        source_profile,
                        &request.compare_request.source_database_name,
                    ),
                    target: to_core_db_config(
                        target_profile,
                        &request.compare_request.target_database_name,
                    ),
                    options: core_api::StructureCompareOptions {
                        detail_concurrency: request.compare_request.detail_concurrency,
                        preload_details: request.compare_request.normalized_preload_details(),
                    },
                },
                selection: core_api::StructureSqlSelection {
                    added_tables: request.selection.added_tables.clone(),
                    modified_tables: request.selection.modified_tables.clone(),
                    deleted_tables: request.selection.deleted_tables.clone(),
                },
                file_path: request.file_path.clone(),
            })
            .await
            .map_err(core_error_to_anyhow)?;

        Ok(StructureExportSqlFileResponse {
            file_path: response.file_path,
            added_count: response.added_count,
            modified_count: response.modified_count,
            deleted_count: response.deleted_count,
        })
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

fn map_structure_detail_category(
    category: StructureDetailCategory,
) -> core_api::StructureDetailCategory {
    match category {
        StructureDetailCategory::Added => core_api::StructureDetailCategory::Added,
        StructureDetailCategory::Modified => core_api::StructureDetailCategory::Modified,
        StructureDetailCategory::Deleted => core_api::StructureDetailCategory::Deleted,
    }
}

fn map_structure_table_item(item: core_api::StructureTableItem) -> StructureTableItem {
    StructureTableItem {
        table_name: item.table_name,
        preview_sql: item.preview_sql,
        source_sql: item.source_sql,
        target_sql: item.target_sql,
        source_changed_lines: item.source_changed_lines,
        target_changed_lines: item.target_changed_lines,
        warnings: item.warnings,
    }
}

fn map_core_performance(
    performance: core_desktop::CompareHistoryPerformance,
) -> CompareHistoryPerformance {
    CompareHistoryPerformance {
        total_elapsed_ms: performance.total_elapsed_ms,
        stages: performance
            .stages
            .into_iter()
            .map(|stage| CompareHistoryPerformanceStage {
                key: stage.key,
                label: stage.label,
                elapsed_ms: stage.elapsed_ms,
                item_count: stage.item_count,
                note: stage.note,
            })
            .collect(),
        max_parallelism: performance.max_parallelism,
    }
}

fn core_error_to_anyhow(error: AppError) -> anyhow::Error {
    anyhow!(error.to_string())
}

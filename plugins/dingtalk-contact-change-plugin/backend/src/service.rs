use crate::dingtalk::{DingtalkClient, QuerySnapshot};
use crate::error::PluginError;
use crate::models::{
    AppBootstrapResponse, ChangeType, ConfigDeleteParams, ConfigSaveParams, ConnectionTestParams,
    ConnectionTestResult, HistoryListParams, HistoryListResponse, QueryDetailParams,
    QueryDetailResponse, QueryLatestParams, QueryRunParams, QueryStatus,
};
use crate::storage::{QueryRecordInsert, QueryUserInsert, Storage, StoredSnapshotUser};
use chrono::Local;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

const QUERY_HEATMAP_PAGE_SIZE: u32 = 500;

pub struct PluginService {
    storage: Storage,
}

impl PluginService {
    pub fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub fn bootstrap(&self) -> Result<AppBootstrapResponse, PluginError> {
        self.storage.bootstrap(None, None)
    }

    pub fn save_config(
        &self,
        params: ConfigSaveParams,
    ) -> Result<crate::models::DingtalkConfig, PluginError> {
        self.storage.save_config(params, &now_string())
    }

    pub fn delete_config(&self, params: ConfigDeleteParams) -> Result<(), PluginError> {
        self.storage.delete_config(&params.config_id)
    }

    pub fn test_connection(
        &self,
        params: ConnectionTestParams,
    ) -> Result<ConnectionTestResult, PluginError> {
        let tested_at = now_string();
        let client = DingtalkClient::new(params.base_url, params.app_id, params.app_secret)?;
        let result = client.test_connection(tested_at.clone())?;

        if let Some(config_id) = params.config_id {
            self.storage
                .save_test_result(&config_id, &result, &tested_at)?;
        }

        Ok(result)
    }

    pub fn run_query(&self, params: QueryRunParams) -> Result<QueryDetailResponse, PluginError> {
        let config = self.storage.get_config(&params.config_id)?;
        let queried_at = now_string();
        let query_id = Uuid::new_v4().to_string();
        let previous_success = self.storage.latest_success_record(&config.id)?;
        let previous_users = if let Some(previous) = &previous_success {
            self.storage.load_current_users(&previous.id)?
        } else {
            BTreeMap::new()
        };

        let client = DingtalkClient::new(
            config.base_url.clone(),
            config.app_id.clone(),
            config.app_secret.clone(),
        )?;

        match client.fetch_snapshot() {
            Ok(snapshot) => {
                let (record, users) = build_success_record(
                    &query_id,
                    &config.id,
                    &config.name,
                    &queried_at,
                    previous_success.as_ref(),
                    previous_users,
                    snapshot,
                );
                self.storage.save_query_record(&record, &users)?;
                self.storage.list_query_detail(
                    &record.id,
                    crate::models::QueryUserTab::All,
                    "",
                    1,
                    QUERY_HEATMAP_PAGE_SIZE,
                )
            }
            Err(error) => {
                let record = QueryRecordInsert {
                    id: query_id,
                    config_id: config.id,
                    config_name: config.name,
                    queried_at,
                    status: QueryStatus::Failed,
                    total_count: 0,
                    added_count: 0,
                    removed_count: 0,
                    previous_record_id: previous_success.as_ref().map(|record| record.id.clone()),
                    previous_queried_at: previous_success
                        .as_ref()
                        .map(|record| record.queried_at.clone()),
                    previous_total_count: previous_success
                        .as_ref()
                        .map(|record| record.total_count),
                    error_message: Some(error.to_string()),
                };
                self.storage.save_query_record(&record, &[])?;
                Err(error)
            }
        }
    }

    pub fn latest_query(
        &self,
        params: QueryLatestParams,
    ) -> Result<Option<QueryDetailResponse>, PluginError> {
        let latest = self.storage.latest_success_record(&params.config_id)?;
        latest
            .map(|record| {
                self.storage.list_query_detail(
                    &record.id,
                    params.tab,
                    &params.keyword,
                    params.page,
                    params.page_size,
                )
            })
            .transpose()
    }

    pub fn query_detail(
        &self,
        params: QueryDetailParams,
    ) -> Result<QueryDetailResponse, PluginError> {
        self.storage.list_query_detail(
            &params.query_id,
            params.tab,
            &params.keyword,
            params.page,
            params.page_size,
        )
    }

    pub fn history_list(
        &self,
        params: HistoryListParams,
    ) -> Result<HistoryListResponse, PluginError> {
        self.storage.list_history(
            optional_filter(&params.config_id),
            optional_filter(&params.start_date),
            optional_filter(&params.end_date),
            params.page,
            params.page_size,
        )
    }
}

fn build_success_record(
    query_id: &str,
    config_id: &str,
    config_name: &str,
    queried_at: &str,
    previous_success: Option<&crate::models::QueryRecordSummary>,
    previous_users: BTreeMap<String, StoredSnapshotUser>,
    snapshot: QuerySnapshot,
) -> (QueryRecordInsert, Vec<QueryUserInsert>) {
    let current_users = snapshot
        .users
        .into_iter()
        .map(|user| (user.user_id, user.user_name))
        .collect::<BTreeMap<_, _>>();

    let mut rows = Vec::new();
    let mut added_count = 0_i64;
    let mut removed_count = 0_i64;

    if previous_success.is_none() {
        for (user_id, user_name) in &current_users {
            rows.push(QueryUserInsert {
                user_id: user_id.clone(),
                user_name: user_name.clone(),
                change_type: ChangeType::None,
                is_current: true,
            });
        }
    } else {
        let previous_ids = previous_users.keys().cloned().collect::<BTreeSet<_>>();
        let current_ids = current_users.keys().cloned().collect::<BTreeSet<_>>();

        for user_id in current_ids.difference(&previous_ids) {
            if let Some(user_name) = current_users.get(user_id) {
                added_count += 1;
                rows.push(QueryUserInsert {
                    user_id: user_id.clone(),
                    user_name: user_name.clone(),
                    change_type: ChangeType::Added,
                    is_current: true,
                });
            }
        }

        for user_id in current_ids.intersection(&previous_ids) {
            if let Some(user_name) = current_users.get(user_id) {
                rows.push(QueryUserInsert {
                    user_id: user_id.clone(),
                    user_name: user_name.clone(),
                    change_type: ChangeType::None,
                    is_current: true,
                });
            }
        }

        for user_id in previous_ids.difference(&current_ids) {
            if let Some(user) = previous_users.get(user_id) {
                removed_count += 1;
                rows.push(QueryUserInsert {
                    user_id: user.user_id.clone(),
                    user_name: user.user_name.clone(),
                    change_type: ChangeType::Removed,
                    is_current: false,
                });
            }
        }
    }

    rows.sort_by(|left, right| {
        left.user_name
            .cmp(&right.user_name)
            .then(left.user_id.cmp(&right.user_id))
    });

    let record = QueryRecordInsert {
        id: query_id.to_string(),
        config_id: config_id.to_string(),
        config_name: config_name.to_string(),
        queried_at: queried_at.to_string(),
        status: QueryStatus::Success,
        total_count: current_users.len() as i64,
        added_count,
        removed_count,
        previous_record_id: previous_success.map(|record| record.id.clone()),
        previous_queried_at: previous_success.map(|record| record.queried_at.clone()),
        previous_total_count: previous_success.map(|record| record.total_count),
        error_message: None,
    };

    (record, rows)
}

fn now_string() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn optional_filter(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::models::{
    CompareTaskCancelResponse, CompareTaskPhase, CompareTaskPhaseProgress,
    CompareTaskProgressResponse, CompareTaskResultResponse, CompareTaskStatus, DataCompareResponse,
};

#[derive(Debug, Clone, Default)]
pub struct CompareTaskManager {
    tasks: Arc<Mutex<HashMap<String, CompareTaskEntry>>>,
}

#[derive(Debug)]
struct CompareTaskEntry {
    progress: CompareTaskProgressResponse,
    result: Option<DataCompareResponse>,
    cancel_flag: Arc<AtomicBool>,
}

impl CompareTaskManager {
    pub fn register(&self, compare_id: String) {
        let entry = CompareTaskEntry {
            progress: CompareTaskProgressResponse {
                compare_id: compare_id.clone(),
                status: CompareTaskStatus::Pending,
                total_tables: 0,
                completed_tables: 0,
                current_table: None,
                current_phase: Some(CompareTaskPhase::Pending),
                current_phase_progress: None,
                error_message: None,
            },
            result: None,
            cancel_flag: Arc::new(AtomicBool::new(false)),
        };

        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.insert(compare_id, entry);
        }
    }

    pub fn report_progress(
        &self,
        compare_id: &str,
        total_tables: usize,
        completed_tables: usize,
        current_table: Option<String>,
        current_phase: CompareTaskPhase,
        current_phase_progress: Option<CompareTaskPhaseProgress>,
    ) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Running;
            entry.progress.total_tables = total_tables;
            entry.progress.completed_tables = completed_tables;
            entry.progress.current_table = current_table;
            entry.progress.current_phase = Some(current_phase);
            entry.progress.current_phase_progress = current_phase_progress;
            entry.progress.error_message = None;
        });
    }

    pub fn finish_success(&self, compare_id: &str, result: DataCompareResponse) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Completed;
            entry.progress.total_tables = result.summary.total_tables;
            entry.progress.completed_tables = result.summary.compared_tables;
            entry.progress.current_table = None;
            entry.progress.current_phase = Some(CompareTaskPhase::Completed);
            entry.progress.current_phase_progress = None;
            entry.progress.error_message = None;
            entry.result = Some(result);
        });
    }

    pub fn finish_failure(&self, compare_id: &str, error_message: String) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Failed;
            entry.progress.error_message = Some(error_message);
            entry.progress.current_table = None;
            entry.progress.current_phase_progress = None;
        });
    }

    pub fn finish_canceled(&self, compare_id: &str, error_message: String) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Canceled;
            entry.progress.error_message = Some(error_message);
            entry.progress.current_table = None;
            entry.progress.current_phase_progress = None;
        });
    }

    pub fn request_cancel(&self, compare_id: &str) -> CompareTaskCancelResponse {
        let accepted = self
            .tasks
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(compare_id).map(|entry| entry.cancel_flag.clone()))
            .map(|flag| {
                flag.store(true, Ordering::SeqCst);
                true
            })
            .unwrap_or(false);

        CompareTaskCancelResponse {
            compare_id: compare_id.to_string(),
            accepted,
        }
    }

    pub fn cancel_flag(&self, compare_id: &str) -> Option<Arc<AtomicBool>> {
        self.tasks
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(compare_id).map(|entry| entry.cancel_flag.clone()))
    }

    pub fn progress(&self, compare_id: &str) -> Option<CompareTaskProgressResponse> {
        self.tasks
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(compare_id).map(|entry| entry.progress.clone()))
    }

    pub fn take_result(&self, compare_id: &str) -> Option<CompareTaskResultResponse> {
        self.tasks.lock().ok().and_then(|mut tasks| {
            tasks
                .remove(compare_id)
                .map(|entry| CompareTaskResultResponse {
                    compare_id: compare_id.to_string(),
                    status: entry.progress.status,
                    result: entry.result,
                    error_message: entry.progress.error_message,
                })
        })
    }

    fn update(&self, compare_id: &str, updater: impl FnOnce(&mut CompareTaskEntry)) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(entry) = tasks.get_mut(compare_id) {
                updater(entry);
            }
        }
    }
}

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use tokio::sync::Notify;

use crate::models::{
    CompareTaskCancelResponse, CompareTaskPhase, CompareTaskPhaseProgress,
    CompareTaskProgressResponse, CompareTaskStatus, DataCompareResponse, StructureCompareResponse,
};

#[derive(Clone)]
pub struct CompareTaskManager<T> {
    tasks: Arc<Mutex<HashMap<String, CompareTaskEntry<T>>>>,
}

const FINISHED_TASK_RETENTION: Duration = Duration::from_secs(30 * 60);
const MAX_RETAINED_TASKS: usize = 128;

pub type DataCompareTaskManager = CompareTaskManager<DataCompareResponse>;
pub type StructureCompareTaskManager = CompareTaskManager<StructureCompareResponse>;

pub struct TaskResultSnapshot<T> {
    pub compare_id: String,
    pub status: CompareTaskStatus,
    pub result: Option<T>,
    pub error_message: Option<String>,
}

struct CompareTaskEntry<T> {
    progress: CompareTaskProgressResponse,
    result: Option<T>,
    cancel_flag: Arc<AtomicBool>,
    cancel_notify: Arc<Notify>,
    finished_at: Option<Instant>,
}

impl<T: Clone> CompareTaskManager<T> {
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
            cancel_notify: Arc::new(Notify::new()),
            finished_at: None,
        };

        if let Ok(mut tasks) = self.tasks.lock() {
            prune_tasks(&mut tasks);
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
            entry.finished_at = None;
        });
    }

    pub fn finish_success(&self, compare_id: &str, result: T, total_tables: usize) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Completed;
            entry.progress.total_tables = total_tables;
            entry.progress.completed_tables = total_tables;
            entry.progress.current_table = None;
            entry.progress.current_phase = Some(CompareTaskPhase::Completed);
            entry.progress.current_phase_progress = None;
            entry.progress.error_message = None;
            entry.result = Some(result);
            entry.finished_at = Some(Instant::now());
        });
    }

    pub fn finish_failure(&self, compare_id: &str, error_message: String) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Failed;
            entry.progress.error_message = Some(error_message);
            entry.progress.current_table = None;
            entry.progress.current_phase_progress = None;
            entry.finished_at = Some(Instant::now());
        });
    }

    pub fn finish_canceled(&self, compare_id: &str, error_message: String) {
        self.update(compare_id, |entry| {
            entry.progress.status = CompareTaskStatus::Canceled;
            entry.progress.error_message = Some(error_message);
            entry.progress.current_table = None;
            entry.progress.current_phase_progress = None;
            entry.finished_at = Some(Instant::now());
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
            .inspect(|_| {
                if let Ok(tasks) = self.tasks.lock()
                    && let Some(entry) = tasks.get(compare_id)
                {
                    entry.cancel_notify.notify_waiters();
                }
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

    pub fn cancel_notifier(&self, compare_id: &str) -> Option<Arc<Notify>> {
        self.tasks.lock().ok().and_then(|tasks| {
            tasks
                .get(compare_id)
                .map(|entry| entry.cancel_notify.clone())
        })
    }

    pub fn progress(&self, compare_id: &str) -> Option<CompareTaskProgressResponse> {
        self.tasks
            .lock()
            .ok()
            .and_then(|tasks| tasks.get(compare_id).map(|entry| entry.progress.clone()))
    }

    pub fn take_result(&self, compare_id: &str) -> Option<TaskResultSnapshot<T>> {
        self.tasks.lock().ok().and_then(|mut tasks| {
            tasks.remove(compare_id).map(|entry| TaskResultSnapshot {
                compare_id: compare_id.to_string(),
                status: entry.progress.status,
                result: entry.result,
                error_message: entry.progress.error_message,
            })
        })
    }

    fn update(&self, compare_id: &str, updater: impl FnOnce(&mut CompareTaskEntry<T>)) {
        if let Ok(mut tasks) = self.tasks.lock()
            && let Some(entry) = tasks.get_mut(compare_id)
        {
            updater(entry);
        }
    }
}

impl<T> Default for CompareTaskManager<T> {
    fn default() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn prune_tasks<T>(tasks: &mut HashMap<String, CompareTaskEntry<T>>) {
    let now = Instant::now();
    tasks.retain(|_, entry| {
        entry
            .finished_at
            .map(|finished_at| now.duration_since(finished_at) <= FINISHED_TASK_RETENTION)
            .unwrap_or(true)
    });

    if tasks.len() <= MAX_RETAINED_TASKS {
        return;
    }

    let overflow = tasks.len() - MAX_RETAINED_TASKS;
    let mut finished_tasks = tasks
        .iter()
        .filter_map(|(compare_id, entry)| {
            entry
                .finished_at
                .map(|finished_at| (compare_id.clone(), finished_at))
        })
        .collect::<Vec<_>>();
    finished_tasks.sort_by_key(|(_, finished_at)| *finished_at);

    for (compare_id, _) in finished_tasks.into_iter().take(overflow) {
        tasks.remove(&compare_id);
    }
}

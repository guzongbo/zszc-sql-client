use crate::models::RuntimeMetrics;
use anyhow::{Context, Result, anyhow};
use std::sync::Mutex;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, get_current_pid};

pub struct RuntimeMetricsService {
    process_id: sysinfo::Pid,
    system: Mutex<System>,
}

impl RuntimeMetricsService {
    pub fn new() -> Result<Self> {
        let process_id = get_current_pid().map_err(|error| anyhow!(error))?;
        let mut system = System::new();

        // 预热一次采样，后续轮询时 CPU 占用才能基于时间差得到有效结果。
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[process_id]),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );

        Ok(Self {
            process_id,
            system: Mutex::new(system),
        })
    }

    pub fn snapshot(&self) -> Result<RuntimeMetrics> {
        let mut system = self
            .system
            .lock()
            .map_err(|_| anyhow!("运行指标采集锁已被污染"))?;

        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.process_id]),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );

        let process = system
            .process(self.process_id)
            .context("未找到当前桌面进程的运行指标")?;

        // sysinfo 的进程 CPU 可能按多核累加，这里归一化为 0-100 的展示值。
        let cpu_count = std::thread::available_parallelism()
            .map(|parallelism| parallelism.get() as f32)
            .unwrap_or(1.0);

        Ok(RuntimeMetrics {
            cpu_percent: (process.cpu_usage() / cpu_count).clamp(0.0, 100.0),
            memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
        })
    }
}

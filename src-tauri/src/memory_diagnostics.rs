use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use sysinfo::{get_current_pid, ProcessesToUpdate, System};

const DEFAULT_SAMPLE_INTERVAL_SECS: u64 = 5;
const MIN_SAMPLE_INTERVAL_SECS: u64 = 1;

pub struct RuntimeDiagnostics {
    _memory_sampler: MemorySamplerGuard,
    #[cfg(feature = "memory-heap")]
    _heap_profiler: Option<dhat::Profiler>,
}

pub fn start() -> RuntimeDiagnostics {
    #[cfg(feature = "memory-heap")]
    let heap_profiler = maybe_start_heap_profiler();

    let memory_sampler = MemorySamplerGuard::spawn();

    log::info!(
        target: "memory_diagnostics",
        "memory diagnostics enabled; sampling process memory every {}s",
        sample_interval().as_secs()
    );

    RuntimeDiagnostics {
        _memory_sampler: memory_sampler,
        #[cfg(feature = "memory-heap")]
        _heap_profiler: heap_profiler,
    }
}

#[cfg(feature = "memory-heap")]
fn maybe_start_heap_profiler() -> Option<dhat::Profiler> {
    if !env_flag("SHIGUANG_DHAT") {
        log::info!(
            target: "memory_diagnostics",
            "heap profiling support compiled in but disabled; set SHIGUANG_DHAT=1 to write a dhat heap profile on exit"
        );
        return None;
    }

    let file_name = std::env::var_os("SHIGUANG_DHAT_FILE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(format!("dhat-heap-{}.json", std::process::id()))
        });

    log::info!(
        target: "memory_diagnostics",
        "heap profiling enabled; file={}",
        file_name.display()
    );

    Some(dhat::Profiler::builder().file_name(file_name).build())
}

#[cfg(feature = "memory-heap")]
fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
    )
}

fn sample_interval() -> Duration {
    let seconds = std::env::var("SHIGUANG_MEM_SAMPLE_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_SAMPLE_INTERVAL_SECS)
        .max(MIN_SAMPLE_INTERVAL_SECS);

    Duration::from_secs(seconds)
}

struct MemorySamplerGuard {
    stop_tx: mpsc::Sender<()>,
    handle: Option<JoinHandle<()>>,
}

impl MemorySamplerGuard {
    fn spawn() -> Self {
        let (stop_tx, stop_rx) = mpsc::channel();
        let handle = thread::Builder::new()
            .name("memory-diagnostics".to_string())
            .spawn(move || memory_sampler_loop(stop_rx))
            .expect("failed to spawn memory diagnostics thread");

        Self {
            stop_tx,
            handle: Some(handle),
        }
    }
}

impl Drop for MemorySamplerGuard {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn memory_sampler_loop(stop_rx: mpsc::Receiver<()>) {
    let interval = sample_interval();
    let pid = match get_current_pid() {
        Ok(pid) => pid,
        Err(error) => {
            log::warn!(
                target: "memory_diagnostics",
                "failed to resolve current process id: {}",
                error
            );
            return;
        }
    };

    let mut system = System::new();
    let mut peak_resident = 0u64;
    let mut peak_virtual = 0u64;

    if let Some(snapshot) = sample_process(&mut system, pid) {
        peak_resident = snapshot.resident;
        peak_virtual = snapshot.virtual_memory;
        emit_snapshot("startup", snapshot, peak_resident, peak_virtual);
    }

    loop {
        match stop_rx.recv_timeout(interval) {
            Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let Some(snapshot) = sample_process(&mut system, pid) else {
                    log::warn!(
                        target: "memory_diagnostics",
                        "current process disappeared while sampling memory"
                    );
                    break;
                };

                peak_resident = peak_resident.max(snapshot.resident);
                peak_virtual = peak_virtual.max(snapshot.virtual_memory);
                emit_snapshot("tick", snapshot, peak_resident, peak_virtual);
            }
        }
    }

    if let Some(snapshot) = sample_process(&mut system, pid) {
        peak_resident = peak_resident.max(snapshot.resident);
        peak_virtual = peak_virtual.max(snapshot.virtual_memory);
        emit_snapshot("shutdown", snapshot, peak_resident, peak_virtual);
    }
}

#[derive(Clone, Copy)]
struct MemorySnapshot {
    resident: u64,
    virtual_memory: u64,
    system_used: u64,
    system_available: u64,
}

fn sample_process(system: &mut System, pid: sysinfo::Pid) -> Option<MemorySnapshot> {
    system.refresh_memory();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    let process = system.process(pid)?;

    Some(MemorySnapshot {
        resident: process.memory(),
        virtual_memory: process.virtual_memory(),
        system_used: system.used_memory(),
        system_available: system.available_memory(),
    })
}

fn emit_snapshot(label: &str, snapshot: MemorySnapshot, peak_resident: u64, peak_virtual: u64) {
    log::info!(
        target: "memory_diagnostics",
        "memory snapshot label={} resident={} resident_peak={} virtual={} virtual_peak={} system_used={} system_available={}",
        label,
        format_bytes(snapshot.resident),
        format_bytes(peak_resident),
        format_bytes(snapshot.virtual_memory),
        format_bytes(peak_virtual),
        format_bytes(snapshot.system_used),
        format_bytes(snapshot.system_available)
    );
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];

    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{bytes} {}", UNITS[unit])
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

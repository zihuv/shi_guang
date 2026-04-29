import type { BrowserWindow } from "electron";
import type { AppState, FileRecord } from "../types";

export interface AutoAiMetadataScheduleContext {
  source: string;
  autoAnalyzeMetadata?: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

export interface AutoAiMetadataSchedulerDependencies {
  debounceMs: number;
  setTimeout: (callback: () => void, delay: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  canAnalyzeFile: (file: FileRecord) => boolean;
  shouldStart: (state: AppState) => boolean;
  startTask: (state: AppState, window: BrowserWindow | null, fileIds: number[]) => void;
  logWarn: (message: string, details: Record<string, unknown>) => void;
}

export class AutoAiMetadataScheduler {
  private timer: Timer | null = null;
  private window: BrowserWindow | null = null;
  private state: AppState | null = null;
  private readonly pendingFileIds = new Set<number>();

  constructor(private readonly deps: AutoAiMetadataSchedulerDependencies) {}

  schedule(
    state: AppState,
    window: BrowserWindow | null,
    file: FileRecord,
    context: AutoAiMetadataScheduleContext,
  ): void {
    if (!this.shouldAutoAnalyzeForContext(context) || !this.deps.canAnalyzeFile(file)) {
      return;
    }

    this.pendingFileIds.add(file.id);
    this.state = state;
    this.window = window;

    if (this.timer) {
      this.deps.clearTimeout(this.timer);
    }
    this.timer = this.deps.setTimeout(() => this.flush(), this.deps.debounceMs);
  }

  flush(): void {
    const state = this.state;
    const window = this.window;
    const fileIds = [...this.pendingFileIds];
    this.pendingFileIds.clear();
    this.timer = null;
    this.state = null;
    this.window = null;

    if (!state || fileIds.length === 0 || !this.deps.shouldStart(state)) {
      return;
    }

    try {
      this.deps.startTask(state, window, fileIds);
    } catch (error) {
      for (const fileId of fileIds) {
        this.pendingFileIds.add(fileId);
      }
      this.deps.logWarn("[import] failed to start auto AI metadata task", { fileIds, error });
    }
  }

  private shouldAutoAnalyzeForContext(context: AutoAiMetadataScheduleContext): boolean {
    return (
      context.autoAnalyzeMetadata ??
      (context.source !== "library_sync" && context.source !== "restore")
    );
  }
}

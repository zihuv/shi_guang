import {
  analyzeFileMetadata,
  extractResponseText,
  getVisualStatus,
  loadAiConfig,
  postAiJson,
  runVisualIndexJob,
  startAiMetadataTask,
  startVisualIndexTask,
} from "./visual-ai-service";
import { getRecommendedVisualModelPath, validateVisualModelPath } from "../visual-search";
import type { AppState } from "../types";
import { type CommandHandler, emit, numberArg, numberArrayArg, stringArg } from "./common";

export function createVisualAiCommands(state: AppState): Record<string, CommandHandler> {
  return {
    analyze_file_metadata: async (args, window) => {
      const file = await analyzeFileMetadata(
        state,
        numberArg(args, "fileId", "file_id"),
        typeof args.imageDataUrl === "string" ? args.imageDataUrl : undefined,
      );
      emit(window, "file-updated", { fileId: file.id });
      return file;
    },
    start_ai_metadata_task: (args, window) =>
      startAiMetadataTask(state, window, numberArrayArg(args, "fileIds", "file_ids")),
    get_ai_metadata_task: (args) => {
      const task = state.aiMetadataTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("AI metadata task not found");
      return task.snapshot;
    },
    cancel_ai_metadata_task: (args) => {
      const task = state.aiMetadataTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("AI metadata task not found");
      task.cancelled = true;
    },
    rebuild_visual_index: async () => {
      const result = await runVisualIndexJob(state, null, null, false);
      return {
        total: result.total,
        indexed: result.indexed,
        failed: result.failed,
        skipped: result.skipped,
      };
    },
    start_visual_index_task: (args, window) =>
      startVisualIndexTask(
        state,
        window,
        Boolean(args.processUnindexedOnly ?? args.process_unindexed_only),
      ),
    get_visual_index_task: (args) => {
      const task = state.visualIndexTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Visual index task not found");
      return task.snapshot;
    },
    cancel_visual_index_task: (args) => {
      const task = state.visualIndexTasks.get(stringArg(args, "taskId", "task_id"));
      if (!task) throw new Error("Visual index task not found");
      task.cancelled = true;
    },
    get_visual_index_status: async () => getVisualStatus(state),
    complete_visual_index_browser_decode_request: () => undefined,
    validate_visual_model_path: async (args) =>
      validateVisualModelPath(stringArg(args, "modelPath", "model_path")),
    get_recommended_visual_model_path: async () => getRecommendedVisualModelPath(),
    test_ai_endpoint: async () => {
      const config = loadAiConfig(state);
      const payload = await postAiJson(config, {
        model: config.model,
        messages: [
          { role: "system", content: "你是一个接口连通性测试助手。" },
          { role: "user", content: "只回复 ok" },
        ],
        enable_thinking: false,
        stream: false,
        temperature: 0,
        max_tokens: 16,
      });
      return `图片元数据分析接口可用，响应示例: ${(extractResponseText(payload) ?? "").slice(0, 48)}`;
    },
  };
}

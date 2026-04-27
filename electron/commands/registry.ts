import type { AppState } from "../types";
import type { CommandHandler, GetWindow } from "./common";
import { createFileCommands } from "./file-commands";
import { createFolderCommands } from "./folder-commands";
import { createIndexingCommands } from "./indexing-commands";
import { createSystemCommands } from "./system-commands";
import { createTagCommands } from "./tag-commands";
import { createTrashCommands } from "./trash-commands";
import { createVisualAiCommands } from "./visual-ai-commands";

export function createCommandRegistry(
  state: AppState,
  getWindow: GetWindow,
): Record<string, CommandHandler> {
  return {
    ...createSystemCommands(state),
    ...createFileCommands(state, getWindow),
    ...createVisualAiCommands(state),
    ...createIndexingCommands(state, getWindow),
    ...createFolderCommands(state),
    ...createTagCommands(state),
    ...createTrashCommands(state),
  };
}

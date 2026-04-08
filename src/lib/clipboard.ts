import { copyFilesToClipboard as copyFilesToClipboardCommand } from "@/services/tauri/system";

export async function copyFilesToClipboard(fileIds: number[]) {
  await copyFilesToClipboardCommand(fileIds);
}

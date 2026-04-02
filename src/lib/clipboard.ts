import { invoke } from "@tauri-apps/api/core";

export async function copyFilesToClipboard(fileIds: number[]) {
  await invoke("copy_files_to_clipboard", { fileIds });
}

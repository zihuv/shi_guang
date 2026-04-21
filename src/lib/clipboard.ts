import { copyFilesToClipboard as copyFilesToClipboardCommand } from "@/services/desktop/system";

export async function copyFilesToClipboard(fileIds: number[]) {
  await copyFilesToClipboardCommand(fileIds);
}

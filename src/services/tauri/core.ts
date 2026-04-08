import { invoke } from "@tauri-apps/api/core"

function normalizeTauriError(error: unknown) {
  if (error instanceof Error) {
    return error
  }

  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error)

  return new Error(message)
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw normalizeTauriError(error)
  }
}


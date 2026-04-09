import { invoke } from "@tauri-apps/api/core"

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>
    for (const key of ["message", "error", "cause", "details"]) {
      const value = candidate[key]
      if (typeof value === "string" && value.trim()) {
        return value
      }
    }

    const serialized = JSON.stringify(candidate)
    if (serialized && serialized !== "{}") {
      return serialized
    }
  }

  return String(error)
}

function normalizeTauriError(error: unknown) {
  if (error instanceof Error) {
    return error
  }

  return new Error(getErrorMessage(error))
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

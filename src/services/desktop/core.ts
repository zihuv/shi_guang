type DesktopEvent<T> = {
  payload: T;
};

function cleanDesktopErrorMessage(message: string) {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return cleanDesktopErrorMessage(error.message);
  }

  if (typeof error === "string") {
    return cleanDesktopErrorMessage(error);
  }

  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    for (const key of ["message", "error", "cause", "details"]) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return cleanDesktopErrorMessage(value);
      }
    }

    const serialized = JSON.stringify(candidate);
    if (serialized && serialized !== "{}") {
      return serialized;
    }
  }

  return String(error);
}

function normalizeDesktopError(error: unknown) {
  if (error instanceof Error) {
    return new Error(cleanDesktopErrorMessage(error.message));
  }

  return new Error(getErrorMessage(error));
}

export async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    if (!window.shiguang) {
      throw new Error("Desktop bridge is not available");
    }
    return await window.shiguang.invoke<T>(command, args);
  } catch (error) {
    throw normalizeDesktopError(error);
  }
}

export async function listenDesktop<T>(
  channel: string,
  callback: (event: DesktopEvent<T>) => void,
): Promise<() => void> {
  if (!window.shiguang) {
    throw new Error("Desktop bridge is not available");
  }

  return window.shiguang.on(channel, (payload) => callback({ payload: payload as T }));
}

export function sendDesktop(command: string, args?: Record<string, unknown>) {
  if (!window.shiguang) {
    throw new Error("Desktop bridge is not available");
  }
  window.shiguang.send(command, args ?? {});
}

export function getDesktopBridge() {
  if (!window.shiguang) {
    throw new Error("Desktop bridge is not available");
  }
  return window.shiguang;
}

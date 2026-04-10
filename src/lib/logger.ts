import { isTauri } from "@tauri-apps/api/core";
import {
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from "@tauri-apps/plugin-log";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

type LogWriter = (message: string) => Promise<void>;

const originalConsole: Pick<Console, ConsoleMethod> = {
  debug: console.debug.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
};

let initialized = false;
let loggingAvailable = true;

export function initAppLogging(): void {
  if (initialized || !isTauri()) {
    return;
  }

  initialized = true;

  forwardConsole("log", tauriInfo);
  forwardConsole("info", tauriInfo);
  forwardConsole("warn", tauriWarn);
  forwardConsole("error", tauriError);
  forwardConsole("debug", import.meta.env.DEV ? tauriDebug : tauriTrace);

  window.addEventListener("error", (event) => {
    void emitLog(tauriError, [
      "[window.error]",
      event.message,
      event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      event.error,
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    void emitLog(tauriError, ["[unhandledrejection]", event.reason]);
  });
}

function forwardConsole(method: ConsoleMethod, writer: LogWriter): void {
  console[method] = (...args: unknown[]) => {
    originalConsole[method](...args);
    void emitLog(writer, [`[frontend:${method}]`, ...args]);
  };
}

async function emitLog(writer: LogWriter, args: unknown[]): Promise<void> {
  if (!loggingAvailable) {
    return;
  }

  try {
    await writer(formatLogArgs(args));
  } catch (error) {
    loggingAvailable = false;
    originalConsole.warn("Failed to forward logs to tauri-plugin-log; disabling bridge.", error);
  }
}

function formatLogArgs(args: unknown[]): string {
  return args
    .filter((value) => value !== undefined)
    .map((value) => formatLogValue(value))
    .join(" ");
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack,
        };
      }

      return currentValue;
    });

    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

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
  if (initialized || !window.shiguang) {
    return;
  }

  initialized = true;

  forwardConsole("log", (message) => window.shiguang!.log("info", message));
  forwardConsole("info", (message) => window.shiguang!.log("info", message));
  forwardConsole("warn", (message) => window.shiguang!.log("warn", message));
  forwardConsole("error", (message) => window.shiguang!.log("error", message));
  forwardConsole("debug", (message) =>
    window.shiguang!.log(import.meta.env.DEV ? "debug" : "trace", message),
  );

  window.addEventListener("error", (event) => {
    void emitLog(
      (message) => window.shiguang!.log("error", message),
      [
        "[window.error]",
        event.message,
        event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
        event.error,
      ],
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    void emitLog(
      (message) => window.shiguang!.log("error", message),
      ["[unhandledrejection]", event.reason],
    );
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
    originalConsole.warn(
      "Failed to forward logs to Electron main process; disabling bridge.",
      error,
    );
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

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
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

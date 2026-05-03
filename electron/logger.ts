import { app } from "electron";
import log from "electron-log/main";
import path from "node:path";
import fs from "node:fs";

export function configureLogger(): void {
  const isDev = !app.isPackaged;
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });

  log.transports.file.resolvePathFn = (variables) =>
    path.join(logDir, variables.fileName ?? "main.log");
  log.transports.file.level = isDev ? "debug" : "info";

  log.transports.console.level = isDev ? "debug" : false;

  log.transports.file.maxSize = 10 * 1024 * 1024;

  process.on("uncaughtException", (error) => {
    log.error("uncaughtException:", error);
  });

  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection:", reason);
  });
}

export function getLogDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export { log };

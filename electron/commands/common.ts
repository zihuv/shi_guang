import { BrowserWindow } from "electron";
import crypto from "node:crypto";

export type GetWindow = () => BrowserWindow | null;
export type CommandHandler = (
  args: Record<string, unknown>,
  eventWindow: BrowserWindow | null,
) => unknown | Promise<unknown>;

export function emit(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}

export function numberArg(args: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  throw new Error(`Missing numeric argument: ${keys[0]}`);
}

export function optionalNumberArg(args: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = args[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  throw new Error(`Missing string argument: ${keys[0]}`);
}

export function numberArrayArg(args: Record<string, unknown>, ...keys: string[]): number[] {
  for (const key of keys) {
    const value = args[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is number => typeof item === "number" && Number.isFinite(item),
      );
    }
  }
  return [];
}

export function taskId(): string {
  return Date.now().toString(16) + crypto.randomBytes(4).toString("hex");
}

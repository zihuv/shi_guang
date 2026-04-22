import type React from "react";
import { isMacPlatform } from "@/lib/shortcuts";

const SELECTABLE_INPUT_TYPES = new Set(["email", "password", "search", "tel", "text", "url"]);

type SelectAllKeyboardEvent =
  | Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "preventDefault" | "shiftKey">
  | Pick<
      React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      "altKey" | "ctrlKey" | "key" | "metaKey" | "preventDefault" | "shiftKey"
    >;

function isPrimaryModifierPressed(event: Pick<SelectAllKeyboardEvent, "ctrlKey" | "metaKey">) {
  return isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function handlePrimarySelectAll(
  event:
    | (SelectAllKeyboardEvent & { currentTarget: HTMLInputElement })
    | (SelectAllKeyboardEvent & { currentTarget: HTMLTextAreaElement }),
) {
  if (
    event.key.toLowerCase() !== "a" ||
    event.altKey ||
    event.shiftKey ||
    !isPrimaryModifierPressed(event)
  ) {
    return false;
  }

  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return false;
  }

  if (
    target instanceof HTMLInputElement &&
    !SELECTABLE_INPUT_TYPES.has((target.type || "text").toLowerCase())
  ) {
    return false;
  }

  event.preventDefault();
  target.select();
  return true;
}

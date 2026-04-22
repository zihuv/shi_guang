import type React from "react";
import { isMacPlatform } from "@/lib/shortcuts";

const SELECTABLE_INPUT_TYPES = new Set(["email", "password", "search", "tel", "text", "url"]);

type SelectAllKeyboardEvent =
  | Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "preventDefault" | "shiftKey">
  | Pick<
      React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      "altKey" | "ctrlKey" | "key" | "metaKey" | "preventDefault" | "shiftKey"
    >;

type TextEditingKeyboardEvent =
  | Pick<
      KeyboardEvent,
      "altKey" | "ctrlKey" | "currentTarget" | "key" | "metaKey" | "preventDefault" | "shiftKey"
    >
  | Pick<
      React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
      "altKey" | "ctrlKey" | "currentTarget" | "key" | "metaKey" | "preventDefault" | "shiftKey"
    >;

function isPrimaryModifierPressed(event: Pick<SelectAllKeyboardEvent, "ctrlKey" | "metaKey">) {
  return isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function isTextSelectableInput(target: HTMLInputElement | HTMLTextAreaElement) {
  return (
    target instanceof HTMLTextAreaElement ||
    SELECTABLE_INPUT_TYPES.has((target.type || "text").toLowerCase())
  );
}

function isTextEditableTarget(
  target: HTMLInputElement | HTMLTextAreaElement,
): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    isTextSelectableInput(target)
  );
}

function matchesPrimaryTextShortcut(
  event: Pick<TextEditingKeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  key: string,
) {
  return (
    event.key.toLowerCase() === key &&
    !event.altKey &&
    !event.shiftKey &&
    isPrimaryModifierPressed(event)
  );
}

function dispatchNativeInputEvent(target: HTMLInputElement | HTMLTextAreaElement) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function readClipboardText() {
  if (window.shiguang?.clipboard) {
    return Promise.resolve(window.shiguang.clipboard.readText());
  }

  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }

  return Promise.reject(new Error("Clipboard read is not available"));
}

function writeClipboardText(text: string) {
  if (window.shiguang?.clipboard) {
    window.shiguang.clipboard.writeText(text);
    return Promise.resolve();
  }

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("Clipboard write is not available"));
}

function getSelectionRange(target: HTMLInputElement | HTMLTextAreaElement) {
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (start === null || end === null) {
    return null;
  }

  return { start, end };
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

export function handlePrimaryClipboardShortcut(
  event:
    | (TextEditingKeyboardEvent & { currentTarget: HTMLInputElement })
    | (TextEditingKeyboardEvent & { currentTarget: HTMLTextAreaElement }),
) {
  const target = event.currentTarget;
  if (!isTextEditableTarget(target)) {
    return false;
  }

  const selection = getSelectionRange(target);
  if (!selection) {
    return false;
  }

  if (matchesPrimaryTextShortcut(event, "c")) {
    if (selection.start === selection.end) {
      return false;
    }

    event.preventDefault();
    const selectedText = target.value.slice(selection.start, selection.end);
    void writeClipboardText(selectedText).catch((error) => {
      console.error("Failed to copy selected text:", error);
    });
    return true;
  }

  if (matchesPrimaryTextShortcut(event, "x")) {
    if (selection.start === selection.end || target.readOnly || target.disabled) {
      return false;
    }

    event.preventDefault();
    const selectedText = target.value.slice(selection.start, selection.end);
    void writeClipboardText(selectedText)
      .then(() => {
        target.setRangeText("", selection.start, selection.end, "start");
        dispatchNativeInputEvent(target);
      })
      .catch((error) => {
        console.error("Failed to cut selected text:", error);
      });
    return true;
  }

  if (matchesPrimaryTextShortcut(event, "v")) {
    if (target.readOnly || target.disabled) {
      return false;
    }

    event.preventDefault();
    void readClipboardText()
      .then((text) => {
        target.setRangeText(text, selection.start, selection.end, "end");
        dispatchNativeInputEvent(target);
      })
      .catch((error) => {
        console.error("Failed to paste text into input:", error);
      });
    return true;
  }

  return false;
}

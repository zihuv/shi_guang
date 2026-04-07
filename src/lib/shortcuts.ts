export const SHORTCUT_ACTIONS = [
  {
    id: "copySelectedToClipboard",
    label: "复制选中图片到剪贴板",
    description: "复制当前选中的图片；单张图片复制像素内容，多选时复制文件引用",
    defaultShortcut: "Mod+C",
  },
  {
    id: "undoDelete",
    label: "撤销删除",
    description: "恢复最近一次删除操作",
    defaultShortcut: "Mod+Z",
  },
  {
    id: "selectAllCurrentPageFiles",
    label: "全选当前页文件",
    description: "选择当前页已加载的全部文件",
    defaultShortcut: "Mod+A",
  },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutActionId = ShortcutAction["id"];
export type ShortcutConfig = Record<ShortcutActionId, string>;

type ShortcutModifier = "Mod" | "Ctrl" | "Alt" | "Shift";

type ParsedShortcut = {
  modifiers: ShortcutModifier[];
  key: string;
};

const MODIFIER_ORDER: ShortcutModifier[] = ["Mod", "Ctrl", "Alt", "Shift"];
const MODIFIER_ONLY_KEYS = new Set(["alt", "control", "meta", "os", "shift"]);
const SPECIAL_KEY_MAP: Record<string, string> = {
  "+": "Plus",
  " ": "Space",
  escape: "Escape",
  esc: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  space: "Space",
  spacebar: "Space",
  plus: "Plus",
};

export const DEFAULT_SHORTCUTS: ShortcutConfig = SHORTCUT_ACTIONS.reduce(
  (result, action) => {
    result[action.id] = action.defaultShortcut;
    return result;
  },
  {} as ShortcutConfig,
);

export function isMacPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent;

  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function normalizeModifierToken(token: string): ShortcutModifier | null {
  const value = token.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === "mod" || value === "cmd" || value === "command" || value === "meta") {
    return "Mod";
  }

  if (value === "ctrl" || value === "control") {
    return isMacPlatform() ? "Ctrl" : "Mod";
  }

  if (value === "alt" || value === "option") {
    return "Alt";
  }

  if (value === "shift") {
    return "Shift";
  }

  return null;
}

function normalizeKeyToken(token: string) {
  const value = token.trim();
  if (!value) {
    return "";
  }

  const lowerValue = value.toLowerCase();
  if (SPECIAL_KEY_MAP[lowerValue]) {
    return SPECIAL_KEY_MAP[lowerValue];
  }

  if (/^f\d{1,2}$/i.test(value)) {
    return value.toUpperCase();
  }

  if (value.length === 1) {
    return value.toUpperCase();
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const value = shortcut.trim();
  if (!value) {
    return null;
  }

  const modifiers = new Set<ShortcutModifier>();
  let key = "";

  for (const segment of value.split("+")) {
    const modifier = normalizeModifierToken(segment);
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    if (key) {
      return null;
    }

    key = normalizeKeyToken(segment);
  }

  if (!key) {
    return null;
  }

  return {
    modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  };
}

export function normalizeShortcut(shortcut: string) {
  if (!shortcut.trim()) {
    return "";
  }

  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return "";
  }

  return [...parsed.modifiers, parsed.key].join("+");
}

export function resolveShortcuts(savedShortcuts?: Partial<Record<ShortcutActionId, string | null>> | null): ShortcutConfig {
  const shortcuts: ShortcutConfig = { ...DEFAULT_SHORTCUTS };

  if (!savedShortcuts) {
    return shortcuts;
  }

  for (const action of SHORTCUT_ACTIONS) {
    const savedValue = savedShortcuts[action.id];
    if (typeof savedValue !== "string") {
      continue;
    }

    if (!savedValue.trim()) {
      shortcuts[action.id] = "";
      continue;
    }

    const normalized = normalizeShortcut(savedValue);
    if (normalized) {
      shortcuts[action.id] = normalized;
    }
  }

  return shortcuts;
}

function normalizeKeyboardEventKey(key: string) {
  return normalizeKeyToken(key);
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) {
  if (MODIFIER_ONLY_KEYS.has(event.key.toLowerCase())) {
    return "";
  }

  const modifiers: ShortcutModifier[] = [];
  const isMac = isMacPlatform();

  if (isMac) {
    if (event.metaKey) {
      modifiers.push("Mod");
    }
    if (event.ctrlKey) {
      modifiers.push("Ctrl");
    }
  } else if (event.ctrlKey) {
    modifiers.push("Mod");
  }

  if (event.altKey) {
    modifiers.push("Alt");
  }

  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  const key = normalizeKeyboardEventKey(event.key);
  if (!key) {
    return "";
  }

  return normalizeShortcut([...modifiers, key].join("+"));
}

export function matchShortcut(event: KeyboardEvent, shortcut: string) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }

  const isMac = isMacPlatform();
  const modifierSet = new Set(parsed.modifiers);

  if ((isMac ? event.metaKey : event.ctrlKey) !== modifierSet.has("Mod")) {
    return false;
  }

  if ((isMac ? event.ctrlKey : false) !== modifierSet.has("Ctrl")) {
    return false;
  }

  if (event.altKey !== modifierSet.has("Alt")) {
    return false;
  }

  if (event.shiftKey !== modifierSet.has("Shift")) {
    return false;
  }

  return normalizeKeyboardEventKey(event.key) === parsed.key;
}

export function formatShortcutDisplay(shortcut: string) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return "未设置";
  }

  const isMac = isMacPlatform();
  const displayParts: string[] = parsed.modifiers.map((modifier) => {
    if (modifier === "Mod") {
      return isMac ? "Cmd" : "Ctrl";
    }

    if (modifier === "Alt") {
      return isMac ? "Option" : "Alt";
    }

    return modifier;
  });

  displayParts.push(formatDisplayKey(parsed.key));

  return displayParts.join("+");
}

function formatDisplayKey(key: string) {
  if (key === "Plus") {
    return "+";
  }

  if (key === "Escape") {
    return "Esc";
  }

  if (key === "ArrowUp") {
    return "Up";
  }

  if (key === "ArrowDown") {
    return "Down";
  }

  if (key === "ArrowLeft") {
    return "Left";
  }

  if (key === "ArrowRight") {
    return "Right";
  }

  if (key === "PageUp") {
    return "PgUp";
  }

  if (key === "PageDown") {
    return "PgDn";
  }

  return key;
}

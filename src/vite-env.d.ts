/// <reference types="vite/client" />

interface ShiguangDesktopApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  on(channel: string, callback: (payload: unknown) => void): () => void;
  dialog: {
    open(options: {
      title?: string;
      defaultPath?: string;
      buttonLabel?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      properties?: string[];
    }): Promise<string | string[] | null>;
  };
  fs: {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
  };
  file: {
    getPathForFile(file: File): string;
  };
  clipboard: {
    readText(): string;
    writeText(text: string): void;
  };
  asset: {
    toUrl(path: string): Promise<string>;
  };
  log(level: string, message: string): Promise<void>;
}

interface Window {
  shiguang?: ShiguangDesktopApi;
}

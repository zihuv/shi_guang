import { listenDesktop } from "@/services/desktop/core";

type DesktopTaskSnapshot = {
  status: string;
};

export async function waitForDesktopTask<T extends DesktopTaskSnapshot>({
  eventChannel,
  getSnapshot,
  isTerminal,
  onUpdate,
  pollIntervalMs = 1000,
  taskId,
}: {
  eventChannel: string;
  getSnapshot: (taskId: string) => Promise<T>;
  isTerminal: (status: string) => boolean;
  onUpdate: (task: T) => void;
  pollIntervalMs?: number;
  taskId: string;
}) {
  let unlisten: (() => void) | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let isSettled = false;
  let isRefreshing = false;
  let needsRefresh = false;

  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };

    const finish = (snapshot: T) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(snapshot);
    };

    const fail = (error: unknown) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(error);
    };

    const refreshSnapshot = async () => {
      if (isSettled) return;
      if (isRefreshing) {
        needsRefresh = true;
        return;
      }

      isRefreshing = true;
      try {
        const snapshot = await getSnapshot(taskId);
        onUpdate(snapshot);
        if (isTerminal(snapshot.status)) {
          finish(snapshot);
        }
      } catch (error) {
        fail(error);
      } finally {
        isRefreshing = false;
        if (needsRefresh && !isSettled) {
          needsRefresh = false;
          void refreshSnapshot();
        }
      }
    };

    fallbackTimer = setInterval(() => {
      void refreshSnapshot();
    }, pollIntervalMs);

    void listenDesktop<string>(eventChannel, (event) => {
      if (event.payload !== taskId || isSettled) return;
      void refreshSnapshot();
    })
      .then((dispose) => {
        if (isSettled) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch(() => {
        // Keep fallback timer when event subscription fails.
      });

    void refreshSnapshot();
  });
}

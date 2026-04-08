import { useEffect, useRef } from "react";
import { useBootstrapStore } from "@/stores/bootstrapStore";

export function useAppInitialization() {
  const bootstrap = useBootstrapStore((state) => state.bootstrap);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) {
      return;
    }

    initRef.current = true;
    void bootstrap();
  }, [bootstrap]);
}

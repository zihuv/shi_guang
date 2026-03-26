import { useEffect } from "react";

export function useDocumentTheme(theme: string) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
}

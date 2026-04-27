import type { AppView } from "@/stores/navigationStore";

export function shouldResetHiddenQueryStateForSmartCollection(currentView: AppView) {
  return currentView !== "library";
}

import type { AppView } from "@/stores/navigationStore";
import type { SmartCollectionId } from "@/stores/fileTypes";

export function shouldResetQueryStateForSmartCollectionEntry(args: {
  currentView: AppView;
  smartCollection: SmartCollectionId;
}) {
  return args.currentView !== "library" || args.smartCollection === "similar";
}

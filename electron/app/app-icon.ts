import { app, nativeImage } from "electron";
import fssync from "node:fs";
import path from "node:path";

export function getAppIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "assets", "app-icon.png")]
    : [
        path.join(process.cwd(), "assets", "app-icon.png"),
        path.join(process.cwd(), "src", "assets", "app-icon.png"),
      ];

  const iconPath = candidates.find((candidate) => fssync.existsSync(candidate));
  return iconPath ?? path.join(process.cwd(), "assets", "image.png");
}

export function setDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  const icon = nativeImage.createFromPath(getAppIconPath());
  if (!icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

export function setDockVisibility(visible: boolean): void {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  if (visible) {
    app.dock.show();
    return;
  }

  app.dock.hide();
}

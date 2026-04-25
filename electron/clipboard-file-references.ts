import { clipboard, nativeImage } from "electron";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { FileRecord } from "./types";
import { serializeClipboardImportedImageItems, SHIGUANG_CLIPBOARD_FORMAT } from "./clipboard";

const execFileAsync = promisify(execFile);

const WRITE_MAC_FILE_REFERENCES_SCRIPT = `
ObjC.import("AppKit");

function run(argv) {
  const metadataBase64 = argv[0] || "";
  const paths = argv.slice(1);
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;

  const urls = $.NSMutableArray.array;
  for (const filePath of paths) {
    urls.addObject($.NSURL.fileURLWithPath(filePath));
  }
  if (!ObjC.unwrap(pasteboard.writeObjects(urls))) {
    throw new Error("Failed to write file URLs to pasteboard");
  }

  const pathText = paths.join("\\n");
  pasteboard.setStringForType(pathText, "public.utf8-plain-text");
  pasteboard.setStringForType(pathText, "NSStringPboardType");

  if (metadataBase64) {
    const metadata = $.NSData.alloc.initWithBase64EncodedStringOptions(metadataBase64, 0);
    pasteboard.setDataForType(metadata, "${SHIGUANG_CLIPBOARD_FORMAT}");
  }
}
`;

const WRITE_WINDOWS_FILE_REFERENCES_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Collections

$metadataBase64 = if ($args.Count -gt 0) { $args[0] } else { "" }
$paths = @()
if ($args.Count -gt 1) {
  $paths = $args[1..($args.Count - 1)]
}

$files = New-Object System.Collections.Specialized.StringCollection
foreach ($filePath in $paths) {
  [void]$files.Add($filePath)
}

$dataObject = New-Object System.Windows.Forms.DataObject
$dataObject.SetFileDropList($files)
$dataObject.SetText(($paths -join [Environment]::NewLine))

if ($metadataBase64) {
  $metadata = [Convert]::FromBase64String($metadataBase64)
  $dataObject.SetData("${SHIGUANG_CLIPBOARD_FORMAT}", $metadata)
}

[System.Windows.Forms.Clipboard]::SetDataObject($dataObject, $true, 10, 100)
`;

export async function writeFilesToClipboard(files: FileRecord[]): Promise<void> {
  const paths = files.map((file) => file.path);
  const metadata = files.length > 0 ? serializeClipboardImportedImageItems(files) : null;

  if (process.platform === "darwin" && paths.length > 0) {
    try {
      await writeMacFileReferences(paths, metadata);
      return;
    } catch (error) {
      console.error("Failed to write macOS file references to clipboard:", error);
    }
  }

  if (process.platform === "win32" && paths.length > 0) {
    try {
      await writeWindowsFileReferences(paths, metadata);
      return;
    } catch (error) {
      console.error("Failed to write Windows file references to clipboard:", error);
    }
  }

  if (process.platform === "linux" && paths.length > 0) {
    writeLinuxFileReferences(paths, metadata);
    return;
  }

  writeFallbackClipboard(files, paths, metadata);
}

async function writeMacFileReferences(paths: string[], metadata: Buffer | null): Promise<void> {
  await execFileAsync(
    "osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      WRITE_MAC_FILE_REFERENCES_SCRIPT,
      "--",
      metadata?.toString("base64") ?? "",
      ...paths,
    ],
    { timeout: 5000 },
  );
}

async function writeWindowsFileReferences(paths: string[], metadata: Buffer | null): Promise<void> {
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WRITE_WINDOWS_FILE_REFERENCES_SCRIPT,
      metadata?.toString("base64") ?? "",
      ...paths,
    ],
    { timeout: 5000 },
  );
}

function writeLinuxFileReferences(paths: string[], metadata: Buffer | null): void {
  const fileUrls = paths.map((filePath) => pathToFileURL(filePath).toString());

  clipboard.writeText(paths.join("\n"));
  clipboard.writeBuffer(
    "x-special/gnome-copied-files",
    Buffer.from(`copy\n${fileUrls.join("\n")}`, "utf8"),
  );
  clipboard.writeBuffer("text/uri-list", Buffer.from(`${fileUrls.join("\r\n")}\r\n`, "utf8"));
  if (metadata) {
    clipboard.writeBuffer(SHIGUANG_CLIPBOARD_FORMAT, metadata);
  }
}

function writeFallbackClipboard(
  files: FileRecord[],
  paths: string[],
  metadata: Buffer | null,
): void {
  if (files.length === 1) {
    const image = nativeImage.createFromPath(files[0].path);
    if (!image.isEmpty()) {
      clipboard.write({
        image,
        text: files[0].path,
      });
      if (metadata) {
        clipboard.writeBuffer(SHIGUANG_CLIPBOARD_FORMAT, metadata);
      }
      return;
    }
  }

  clipboard.writeText(paths.join("\n"));
  if (metadata) {
    clipboard.writeBuffer(SHIGUANG_CLIPBOARD_FORMAT, metadata);
  }
}

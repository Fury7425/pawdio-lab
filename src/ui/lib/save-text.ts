/**
 * Save exported text somewhere the user can find it.
 *
 * With an output folder the file goes straight into it. Without one the user
 * picks a location in the native save dialog. A blob download is only the
 * fallback for the plain browser preview (`npm run dev`): inside the desktop
 * webview an `<a download>` click is not reliably handled and can silently
 * save nothing.
 */
import * as ipc from "../../ipc/commands";
import { downloadText } from "./export-files";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Split a full path into its folder (with trailing separator) and name. */
export function splitSavePath(path: string): { dir: string; name: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/**
 * Write `content` and resolve to the saved path, or null when the user
 * cancelled the save dialog.
 */
export async function saveTextFile(options: {
  outputDir?: string | null;
  filename: string;
  content: string;
  mimeType: string;
}): Promise<string | null> {
  const { outputDir, filename, content, mimeType } = options;
  if (outputDir && outputDir.trim()) {
    return ipc.writeTextExport({ outputDir, filename, content });
  }
  if (!inTauri()) {
    downloadText(content, filename, mimeType);
    return filename;
  }
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1)
    : "txt";
  const target = await ipc.pickSavePath(filename, extension);
  if (!target) return null;
  const { dir, name } = splitSavePath(target);
  return ipc.writeTextExport({ outputDir: dir, filename: name, content });
}

export function saveJsonFile(filename: string, value: unknown) {
  return saveTextFile({
    filename,
    content: `${JSON.stringify(value, null, 2)}\n`,
    mimeType: "application/json;charset=utf-8",
  });
}

export function saveCsvFile(filename: string, content: string) {
  return saveTextFile({
    filename,
    content,
    mimeType: "text/csv;charset=utf-8",
  });
}

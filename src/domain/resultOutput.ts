import type { NotebookCell } from "./types";

export interface ResultSharePayload {
  title: string;
  text: string;
}

export function resultSectionDivider(label: string): string {
  return `// --- ${label} ---`;
}

export function isResultSectionDividerLine(line: string): boolean {
  return /^\/\/ --- .+ ---$/.test(line.trim());
}

export function hasShareableOutput(cell: NotebookCell): boolean {
  return cell.kind !== "text" && cell.output.trim().length > 0;
}

export function resultOutputFilename(cell: NotebookCell): string {
  const base = `${cell.alias || "cell"}-${cell.title || "result"}-result`;
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${normalized || "cell_result"}.txt`;
}

export function resultSharePayload(cell: NotebookCell): ResultSharePayload {
  return {
    title: `${cell.alias}: ${cell.title || "ICC-GO result"}`,
    text: cell.output,
  };
}

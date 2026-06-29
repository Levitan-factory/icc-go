import { createId, nowIso } from "../lib/id";
import type { CellAttachment } from "./types";

export const MAX_ATTACHMENTS_PER_CELL = 12;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface AttachmentRejection {
  name: string;
  reason: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv",
  ".diff": "text/x-diff",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".py": "text/x-python",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

const TEXT_EXTENSIONS = new Set([
  ".csv",
  ".diff",
  ".html",
  ".json",
  ".md",
  ".patch",
  ".py",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export async function filesToAttachments(
  files: File[] | FileList,
  cellId: string,
  existing: CellAttachment[] = [],
): Promise<{ attachments: CellAttachment[]; rejected: AttachmentRejection[] }> {
  const accepted: CellAttachment[] = [];
  const rejected: AttachmentRejection[] = [];
  const incoming = Array.from(files);

  for (const file of incoming) {
    if (existing.length + accepted.length >= MAX_ATTACHMENTS_PER_CELL) {
      rejected.push({
        name: file.name,
        reason: `Only ${MAX_ATTACHMENTS_PER_CELL} files can be attached to one cell.`,
      });
      continue;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      rejected.push({
        name: file.name,
        reason: `File is ${formatBytes(file.size)}; the per-file limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      });
      continue;
    }

    accepted.push(await fileToAttachment(file, cellId, [...existing, ...accepted]));
  }

  return { attachments: accepted, rejected };
}

export async function fileToAttachment(
  file: File,
  cellId: string,
  existing: CellAttachment[] = [],
): Promise<CellAttachment> {
  const displayName = uniqueAttachmentName(file.name || "untitled", existing);
  const extension = extensionFromName(displayName);
  const mimeType = file.type || MIME_BY_EXTENSION[extension] || "application/octet-stream";
  const textLike = isTextAttachment(displayName, mimeType);
  const content = textLike ? await file.text() : arrayBufferToBase64(await file.arrayBuffer());

  return {
    id: createId("attachment"),
    cellId,
    displayName,
    extension,
    mimeType,
    sizeBytes: file.size,
    content,
    encoding: textLike ? "text" : "base64",
    createdAt: nowIso(),
  };
}

export function extensionFromName(name: string): string {
  const match = name.trim().toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function isTextAttachment(name: string, mimeType: string): boolean {
  const extension = extensionFromName(name);
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.includes("xml") || TEXT_EXTENSIONS.has(extension);
}

export function attachmentToUint8Array(attachment: CellAttachment): Uint8Array {
  if (attachment.encoding === "base64") return base64ToUint8Array(attachment.content);
  return new TextEncoder().encode(attachment.content);
}

export function attachmentToBlob(attachment: CellAttachment): Blob {
  const bytes = attachmentToUint8Array(attachment);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: attachment.mimeType });
}

export function attachmentPreview(attachment: CellAttachment, maxChars = 1600): string {
  if (attachment.encoding !== "text") {
    return `${attachment.displayName} is a binary file (${formatBytes(attachment.sizeBytes)}).`;
  }

  return attachment.content.length > maxChars ? `${attachment.content.slice(0, maxChars)}\n...` : attachment.content;
}

export function attachmentContext(attachments: CellAttachment[]): string {
  const readable = attachments.filter((attachment) => attachment.encoding === "text");
  const binary = attachments.filter((attachment) => attachment.encoding === "base64");
  if (!readable.length && !binary.length) return "";

  const sections = readable.map((attachment) => [
    `# Attached file: ${attachment.displayName}`,
    `MIME: ${attachment.mimeType}`,
    attachmentPreview(attachment, 4000),
  ].join("\n"));

  if (binary.length) {
    sections.push([
      "# Attached binary files",
      ...binary.map((attachment) => `- ${attachment.displayName} (${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)})`),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function fileKindLabel(attachment: Pick<CellAttachment, "extension" | "mimeType">): string {
  if (attachment.mimeType.startsWith("image/")) return "Image";
  if (attachment.mimeType === "application/pdf") return "PDF";
  if (attachment.extension === ".csv") return "CSV";
  if (attachment.extension === ".json") return "JSON";
  if (attachment.extension === ".md") return "Markdown";
  if (attachment.extension === ".py") return "Python";
  if (attachment.extension === ".xlsx" || attachment.extension === ".xls") return "Spreadsheet";
  if (attachment.mimeType.startsWith("text/")) return "Text";
  return attachment.extension ? attachment.extension.slice(1).toUpperCase() : "File";
}

export function safeArchivePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "") || "file";
}

function uniqueAttachmentName(name: string, existing: CellAttachment[]): string {
  const safe = name.trim().replace(/[\\/]/g, "-") || "untitled";
  const taken = new Set(existing.map((attachment) => attachment.displayName.toLowerCase()));
  if (!taken.has(safe.toLowerCase())) return safe;

  const extension = extensionFromName(safe);
  const stem = extension ? safe.slice(0, -extension.length) : safe;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  return `${stem} ${Date.now()}${extension}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

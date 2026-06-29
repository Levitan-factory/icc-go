import { strToU8, zipSync } from "fflate";
import { migrateLegacyIccSyntax, parseCellDsl } from "../language/latest";
import {
  ICC_GO_VERSION,
  ICC_GO_VERSION_LABEL,
  SUPPORTED_ICC_DSL_CHANNEL,
  SUPPORTED_ICC_DSL_VERSION,
  SUPPORTED_ICC_DSL_VERSION_LABEL,
} from "../version";
import { attachmentToUint8Array, base64ToUint8Array, formatBytes, safeArchivePathSegment } from "./attachments";
import { providerAliasOptions } from "./providerAliases";
import type { Artifact, CellAttachment, Notebook, NotebookCell, Project, WorkspaceSettings } from "./types";

export interface NotebookExportPayload {
  format: "iccgo.notebook";
  version: "1.3";
  app_version: string;
  created_with: string;
  language_version: string;
  dsl_version: string;
  dsl_channel: string;
  exported_at: string;
  project: {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  };
  notebook: {
    id: string;
    name: string;
    methodology: "Intent-Cell Coding";
    product: "ICC-GO Notebook";
    metadata: Notebook["metadata"];
  };
  cells: unknown[];
  attachments: CellAttachment[];
  artifacts: Artifact[];
  runs: unknown[];
  snapshots: unknown[];
}

export function buildNotebookExport(
  project: Project,
  notebook: Notebook,
  settings: WorkspaceSettings,
): NotebookExportPayload {
  const intentCells = notebook.cells.filter((cell) => cell.kind !== "text");
  const knownAliases = intentCells.map((cell) => cell.alias);

  return {
    format: "iccgo.notebook",
    version: "1.3",
    app_version: ICC_GO_VERSION,
    created_with: ICC_GO_VERSION_LABEL,
    language_version: SUPPORTED_ICC_DSL_VERSION_LABEL,
    dsl_version: SUPPORTED_ICC_DSL_VERSION,
    dsl_channel: SUPPORTED_ICC_DSL_CHANNEL,
    exported_at: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    },
    notebook: {
      id: notebook.id,
      name: notebook.title,
      methodology: "Intent-Cell Coding",
      product: "ICC-GO Notebook",
      metadata: notebook.metadata,
    },
    cells: notebook.cells.map((cell, index) => {
      if (cell.kind === "text") {
        return {
          uuid: cell.id,
          type: "text",
          order: index + 1,
          markdown: cell.noteBody ?? "",
        };
      }

      const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
        knownAliases,
        providerAliases: providerAliasOptions(settings),
        defaultLoopIterations: settings.orchestration.defaultLoopIterations,
        maxLoopIterations: settings.orchestration.maxLoopIterations,
        cells: intentCells,
      });

      return {
        id: cell.alias,
        uuid: cell.id,
        type: "prompt",
        title: cell.title,
        order: index + 1,
        control_header: cell.controlHeader,
        prompt: cell.promptBody,
        parsed_header: parsed,
        input: {
          attachments: cell.attachments,
        },
        output: {
          text: cell.output,
          vars: cell.vars,
          artifacts: cell.artifacts.map((artifact) => artifact.id),
        },
        state: {
          status: cell.status,
          stale: cell.status === "stale",
          stale_reason: cell.staleReason ?? null,
          collapsed: cell.viewMode === "compact",
        },
      };
    }),
    attachments: notebook.cells.flatMap((cell) => cell.attachments),
    artifacts: notebook.cells.flatMap((cell) => cell.artifacts),
    runs: notebook.cells.flatMap((cell) => cell.runHistory),
    snapshots: notebook.snapshots.map((snapshot) => ({
      id: snapshot.id,
      notebook_id: snapshot.notebookId,
      name: snapshot.name,
      note: snapshot.note,
      created_at: snapshot.createdAt,
    })),
  };
}

export function buildNotebookMarkdown(project: Project, notebook: Notebook): string {
  const lines = [
    `# ${notebook.title}`,
    "",
    `Product: ICC-GO Notebook ${ICC_GO_VERSION}  `,
    `Language: ${SUPPORTED_ICC_DSL_VERSION_LABEL}  `,
    "Methodology: Intent-Cell Coding  ",
    `Project: ${project.name}  `,
    `Exported: ${new Date().toLocaleString()}`,
    "",
    "---",
    "",
  ];

  notebook.cells.forEach((cell) => {
    lines.push(...cellToMarkdown(cell), "", "---", "");
  });

  return lines.join("\n");
}

export function cellToMarkdown(cell: NotebookCell): string[] {
  if (cell.kind === "text") {
    return cell.noteBody?.trim() ? [cell.noteBody] : [];
  }

  const lines = [`## ${cell.alias} - ${cell.title}`, ""];

  if (cell.controlHeader.trim()) {
    lines.push("### ICC Header", "", "```text", migrateLegacyIccSyntax(cell.controlHeader), "```", "");
  }

  if (cell.promptBody.trim()) {
    lines.push("### Prompt / code", "", migrateLegacyIccSyntax(cell.promptBody), "");
  }

  if (cell.attachments.length) {
    lines.push("### Attached files", "");
    cell.attachments.forEach((attachment) => {
      lines.push(`- ${attachment.displayName} (${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)})`);
    });
    lines.push("");
  }

  if (cell.output.trim()) {
    lines.push("### Result", "", "```text", cell.output, "```", "");
  }

  if (cell.artifacts.length) {
    lines.push("### Artifacts", "");
    cell.artifacts.forEach((artifact) => {
      lines.push(`- ${artifact.displayName}${artifact.version > 1 ? ` v${artifact.version}` : ""}`);
    });
    lines.push("");
  }

  return lines;
}

export function buildNotebookZip(project: Project, notebook: Notebook, settings: WorkspaceSettings): Blob {
  const json = JSON.stringify(buildNotebookExport(project, notebook, settings), null, 2);
  const markdown = buildNotebookMarkdown(project, notebook);
  const runHistory = JSON.stringify(notebook.cells.flatMap((cell) => cell.runHistory), null, 2);
  const snapshots = JSON.stringify(notebook.snapshots, null, 2);
  const files: Record<string, Uint8Array> = {
    "notebook.iccgo.json": strToU8(json),
    "notebook.md": strToU8(markdown),
    "runs/run_history.json": strToU8(runHistory),
    "snapshots/snapshots.json": strToU8(snapshots),
  };

  notebook.cells.forEach((cell) => {
    cell.attachments.forEach((attachment) => {
      files[`attachments/${safeArchivePathSegment(cell.alias || "text")}/${safeArchivePathSegment(attachment.displayName)}`] =
        attachmentToUint8Array(attachment);
    });

    cell.artifacts
      .filter((artifact) => artifact.status === "created")
      .forEach((artifact) => {
        files[`artifacts/${safeArchivePathSegment(cell.alias)}/${safeArchivePathSegment(artifact.displayName)}`] =
          artifact.metadata.channel === "image" ? base64ToUint8Array(artifact.content) : strToU8(artifact.content);
      });
  });

  return new Blob([zipSync(files)], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(value: string, extension: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${base || "notebook"}${extension}`;
}

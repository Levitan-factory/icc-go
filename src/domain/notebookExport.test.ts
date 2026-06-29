import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createInitialWorkspace } from "./fixtures";
import { buildNotebookExport, buildNotebookMarkdown, buildNotebookZip } from "./notebookExport";

describe("notebook export", () => {
  it("exports input attachments separately from generated artifacts", async () => {
    const workspace = createInitialWorkspace();
    const project = workspace.projects[0];
    const notebook = project.notebooks[0];
    const cell = notebook.cells.find((candidate) => candidate.kind !== "text")!;

    cell.attachments = [
      {
        id: "attachment_context",
        cellId: cell.id,
        displayName: "context.txt",
        extension: ".txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        content: "hello world",
        encoding: "text",
        createdAt: "2026-06-20T00:00:00.000Z",
      },
    ];

    const payload = buildNotebookExport(project, notebook, workspace.settings);
    const markdown = buildNotebookMarkdown(project, notebook);
    const zip = buildNotebookZip(project, notebook, workspace.settings);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));

    expect(payload.version).toBe("1.3");
    expect(payload.dsl_version).toBe(notebook.metadata.dsl_version);
    expect(payload.dsl_channel).toBe(notebook.metadata.dsl_channel);
    expect(payload.notebook.metadata.runtime).toBe("icc-go");
    expect(payload.attachments).toHaveLength(1);
    expect(JSON.stringify(payload.cells)).toContain("context.txt");
    expect(markdown).toContain("### Attached files");
    expect(strFromU8(files[`attachments/${cell.alias}/context.txt`])).toBe("hello world");
  });
});

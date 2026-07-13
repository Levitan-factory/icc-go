import { describe, expect, it } from "vitest";
import { runningDeleteWarning, runningIntentCellCountForNotebook, runningIntentCellCountForProject, runningIntentCellIdsForNotebook } from "./runState";
import type { Notebook, NotebookCell, Project } from "./types";

describe("run state helpers", () => {
  it("finds running intent cells from explicit running ids and persisted status", () => {
    const notebook = notebookWithCells([
      cell("cell_a", "c1", "not_run"),
      cell("cell_b", "c2", "running"),
      textCell("note_1"),
      cell("cell_c", "c3", "completed"),
    ]);

    expect(runningIntentCellIdsForNotebook(notebook, new Set(["cell_c", "note_1"]))).toEqual(["cell_b", "cell_c"]);
    expect(runningIntentCellCountForNotebook(notebook, new Set(["cell_c", "note_1"]))).toBe(2);
  });

  it("counts running cells across project notebooks", () => {
    const project: Project = {
      id: "project_1",
      name: "Research",
      notebooks: [
        notebookWithCells([cell("cell_a", "c1", "running")]),
        notebookWithCells([cell("cell_b", "c1", "not_run"), cell("cell_c", "c2", "not_run")]),
      ],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    };

    expect(runningIntentCellCountForProject(project, new Set(["cell_c"]))).toBe(2);
  });

  it("builds delete warnings only when runs are active", () => {
    expect(runningDeleteWarning(0, "notebook")).toBe("");
    expect(runningDeleteWarning(1, "notebook")).toContain("1 running request is still in progress");
    expect(runningDeleteWarning(2, "project")).toContain("2 running requests are still in progress");
    expect(runningDeleteWarning(2, "project")).toContain("Deleting this project will cancel them");
  });
});

function notebookWithCells(cells: NotebookCell[]): Notebook {
  return {
    id: "notebook_1",
    title: "Notebook",
    description: "",
    cells,
    cellAliasCounter: 3,
    metadata: {
      dsl_version: "1.04",
      dsl_version_label: "v1.04",
      dsl_channel: "stable",
      runtime: "icc-go",
      created_with: "0.1.11",
      created_at: "2026-07-05T00:00:00.000Z",
    },
    snapshots: [],
    viewState: {
      mode: "expanded",
      sidebarVisible: true,
      inspectorVisible: true,
      showArtifacts: true,
      showExecutionMetadata: false,
      showCellIds: true,
      showDslPreview: true,
    },
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
  };
}

function cell(id: string, alias: string, status: NotebookCell["status"]): NotebookCell {
  return {
    id,
    kind: "intent",
    alias,
    title: alias,
    controlHeader: "> openai",
    promptBody: "Draft.",
    output: "",
    status,
    viewMode: "expanded",
    collapsedPrompt: false,
    collapsedOutput: false,
    vars: {},
    attachments: [],
    artifacts: [],
    runHistory: [],
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z",
  };
}

function textCell(id: string): NotebookCell {
  return {
    ...cell(id, "", "not_run"),
    kind: "text",
    title: "Text",
    noteBody: "Note.",
    controlHeader: "",
    promptBody: "",
  };
}

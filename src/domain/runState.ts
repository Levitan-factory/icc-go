import type { Notebook, Project } from "./types";

export function runningIntentCellIdsForNotebook(notebook: Notebook, runningCellIds: Set<string>): string[] {
  return notebook.cells
    .filter((cell) => cell.kind !== "text" && (cell.status === "running" || runningCellIds.has(cell.id)))
    .map((cell) => cell.id);
}

export function runningIntentCellCountForNotebook(notebook: Notebook, runningCellIds: Set<string>): number {
  return runningIntentCellIdsForNotebook(notebook, runningCellIds).length;
}

export function runningIntentCellCountForProject(project: Project, runningCellIds: Set<string>): number {
  return project.notebooks.reduce(
    (total, notebook) => total + runningIntentCellCountForNotebook(notebook, runningCellIds),
    0,
  );
}

export function runningDeleteWarning(count: number, target: "notebook" | "project"): string {
  if (!count) return "";
  const plural = count === 1 ? "request is" : "requests are";
  const them = count === 1 ? "it" : "them";
  return `${count} running ${plural} still in progress. Deleting this ${target} will cancel ${them} and discard any pending output.`;
}

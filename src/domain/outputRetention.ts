import type { NotebookCell, RunRecord } from "./types";

function clearRunText(run: RunRecord): RunRecord {
  return {
    ...run,
    summary: "Text output cleared. Generated files, if any, are retained.",
    textOutputRaw: "",
    textOutputVisible: "",
    vars: {},
  };
}

export function clearVisibleCellOutput(cell: NotebookCell, updatedAt: string): NotebookCell {
  const hasCreatedArtifacts = cell.artifacts.some((artifact) => artifact.status === "created");
  const clearedLastRun = cell.lastRun ? clearRunText(cell.lastRun) : undefined;
  const clearedRunId = cell.lastRun?.id;

  return {
    ...cell,
    output: "",
    vars: {},
    decision: undefined,
    status: hasCreatedArtifacts ? "completed" : "not_run",
    staleReason: undefined,
    lastRun: hasCreatedArtifacts ? clearedLastRun : undefined,
    runHistory: clearedRunId
      ? cell.runHistory.map((run) => (run.id === clearedRunId ? clearRunText(run) : run))
      : cell.runHistory,
    updatedAt,
  };
}

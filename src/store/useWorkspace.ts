import { useEffect, useMemo, useRef, useState } from "react";
import { parseCellDsl } from "../language/latest";
import { attachmentContext, filesToAttachments } from "../domain/attachments";
import { createInitialWorkspace } from "../domain/fixtures";
import { createNotebookMetadata, normalizeNotebookMetadata } from "../domain/notebookMetadata";
import { executeCellRun } from "../domain/providerExecution";
import { deleteProviderSecret, readProviderSecret } from "../domain/providerSecrets";
import { clearVisibleCellOutput } from "../domain/outputRetention";
import {
  buildNotebookExport,
  buildNotebookMarkdown,
  buildNotebookZip,
  cellToMarkdown,
  downloadBlob,
  safeFilename,
} from "../domain/notebookExport";
import {
  createProviderSettings,
  normalizeOrchestrationSettings,
  normalizeProviderSettings,
  providerAliasOptions,
} from "../domain/providerAliases";
import {
  chooseAutoModelForProvider,
  refreshProviderModelCatalog,
  uniqueRegistryModelChoices,
} from "../domain/providerModelRegistry";
import type { CellRunResult, RunContext } from "../domain/runtime";
import type {
  Artifact,
  CellAttachment,
  CellStatus,
  CellViewMode,
  Diagnostic,
  Notebook,
  NotebookCell,
  NotebookDslChannel,
  NotebookSnapshot,
  ParsedDsl,
  Project,
  ProviderKind,
  ProviderSettings,
  OrchestrationSettings,
  SaveStatus,
  WorkspaceState,
} from "../domain/types";
import { createId, nowIso } from "../lib/id";

const STORAGE_KEY = "icc-go.workspace.v1.2";
const LEGACY_STORAGE_KEY = "icc-go.workspace.v1.1";
const MODEL_CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
const MODEL_CATALOG_RETRY_MS = 5 * 60 * 1000;

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [runningCellIds, setRunningCellIds] = useState<Set<string>>(() => new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(() => getActiveNotebook(loadWorkspace())?.lastSavedAt);
  const runTimersRef = useRef<Record<string, number>>({});
  const runAbortRef = useRef<Record<string, AbortController>>({});
  const workspaceRef = useRef(workspace);
  const undoStackRef = useRef<Notebook[]>([]);
  const redoStackRef = useRef<Notebook[]>([]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    const inFlight = new Set<string>();

    async function refreshProvider(provider: ProviderSettings) {
      if (inFlight.has(provider.id)) return;
      const secret = readProviderSecret(provider.id);
      if (!secret && provider.provider !== "openrouter") return;

      inFlight.add(provider.id);
      try {
        const refresh = await refreshProviderModelCatalog(provider, secret || undefined);
        if (cancelled) return;

        const choices = uniqueRegistryModelChoices(refresh.choices);
        const patch: Partial<ProviderSettings> = {
          modelCatalog: choices,
          modelCatalogUpdatedAt: refresh.fetchedAt,
          modelCatalogSource: refresh.source,
          defaultModel: chooseAutoModelForProvider(provider.provider, choices, "default", provider.defaultModel),
          maxModel: chooseAutoModelForProvider(provider.provider, choices, "max", provider.maxModel),
          ensembleModel: chooseAutoModelForProvider(provider.provider, choices, "ensemble", provider.ensembleModel),
          cheapModel: chooseAutoModelForProvider(provider.provider, choices, "cheap", provider.cheapModel),
          fastModel: chooseAutoModelForProvider(provider.provider, choices, "fast", provider.fastModel),
          codeModel: chooseAutoModelForProvider(provider.provider, choices, "code", provider.codeModel),
        };
        if (provider.imageModel) {
          patch.imageModel = chooseAutoModelForProvider(provider.provider, choices, "image", provider.imageModel);
        }

        setWorkspace((current) => ({
          ...current,
          settings: {
            ...current.settings,
            providers: current.settings.providers.map((candidate) =>
              candidate.id === provider.id ? normalizeProviderSettings({ ...candidate, ...patch }) : candidate,
            ),
          },
        }));
      } catch {
        // Keep the editor deterministic even when a provider catalog API is unavailable.
      } finally {
        inFlight.delete(provider.id);
      }
    }

    function refreshStaleCatalogs() {
      workspaceRef.current.settings.providers.filter(shouldRefreshProviderModels).forEach((provider) => {
        void refreshProvider(provider);
      });
    }

    refreshStaleCatalogs();
    const interval = window.setInterval(refreshStaleCatalogs, MODEL_CATALOG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        const savedAt = nowIso();
        setLastSavedAt(savedAt);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("failed");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [workspace]);

  const activeProject = useMemo(
    () => workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? workspace.projects[0],
    [workspace.activeProjectId, workspace.projects],
  );

  const activeNotebook = useMemo(
    () =>
      activeProject?.notebooks.find((notebook) => notebook.id === workspace.activeNotebookId) ??
      activeProject?.notebooks[0],
    [activeProject, workspace.activeNotebookId],
  );

  const selectedCell = useMemo(
    () => activeNotebook?.cells.find((cell) => cell.id === workspace.selectedCellId),
    [activeNotebook, workspace.selectedCellId],
  );

  const knownAliases = activeNotebook?.cells.filter(isIntentCell).map((cell) => cell.alias) ?? [];
  const allArtifacts = activeNotebook?.cells.filter(isIntentCell).flatMap((cell) => cell.artifacts) ?? [];
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  function withHistory(current: WorkspaceState, updater: (workspace: WorkspaceState) => WorkspaceState) {
    const notebook = getActiveNotebook(current);
    if (notebook) {
      undoStackRef.current = [...undoStackRef.current.slice(-49), cloneNotebook(notebook)];
      redoStackRef.current = [];
    }
    return updater(current);
  }

  function setActiveProject(projectId: string) {
    setWorkspace((current) => {
      const project = current.projects.find((candidate) => candidate.id === projectId);
      const notebook = project?.notebooks[0];

      return {
        ...current,
        activeProjectId: projectId,
        activeNotebookId: notebook?.id ?? current.activeNotebookId,
        selectedCellId: notebook?.cells[0]?.id,
      };
    });
  }

  function setActiveNotebook(notebookId: string) {
    setWorkspace((current) => {
      const notebook = current.projects
        .flatMap((project) => project.notebooks)
        .find((candidate) => candidate.id === notebookId);

      return {
        ...current,
        activeNotebookId: notebookId,
        selectedCellId: notebook?.cells[0]?.id,
      };
    });
  }

  function selectCell(cellId: string) {
    setWorkspace((current) => ({ ...current, selectedCellId: cellId }));
  }

  function createProject() {
    const timestamp = nowIso();
    const notebook = createNotebook("Untitled notebook");
    const project: Project = {
      id: createId("project"),
      name: "New project",
      notebooks: [notebook],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setWorkspace((current) => ({
      ...current,
      projects: [...current.projects, project],
      activeProjectId: project.id,
      activeNotebookId: notebook.id,
      selectedCellId: notebook.cells[0]?.id,
    }));
  }

  function deleteProject(projectId: string) {
    setWorkspace((current) => {
      const target = current.projects.find((project) => project.id === projectId);
      if (!target) return current;

      const remaining = current.projects.filter((project) => project.id !== projectId);
      const fallbackProject =
        remaining[0] ??
        (() => {
          const timestamp = nowIso();
          return {
            id: createId("project"),
            name: "New project",
            notebooks: [createNotebook("Untitled notebook")],
            createdAt: timestamp,
            updatedAt: timestamp,
          };
        })();
      const projects = remaining.length ? remaining : [fallbackProject];
      const nextActiveProject =
        current.activeProjectId === projectId
          ? fallbackProject
          : projects.find((project) => project.id === current.activeProjectId) ?? fallbackProject;
      const nextNotebook = nextActiveProject.notebooks[0];

      return {
        ...current,
        projects,
        activeProjectId: nextActiveProject.id,
        activeNotebookId: nextNotebook?.id ?? current.activeNotebookId,
        selectedCellId: nextNotebook?.cells[0]?.id,
      };
    });
  }

  function createNotebookInActiveProject() {
    const notebook = createNotebook("Untitled notebook");

    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === current.activeProjectId
          ? { ...project, notebooks: [...project.notebooks, notebook], updatedAt: nowIso() }
          : project,
      ),
      activeNotebookId: notebook.id,
      selectedCellId: notebook.cells[0]?.id,
    }));
  }

  function addCell(afterCellId?: string) {
    const timestamp = nowIso();
    const cellId = createId("cell");

    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => {
          const nextAliasCounter = notebook.cellAliasCounter + 1;
          const cell = createBlankCell(cellId, `c${nextAliasCounter}`, timestamp);
          const index = afterCellId ? notebook.cells.findIndex((candidate) => candidate.id === afterCellId) : -1;
          const cells = [...notebook.cells];

          if (index >= 0) cells.splice(index + 1, 0, cell);
          else cells.push(cell);

          return {
            ...notebook,
            cellAliasCounter: nextAliasCounter,
            cells,
            updatedAt: timestamp,
          };
        }, cellId),
      ),
    );
  }

  function addTextCell(afterCellId?: string) {
    const timestamp = nowIso();
    const cellId = createId("note");

    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => {
          const cell = createTextCell(cellId, timestamp);
          const index = afterCellId ? notebook.cells.findIndex((candidate) => candidate.id === afterCellId) : -1;
          const cells = [...notebook.cells];

          if (index >= 0) cells.splice(index + 1, 0, cell);
          else cells.push(cell);

          return {
            ...notebook,
            cells,
            updatedAt: timestamp,
          };
        }, cellId),
      ),
    );
  }

  function updateCell(cellId: string, patch: Partial<NotebookCell>) {
    const invalidatesOutput = patch.controlHeader !== undefined || patch.promptBody !== undefined || patch.attachments !== undefined;

    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => {
          const source = notebook.cells.find((cell) => cell.id === cellId);
          if (!source) return notebook;

          const cells = notebook.cells.map((cell) => {
            if (cell.id !== cellId) return cell;

            const next: NotebookCell = {
              ...cell,
              ...patch,
              updatedAt: nowIso(),
            };

            if (invalidatesOutput && cell.lastRun) {
              next.status = "stale";
              next.staleReason = `${cell.alias} changed after its last successful run.`;
            } else if (
              invalidatesOutput &&
              (cell.status === "parse_error" || cell.status === "reference_error" || cell.status === "config_error")
            ) {
              next.status = "not_run";
              next.staleReason = undefined;
            }

            return normalizeCell(next);
          });

          const changed = cells.find((cell) => cell.id === cellId);
          if (!changed || isTextCell(changed)) return { ...notebook, cells, updatedAt: nowIso() };

          let nextNotebook = invalidatesOutput && changed
            ? markDownstreamStale({ ...notebook, cells }, changed.alias)
            : { ...notebook, cells };

          return { ...nextNotebook, updatedAt: nowIso() };
        }, cellId),
      ),
    );
  }

  function duplicateCell(cellId: string) {
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => {
          const source = notebook.cells.find((cell) => cell.id === cellId);
          if (!source) return notebook;

          const nextAliasCounter = isTextCell(source) ? notebook.cellAliasCounter : notebook.cellAliasCounter + 1;
          const duplicateId = createId(isTextCell(source) ? "note" : "cell");
          const duplicate: NotebookCell = {
            ...source,
            id: duplicateId,
            alias: isTextCell(source) ? "" : `c${nextAliasCounter}`,
            title: isTextCell(source) ? source.title : `${source.title} copy`,
            output: "",
            status: "not_run",
            viewMode: "expanded",
            vars: {},
            attachments: isTextCell(source)
              ? []
              : (source.attachments ?? []).map((attachment) => ({
                  ...attachment,
                  id: createId("attachment"),
                  cellId: duplicateId,
                  createdAt: nowIso(),
                })),
            artifacts: [],
            decision: undefined,
            staleReason: undefined,
            lastRun: undefined,
            runHistory: [],
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };

          const sourceIndex = notebook.cells.findIndex((cell) => cell.id === cellId);
          const cells = [...notebook.cells];
          cells.splice(sourceIndex + 1, 0, duplicate);

          return {
            ...notebook,
            cellAliasCounter: nextAliasCounter,
            cells,
            updatedAt: nowIso(),
          };
        }, cellId),
      ),
    );
  }

  async function attachFilesToCell(cellId: string, files: File[] | FileList) {
    const current = workspaceRef.current;
    const notebook = getActiveNotebook(current);
    const source = notebook?.cells.find((cell) => cell.id === cellId);
    if (!source || isTextCell(source)) return;

    const { attachments, rejected } = await filesToAttachments(files, cellId, source.attachments ?? []);
    if (attachments.length) updateCell(cellId, { attachments: [...(source.attachments ?? []), ...attachments] });
    if (rejected.length) {
      window.alert(
        `Some files were not attached:\n${rejected.map((item) => `- ${item.name}: ${item.reason}`).join("\n")}`,
      );
    }
  }

  function removeCellAttachment(cellId: string, attachmentId: string) {
    const notebook = activeNotebook;
    const source = notebook?.cells.find((cell) => cell.id === cellId);
    if (!source || isTextCell(source)) return;
    updateCell(cellId, { attachments: (source.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }

  function deleteCell(cellId: string) {
    const notebook = activeNotebook;
    const cell = notebook?.cells.find((candidate) => candidate.id === cellId);
    if (!notebook || !cell) return;

    const referencedBy = isTextCell(cell) ? [] : findDependents(notebook, cell.alias)
      .map((alias) => notebook.cells.find((candidate) => candidate.alias === alias)?.alias)
      .filter(Boolean);

    if (referencedBy.length) {
      const shouldDelete = window.confirm(
        `Cell ${cell.alias} is referenced by ${referencedBy.join(", ")}. Deleting it will break references.`,
      );

      if (!shouldDelete) return;
    }

    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
      updateActiveNotebook(historyWorkspace, (currentNotebook) => {
        const cells = currentNotebook.cells.filter((candidate) => candidate.id !== cellId);

        return {
          ...currentNotebook,
          cells,
          updatedAt: nowIso(),
        };
      }, cellId),
      ),
    );
  }

  function moveCell(cellId: string, direction: "up" | "down") {
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
      updateActiveNotebook(historyWorkspace, (notebook) => {
        const index = notebook.cells.findIndex((cell) => cell.id === cellId);
        const targetIndex = direction === "up" ? index - 1 : index + 1;

        if (index < 0 || targetIndex < 0 || targetIndex >= notebook.cells.length) return notebook;

        const cells = [...notebook.cells];
        const [cell] = cells.splice(index, 1);
        cells.splice(targetIndex, 0, cell);

        return { ...notebook, cells, updatedAt: nowIso() };
      }, cellId),
      ),
    );
  }

  function runCell(cellId: string) {
    const current = workspaceRef.current;
    const notebook = getActiveNotebook(current);
    const cell = notebook?.cells.find((candidate) => candidate.id === cellId);
    if (!notebook || !cell || isTextCell(cell) || runningCellIds.has(cellId)) return;

    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, parseOptions(notebook, current));

    const parseErrors = parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error");
    if (parseErrors.length) {
      updateCellStatus(cellId, parseErrors.every(isReferenceDiagnostic) ? "reference_error" : "parse_error");
      return;
    }

    setRunningCellIds((ids) => new Set(ids).add(cellId));
    updateCellStatus(cellId, "running");

    const controller = new AbortController();
    runAbortRef.current[cellId] = controller;
    void executeWorkspaceCell(cellId, controller);
  }

  async function executeWorkspaceCell(cellId: string, controller: AbortController) {
    const latestWorkspace = workspaceRef.current;
    const currentNotebook = getActiveNotebook(latestWorkspace);
    const currentCell = currentNotebook?.cells.find((candidate) => candidate.id === cellId);

    if (!currentNotebook || !currentCell || isTextCell(currentCell)) {
      finishRunningCell(cellId);
      delete runAbortRef.current[cellId];
      return;
    }

    const parsedForRun = parseCellDsl(
      currentCell.controlHeader,
      currentCell.promptBody,
      parseOptions(currentNotebook, latestWorkspace),
    );
    const runContext = resolveRunContext(currentCell, parsedForRun, currentNotebook, latestWorkspace);
    const result = await executeCellRun(currentCell, parsedForRun, latestWorkspace.settings, runContext, {
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      finishRunningCell(cellId);
      delete runAbortRef.current[cellId];
      return;
    }

    let autorunTargetId: string | undefined;

    setWorkspace((workspaceForResult) => {
      const notebookForResult = getActiveNotebook(workspaceForResult);
      const cellForResult = notebookForResult?.cells.find((candidate) => candidate.id === cellId);
      if (!notebookForResult || !cellForResult || isTextCell(cellForResult)) return workspaceForResult;

      const parsedForResult = parseCellDsl(
        cellForResult.controlHeader,
        cellForResult.promptBody,
        parseOptions(notebookForResult, workspaceForResult),
      );
      const nextNotebook = applyRunResult(notebookForResult, cellForResult.id, parsedForResult, result);
      autorunTargetId = result.status === "completed" ? findAutorunTargetId(nextNotebook, parsedForResult) : undefined;

      return replaceActiveNotebook(workspaceForResult, nextNotebook);
    });

    finishRunningCell(cellId);
    delete runAbortRef.current[cellId];

    if (autorunTargetId) {
      const targetId = autorunTargetId;
      window.setTimeout(() => runCell(targetId), 0);
    }
  }

  function finishRunningCell(cellId: string) {
    setRunningCellIds((ids) => {
      const next = new Set(ids);
      next.delete(cellId);
      return next;
    });
  }

  function runFromHere(cellId: string) {
    runCell(cellId);
  }

  function stopCell(cellId: string) {
    const timer = runTimersRef.current[cellId];
    if (timer) {
      window.clearTimeout(timer);
      delete runTimersRef.current[cellId];
    }
    runAbortRef.current[cellId]?.abort();
    delete runAbortRef.current[cellId];

    finishRunningCell(cellId);
    updateCellStatus(cellId, "cancelled");
  }

  function stopAllRuns() {
    Object.values(runTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    runTimersRef.current = {};
    Object.values(runAbortRef.current).forEach((controller) => controller.abort());
    runAbortRef.current = {};
    setRunningCellIds(new Set());
    setWorkspace((current) =>
      updateActiveNotebook(current, (notebook) => ({
        ...notebook,
        cells: notebook.cells.map((cell) =>
          isIntentCell(cell) && cell.status === "running" ? normalizeCell({ ...cell, status: "cancelled", updatedAt: nowIso() }) : cell,
        ),
      }), current.selectedCellId ?? ""),
    );
  }

  function updateCellStatus(cellId: string, status: CellStatus) {
    setWorkspace((current) =>
      updateActiveNotebook(current, (notebook) => ({
        ...notebook,
        cells: notebook.cells.map((cell) =>
          cell.id === cellId && isIntentCell(cell) ? normalizeCell({ ...cell, status, updatedAt: nowIso() }) : cell,
        ),
        updatedAt: nowIso(),
      }), cellId),
    );
  }

  function useArtifactInSelectedCell(artifact: Artifact, target: "header" | "prompt") {
    const selected = selectedCell;
    if (!selected || isTextCell(selected)) return;

    const promptReference = `%file.${artifact.cellAlias}:${artifact.displayName}`;

    if (target === "header") {
      updateCell(selected.id, {
        promptBody: `${selected.promptBody.trimEnd()}\n\n${promptReference}`.trim(),
      });
      return;
    }

    updateCell(selected.id, {
      promptBody: `${selected.promptBody.trimEnd()}\n\n${promptReference}`.trim(),
    });
  }

  function renameNotebook(title: string) {
    const nextTitle = title.trim() || "Untitled Notebook";
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => ({
          ...notebook,
          title: nextTitle,
          updatedAt: nowIso(),
        }), historyWorkspace.selectedCellId ?? ""),
      ),
    );
  }

  function duplicateNotebook() {
    const currentNotebook = activeNotebook;
    if (!currentNotebook) return;

    const duplicate = cloneNotebook(currentNotebook);
    duplicate.id = createId("notebook");
    duplicate.title = `${currentNotebook.title} copy`;
    duplicate.createdAt = nowIso();
    duplicate.updatedAt = nowIso();
    duplicate.lastSavedAt = undefined;
    duplicate.snapshots = [];
    duplicate.cells = duplicate.cells.map((cell) => {
      const cellId = createId(isTextCell(cell) ? "note" : "cell");
      return {
        ...cell,
        id: cellId,
        attachments: isTextCell(cell)
          ? []
          : cell.attachments.map((attachment) => ({
              ...attachment,
              id: createId("attachment"),
              cellId,
              createdAt: nowIso(),
            })),
      };
    });

    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === current.activeProjectId
          ? { ...project, notebooks: [...project.notebooks, duplicate], updatedAt: nowIso() }
          : project,
      ),
      activeNotebookId: duplicate.id,
      selectedCellId: duplicate.cells[0]?.id,
    }));
  }

  function deleteNotebook(notebookId = activeNotebook?.id, options: { confirm?: boolean } = {}) {
    const currentWorkspace = workspaceRef.current;
    const project = currentWorkspace.projects.find((candidate) =>
      candidate.notebooks.some((notebook) => notebook.id === notebookId),
    );
    const notebook = project?.notebooks.find((candidate) => candidate.id === notebookId);
    if (!project || !notebook) return;
    if (options.confirm !== false) {
      const confirmed = window.confirm(
        `Delete notebook "${notebook.title}"? This action can be undone only if a snapshot or export exists.`,
      );
      if (!confirmed) return;
    }

    setWorkspace((current) => {
      const sourceProject = current.projects.find((candidate) => candidate.id === project.id);
      if (!sourceProject) return current;

      const remaining = sourceProject.notebooks.filter((candidate) => candidate.id !== notebook.id);
      const fallback = remaining[0] ?? createNotebook("Untitled Notebook");
      const nextActiveProjectId = current.activeProjectId === sourceProject.id ? sourceProject.id : current.activeProjectId;
      const shouldSwitchNotebook =
        current.activeNotebookId === notebook.id ||
        (current.activeProjectId === sourceProject.id && !remaining.some((candidate) => candidate.id === current.activeNotebookId));

      return {
        ...current,
        projects: current.projects.map((candidate) =>
          candidate.id === sourceProject.id
            ? { ...candidate, notebooks: remaining.length ? remaining : [fallback], updatedAt: nowIso() }
            : candidate,
        ),
        activeProjectId: nextActiveProjectId,
        activeNotebookId: shouldSwitchNotebook ? fallback.id : current.activeNotebookId,
        selectedCellId: shouldSwitchNotebook ? fallback.cells[0]?.id : current.selectedCellId,
      };
    });
  }

  function manualSave() {
    try {
      const savedAt = nowIso();
      const active = getActiveNotebook(workspaceRef.current);
      if (!active) return;
      const nextWorkspace = replaceActiveNotebook(
        workspaceRef.current,
        { ...active, lastSavedAt: savedAt, updatedAt: nowIso() },
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWorkspace));
      setWorkspace(nextWorkspace);
      setLastSavedAt(savedAt);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  }

  function undo() {
    setWorkspace((current) => {
      const currentNotebook = getActiveNotebook(current);
      const previous = undoStackRef.current.pop();
      if (!currentNotebook || !previous) return current;
      redoStackRef.current.push(cloneNotebook(currentNotebook));
      return replaceActiveNotebook(current, cloneNotebook(previous), previous.cells[0]?.id ?? current.selectedCellId);
    });
  }

  function redo() {
    setWorkspace((current) => {
      const currentNotebook = getActiveNotebook(current);
      const next = redoStackRef.current.pop();
      if (!currentNotebook || !next) return current;
      undoStackRef.current.push(cloneNotebook(currentNotebook));
      return replaceActiveNotebook(current, cloneNotebook(next), next.cells[0]?.id ?? current.selectedCellId);
    });
  }

  function clearCellOutput(cellId = selectedCell?.id) {
    if (!cellId) return;
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => {
          let clearedAlias: string | undefined;
          const timestamp = nowIso();
          const cells = notebook.cells.map((cell) => {
            if (cell.id !== cellId || !isIntentCell(cell)) return cell;
            clearedAlias = cell.alias;
            return normalizeCell(clearVisibleCellOutput(cell, timestamp));
          });
          const nextNotebook = {
            ...notebook,
            cells,
            updatedAt: timestamp,
          };

          return clearedAlias ? markDownstreamStale(nextNotebook, clearedAlias) : nextNotebook;
        }, cellId),
      ),
    );
  }

  function clearAllOutputs() {
    if (!window.confirm("Clear visible outputs for all cells? Run history and artifacts remain available.")) return;
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => ({
          ...notebook,
          cells: notebook.cells.map((cell) =>
            isIntentCell(cell) ? normalizeCell(clearVisibleCellOutput(cell, nowIso())) : cell,
          ),
          updatedAt: nowIso(),
        }), historyWorkspace.selectedCellId ?? ""),
      ),
    );
  }

  function setNotebookViewMode(mode: CellViewMode) {
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => ({
          ...notebook,
          viewState: { ...notebook.viewState, mode },
          cells: notebook.cells.map((cell) => (isIntentCell(cell) ? { ...cell, viewMode: mode } : cell)),
          updatedAt: nowIso(),
        }), historyWorkspace.selectedCellId ?? ""),
      ),
    );
  }

  function setNotebookDslChannel(channel: NotebookDslChannel) {
    setWorkspace((current) =>
      withHistory(current, (historyWorkspace) =>
        updateActiveNotebook(historyWorkspace, (notebook) => ({
          ...notebook,
          metadata: {
            ...notebook.metadata,
            dsl_channel: channel,
          },
          updatedAt: nowIso(),
        }), historyWorkspace.selectedCellId ?? ""),
      ),
    );
  }

  function saveSnapshot() {
    const notebook = activeNotebook;
    if (!notebook) return;
    const defaultName = `Snapshot ${new Date().toLocaleString()}`;
    const name = window.prompt("Snapshot name:", defaultName)?.trim() || defaultName;
    const note = window.prompt("Optional note:", "")?.trim();
    const snapshot: NotebookSnapshot = {
      id: createId("snap"),
      notebookId: notebook.id,
      name,
      note: note || undefined,
      state: cloneNotebook(notebook),
      createdAt: nowIso(),
    };

    setWorkspace((current) =>
      updateActiveNotebook(current, (currentNotebook) => ({
        ...currentNotebook,
        snapshots: [snapshot, ...currentNotebook.snapshots],
        updatedAt: nowIso(),
      }), current.selectedCellId ?? ""),
    );
  }

  function restoreSnapshot(snapshotId: string) {
    const notebook = activeNotebook;
    const snapshot = notebook?.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!notebook || !snapshot) return;
    if (!window.confirm(`Restore snapshot "${snapshot.name}"? Current state will be auto-snapshotted first.`)) return;

    const autoSnapshot: NotebookSnapshot = {
      id: createId("snap"),
      notebookId: notebook.id,
      name: `Before restore ${new Date().toLocaleString()}`,
      state: cloneNotebook(notebook),
      createdAt: nowIso(),
    };
    const restored = cloneNotebook(snapshot.state);
    restored.snapshots = [autoSnapshot, ...notebook.snapshots];
    restored.updatedAt = nowIso();

    setWorkspace((current) => replaceActiveNotebook(current, restored, restored.cells[0]?.id ?? current.selectedCellId));
  }

  function exportNotebook(format: "json" | "md" | "zip") {
    const project = activeProject;
    const notebook = activeNotebook;
    if (!project || !notebook) return;

    if (format === "json") {
      const payload = buildNotebookExport(project, notebook, workspace.settings);
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), safeFilename(notebook.title, ".iccgo.json"));
      return;
    }

    if (format === "md") {
      downloadBlob(new Blob([buildNotebookMarkdown(project, notebook)], { type: "text/markdown" }), safeFilename(notebook.title, ".md"));
      return;
    }

    downloadBlob(buildNotebookZip(project, notebook, workspace.settings), safeFilename(notebook.title, ".zip"));
  }

  function downloadAllArtifacts() {
    exportNotebook("zip");
  }

  async function copyCurrentCellMarkdown() {
    const cell = selectedCell;
    if (!cell) return;
    await navigator.clipboard?.writeText(cellToMarkdown(cell).join("\n"));
  }

  async function copyNotebookMarkdown() {
    const project = activeProject;
    const notebook = activeNotebook;
    if (!project || !notebook) return;
    await navigator.clipboard?.writeText(buildNotebookMarkdown(project, notebook));
  }

  async function importNotebookFile(file: File) {
    let payload: {
      format?: string;
      notebook?: { name?: string };
      cells?: Array<Record<string, unknown>>;
      dsl_version?: string;
    };
    try {
      const text = await file.text();
      payload = JSON.parse(text) as typeof payload;
    } catch {
      window.alert("Import failed: the file is not valid JSON.");
      return;
    }

    if (payload.format !== "iccgo.notebook" || !payload.cells) {
      window.alert("Import failed: unsupported ICC-GO notebook format.");
      return;
    }

    const timestamp = nowIso();
    let intentCount = 0;
    const cells = payload.cells.map((raw) => {
      if (raw.type === "text") {
        return normalizeCell({
          ...createTextCell(createId("note"), timestamp),
          noteBody: String(raw.markdown ?? raw.note ?? ""),
        });
      }

      intentCount += 1;
      const cellId = createId("cell");
      return normalizeCell({
        ...createBlankCell(cellId, `c${intentCount}`, timestamp),
        title: String(raw.title ?? `Cell ${intentCount}`),
        controlHeader: String(raw.control_header ?? ""),
        promptBody: String(raw.prompt ?? ""),
        output: typeof raw.output === "object" && raw.output && "text" in raw.output ? String((raw.output as { text?: unknown }).text ?? "") : "",
        attachments: normalizeImportedAttachments(raw, cellId),
      });
    });

    const metadata = createNotebookMetadata(timestamp);
    if (payload.dsl_version && payload.dsl_version !== metadata.dsl_version) {
      metadata.migrated_from = [String(payload.dsl_version)];
    }

    const notebook: Notebook = {
      id: createId("notebook"),
      title: payload.notebook?.name ? `${payload.notebook.name} import` : "Imported Notebook",
      description: "Imported from .iccgo.json",
      metadata,
      cellAliasCounter: intentCount,
      cells,
      snapshots: [],
      viewState: defaultViewState(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === current.activeProjectId
          ? { ...project, notebooks: [...project.notebooks, notebook], updatedAt: nowIso() }
          : project,
      ),
      activeNotebookId: notebook.id,
      selectedCellId: notebook.cells[0]?.id,
    }));
    window.alert(`Imported notebook with ${cells.length} cells.`);
  }

  function validateNotebook(showDialog = true) {
    const notebook = activeNotebook;
    if (!notebook) return { errors: [] as string[], warnings: [] as string[] };
    const errors: string[] = [];
    const warnings: string[] = [];

    notebook.cells.filter(isIntentCell).forEach((cell) => {
      const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, parseOptions(notebook, workspace));
      parsed.diagnostics.forEach((diagnostic) => {
        const target = diagnostic.level === "error" ? errors : warnings;
        target.push(`${cell.alias}: ${diagnostic.message}`);
      });
      if (!cell.controlHeader.includes("< cost") && !cell.controlHeader.includes("< $")) {
        warnings.push(`${cell.alias}: cost limit not specified`);
      }
      if (cell.status === "stale") {
        warnings.push(`${cell.alias}: ${cell.staleReason ?? "result is stale"}`);
      }
    });

    if (showDialog) {
      window.alert(
        [
          "Notebook validation",
          "",
          errors.length ? `Errors:\n- ${errors.join("\n- ")}` : "Errors: none",
          "",
          warnings.length ? `Warnings:\n- ${warnings.join("\n- ")}` : "Warnings: none",
        ].join("\n"),
      );
    }

    return { errors, warnings };
  }

  function findOrGoToCell(query?: string) {
    const notebook = activeNotebook;
    const rawQuery = query ?? window.prompt("Find or go to cell:", selectedCell?.alias ?? "") ?? "";
    const normalized = rawQuery.trim().toLowerCase();
    if (!notebook || !normalized) return;

    const match = notebook.cells.find((cell) => {
      const haystack = [
        isTextCell(cell) ? "text note" : cell.alias,
        cell.title,
        cell.noteBody ?? "",
        cell.controlHeader,
        cell.promptBody,
        cell.output,
        JSON.stringify(cell.vars),
        cell.staleReason ?? "",
        cell.attachments.map((attachment) => attachment.displayName).join(" "),
        cell.artifacts.map((artifact) => artifact.displayName).join(" "),
      ].join("\n").toLowerCase();
      return haystack.includes(normalized);
    });

    if (!match) {
      window.alert(`No match for "${rawQuery}".`);
      return;
    }

    selectCell(match.id);
    window.setTimeout(() => {
      document.getElementById(`cell-${match.alias}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 20);
  }

  function runAll() {
    activeNotebook?.cells.filter(isIntentCell).forEach((cell, index) => window.setTimeout(() => runCell(cell.id), index * 120));
  }

  function runStaleCells() {
    activeNotebook?.cells
      .filter((cell) => isIntentCell(cell) && cell.status === "stale")
      .forEach((cell, index) => window.setTimeout(() => runCell(cell.id), index * 120));
  }

  function estimateCost() {
    const notebook = activeNotebook;
    if (!notebook) return;
    const estimated = notebook.cells
      .filter(isIntentCell)
      .reduce((sum, cell) => sum + (cell.controlHeader.length + cell.promptBody.length) / 1000 * 0.012, 0);
    window.alert(`Approximate notebook run cost: $${estimated.toFixed(4)}`);
  }

  function updateProvider(providerId: string, patch: Partial<ProviderSettings>) {
    setWorkspace((current) => ({
      ...current,
      settings: {
        ...current.settings,
        providers: current.settings.providers.map((provider) =>
          provider.id === providerId ? normalizeProviderSettings({ ...provider, ...patch }) : provider,
        ),
      },
    }));
  }

  function addProvider(provider: ProviderKind) {
    setWorkspace((current) => {
      const sameKindCount = current.settings.providers.filter((candidate) => candidate.provider === provider).length;

      return {
        ...current,
        settings: {
          ...current.settings,
          providers: [...current.settings.providers, createProviderSettings(provider, sameKindCount + 1)],
        },
      };
    });
  }

  function deleteProvider(providerId: string) {
    deleteProviderSecret(providerId);
    setWorkspace((current) => {
      const remaining = current.settings.providers.filter((provider) => provider.id !== providerId);
      const providers = remaining.length ? remaining : [createProviderSettings("openai")];

      return {
        ...current,
        settings: {
          ...current.settings,
          providers,
        },
      };
    });
  }

  function moveProvider(providerId: string, direction: "up" | "down") {
    setWorkspace((current) => {
      const providers = [...current.settings.providers];
      const index = providers.findIndex((provider) => provider.id === providerId);
      const nextIndex = direction === "up" ? index - 1 : index + 1;

      if (index < 0 || nextIndex < 0 || nextIndex >= providers.length) return current;

      [providers[index], providers[nextIndex]] = [providers[nextIndex], providers[index]];

      return {
        ...current,
        settings: {
          ...current.settings,
          providers,
        },
      };
    });
  }

  function updateOrchestration(patch: Partial<OrchestrationSettings>) {
    setWorkspace((current) => ({
      ...current,
      settings: {
        ...current.settings,
        orchestration: {
          ...current.settings.orchestration,
          ...patch,
        },
      },
    }));
  }

  function resetWorkspace() {
    const next = createInitialWorkspace();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setWorkspace(next);
  }

  return {
    workspace,
    activeProject,
    activeNotebook,
    selectedCell,
    knownAliases,
    allArtifacts,
    runningCellIds,
    saveStatus,
    lastSavedAt,
    canUndo,
    canRedo,
    setWorkspace,
    setActiveProject,
    setActiveNotebook,
    selectCell,
    createProject,
    deleteProject,
    createNotebookInActiveProject,
    addCell,
    addTextCell,
    updateCell,
    duplicateCell,
    deleteCell,
    moveCell,
    runCell,
    runFromHere,
    runAll,
    runStaleCells,
    stopCell,
    stopAllRuns,
    attachFilesToCell,
    removeCellAttachment,
    useArtifactInSelectedCell,
    renameNotebook,
    duplicateNotebook,
    deleteNotebook,
    manualSave,
    undo,
    redo,
    clearCellOutput,
    clearAllOutputs,
    setNotebookViewMode,
    setNotebookDslChannel,
    saveSnapshot,
    restoreSnapshot,
    exportNotebook,
    downloadAllArtifacts,
    copyCurrentCellMarkdown,
    copyNotebookMarkdown,
    importNotebookFile,
    validateNotebook,
    findOrGoToCell,
    estimateCost,
    updateProvider,
    addProvider,
    deleteProvider,
    moveProvider,
    updateOrchestration,
    resetWorkspace,
  };
}

function loadWorkspace(): WorkspaceState {
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) return createInitialWorkspace();

  try {
    const parsed = JSON.parse(stored) as WorkspaceState;
    return normalizeWorkspace(parsed);
  } catch {
    return createInitialWorkspace();
  }
}

function shouldRefreshProviderModels(provider: ProviderSettings): boolean {
  if (!provider.enabled) return false;
  if (provider.provider === "local" || provider.provider === "custom") return false;

  const updatedAt = provider.modelCatalogUpdatedAt ? Date.parse(provider.modelCatalogUpdatedAt) : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;

  return Date.now() - updatedAt > MODEL_CATALOG_REFRESH_MS + MODEL_CATALOG_RETRY_MS;
}

function createNotebook(title: string): Notebook {
  const timestamp = nowIso();
  const cell = createBlankCell(createId("cell"), "c1", timestamp);

  return {
    id: createId("notebook"),
    title,
    description: "",
    metadata: createNotebookMetadata(timestamp),
    cellAliasCounter: 1,
    cells: [cell],
    snapshots: [],
    viewState: defaultViewState(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createBlankCell(id: string, alias: string, timestamp: string): NotebookCell {
  return {
    id,
    kind: "intent",
    alias,
    title: "Untitled cell",
    controlHeader: "> openai",
    promptBody: "",
    output: "",
    status: "not_run",
    viewMode: "expanded",
    collapsedPrompt: false,
    collapsedOutput: false,
    vars: {},
    attachments: [],
    artifacts: [],
    runHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createTextCell(id: string, timestamp: string): NotebookCell {
  return {
    ...createBlankCell(id, "", timestamp),
    kind: "text",
    title: "Text",
    noteBody: "",
    controlHeader: "",
    promptBody: "",
  };
}

function getActiveNotebook(workspace: WorkspaceState): Notebook | undefined {
  const project = workspace.projects.find((candidate) => candidate.id === workspace.activeProjectId);
  return project?.notebooks.find((candidate) => candidate.id === workspace.activeNotebookId);
}

function parseOptions(notebook: Notebook, workspace: WorkspaceState) {
  const intentCells = notebook.cells.filter(isIntentCell);

  return {
    knownAliases: intentCells.map((candidate) => candidate.alias),
    providerAliases: providerAliasOptions(workspace.settings),
    defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
    maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    cells: intentCells,
  };
}

function updateActiveNotebook(
  workspace: WorkspaceState,
  updater: (notebook: Notebook) => Notebook,
  selectedCellId: string,
): WorkspaceState {
  return replaceActiveNotebook(workspace, updater(getActiveNotebook(workspace)!), selectedCellId);
}

function replaceActiveNotebook(
  workspace: WorkspaceState,
  notebook: Notebook,
  selectedCellId = workspace.selectedCellId,
): WorkspaceState {
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === workspace.activeProjectId
        ? {
            ...project,
            notebooks: project.notebooks.map((candidate) =>
              candidate.id === workspace.activeNotebookId ? notebook : candidate,
            ),
            updatedAt: nowIso(),
          }
        : project,
    ),
    selectedCellId,
  };
}

function applyRunResult(
  notebook: Notebook,
  cellId: string,
  parsed: ReturnType<typeof parseCellDsl>,
  simulated: CellRunResult,
): Notebook {
  const cells = notebook.cells.map((cell) => {
    if (cell.id === cellId) {
      return normalizeCell({
        ...cell,
        status: simulated.status,
        output: simulated.output,
        vars: simulated.vars,
        artifacts: [...cell.artifacts, ...simulated.artifacts],
        decision: simulated.decision,
        staleReason: undefined,
        lastRun: simulated.run,
        runHistory: [simulated.run, ...cell.runHistory].slice(0, 20),
        updatedAt: nowIso(),
      });
    }

    if (isIntentCell(cell) && simulated.decision?.skippedTargets.includes(cell.alias)) {
      return normalizeCell({
        ...cell,
        status: "skipped",
        staleReason: `Skipped by ${notebook.cells.find((candidate) => candidate.id === cellId)?.alias}.`,
        updatedAt: nowIso(),
      });
    }

    return cell;
  });

  const resultNotebook = { ...notebook, cells, updatedAt: nowIso() };
  return parsed.flow.type === "forward"
    ? (parsed.flow.targets ?? [parsed.flow.target]).reduce(
        (currentNotebook, targetAlias) => markTargetReady(currentNotebook, targetAlias),
        resultNotebook,
      )
    : resultNotebook;
}

function markTargetReady(notebook: Notebook, targetAlias: string): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) =>
      isIntentCell(cell) && cell.alias === targetAlias && cell.status === "skipped"
        ? { ...cell, status: "not_run", staleReason: undefined }
        : cell,
    ),
  };
}

function findAutorunTargetId(notebook: Notebook, parsed: ReturnType<typeof parseCellDsl>): string | undefined {
  const flow = parsed.flow;
  if (flow.type === "forward") {
    return notebook.cells.find((cell) => isIntentCell(cell) && cell.alias === flow.target)?.id;
  }

  return undefined;
}

function resolveRunContext(
  cell: NotebookCell,
  parsed: ParsedDsl,
  notebook: Notebook,
  workspace: WorkspaceState,
): RunContext {
  const errors: Diagnostic[] = [];
  let resolvedPromptBody = cell.promptBody;
  const resolvedLabels: string[] = [];

  parsed.references.forEach((reference) => {
    const resolution = resolveReference(reference, cell, notebook, workspace);
    if (resolution.error) {
      errors.push({ level: "error", message: `Reference error: ${resolution.error}` });
      return;
    }

    if (resolution.label) resolvedLabels.push(resolution.label);
    if (resolution.value !== undefined) {
      resolvedPromptBody = resolvedPromptBody.replaceAll(reference.raw, resolution.value);
    }
  });

  resolvedPromptBody = resolvedPromptBody.replaceAll("%%", "%");
  const attachedContext = attachmentContext(cell.attachments ?? []);
  if (attachedContext) {
    resolvedPromptBody = `${resolvedPromptBody.trimEnd()}\n\nAttached files:\n${attachedContext}`.trim();
    resolvedLabels.push(`${cell.attachments.length} attached file${cell.attachments.length === 1 ? "" : "s"}`);
  }

  return {
    resolvedPromptBody,
    inputResolved: resolvedLabels.join(", "),
    referenceErrors: errors,
  };
}

function resolveReference(
  reference: ParsedDsl["references"][number],
  cell: NotebookCell,
  notebook: Notebook,
  workspace: WorkspaceState,
): { value?: string; label?: string; error?: string } {
  if (reference.kind === "input") {
    const source = findInputSource(cell.alias, notebook, workspace);
    if (!source?.lastRun || source.lastRun.status !== "completed" || !source.lastRun.textOutputRaw.trim()) {
      return { error: `%input has no successful forwarded source for ${cell.alias}.` };
    }
    return {
      value: sanitizeReferencedOutput(source.lastRun.textOutputRaw, source.alias),
      label: `%input from ${source.alias}`,
    };
  }

  const alias = reference.alias;
  if (!alias) return { error: `${reference.raw} has no source cell.` };
  const source = notebook.cells.find((candidate) => isIntentCell(candidate) && candidate.alias === alias);
  if (!source) return { error: `cell \`${alias}\` not found.` };

  if (reference.kind === "prompt") return { value: source.promptBody, label: reference.raw };
  if (reference.kind === "header") return { value: source.controlHeader, label: reference.raw };
  if (reference.kind === "error") {
    const path = reference.path ?? [];
    if (path.length) return resolveErrorPath(source, path, reference.raw);
    return {
      value: source.lastRun?.errors.map((error) => error.message).join("\n") || source.staleReason || "",
      label: reference.raw,
    };
  }
  if (reference.kind === "meta" || reference.field === "status") {
    return { value: resolveMetaReference(source, reference.metaKey ?? reference.field), label: reference.raw };
  }

  if (!source.lastRun && ["from", "output", "var", "field"].includes(reference.kind)) {
    return { error: `${reference.raw} points to ${alias}, but ${alias} has no completed run.` };
  }

  if (reference.kind === "from") {
    if (!source.lastRun || source.lastRun.status !== "completed" || !source.lastRun.textOutputRaw.trim()) {
      return { error: `Cannot resolve ${reference.raw}: source cell has no successful output.` };
    }

    const sourceOutput = sanitizeReferencedOutput(source.lastRun.textOutputRaw, alias);
    const path = reference.path ?? [];
    if (!path.length) return { value: sourceOutput, label: reference.raw };

    const field = resolveOutputField(sourceOutput, path);
    if (field === undefined) {
      return { error: `Cannot resolve ${reference.raw}: field ${path.join(".")} was not found in ${alias} output.` };
    }

    return { value: stringifyReferenceValue(field), label: reference.raw };
  }

  if (reference.kind === "output" || reference.field === "output") {
    const sourceOutput = source.lastRun ? sanitizeReferencedOutput(source.lastRun.textOutputRaw, alias) : source.output;
    if (!sourceOutput.trim()) {
      return { error: `Cannot resolve ${reference.raw}: source cell has no successful output.` };
    }
    return { value: sourceOutput, label: reference.raw };
  }
  if (reference.kind === "var") {
    const variable = reference.variable ?? "";
    const value = source.vars[variable];
    if (value === undefined) return { error: `variable \`${variable}\` not found in ${alias}.` };
    return { value: String(value), label: reference.raw };
  }
  if (reference.kind === "file" || reference.kind === "artifact") {
    const artifact = resolveArtifactReference(source, reference.filename);
    if ("error" in artifact) return { error: artifact.error };
    return { value: artifact.content, label: reference.raw };
  }
  if (reference.kind === "files") {
    const artifacts = source.artifacts.filter((artifact) => artifact.status === "created");
    if (!artifacts.length) return { error: `${alias} has no created artifacts.` };
    return {
      value: artifacts.map((artifact) => `# ${artifact.displayName}\n${artifact.content}`).join("\n\n"),
      label: reference.raw,
    };
  }

  return { error: `unsupported reference ${reference.raw}.` };
}

function sanitizeReferencedOutput(output: string, alias: string): string {
  const trimmed = output.trimStart();
  if (!trimmed.startsWith("Simulated provider run.")) return output;

  if (trimmed.includes("\nResolved prompt preview:\n")) {
    return [
      `Compiled prompt for ${alias}.`,
      `Provider execution is pending; re-run ${alias} to refresh this simulated output.`,
    ].join("\n");
  }

  return trimmed.replace(/^Simulated provider run\.[\s\S]*?\n\n/, "").trimStart();
}

function resolveOutputField(output: string, path: string[]): unknown {
  const jsonValue = parseStructuredJson(output);
  if (jsonValue !== undefined) {
    const resolved = readPath(jsonValue, path);
    if (resolved !== undefined) return resolved;
  }

  const keyValue = parseLooseKeyValueObject(output);
  return readPath(keyValue, path);
}

function parseStructuredJson(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function parseLooseKeyValueObject(output: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("- ")) continue;

    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*(?:=|:)\s*(.+)$/);
    if (!match) continue;

    setPath(root, match[1].split(".").filter(Boolean), parseReferenceLiteral(match[2].trim()));
  }

  return root;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (!path.length) return;
  let current = target;

  path.slice(0, -1).forEach((segment) => {
    const existing = current[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  });

  current[path[path.length - 1]] = value;
}

function parseReferenceLiteral(value: string): unknown {
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value.replace(/^["']|["']$/g, "");
}

function stringifyReferenceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function resolveErrorPath(cell: NotebookCell, path: string[], raw: string): { value?: string; label?: string; error?: string } {
  const firstError = cell.lastRun?.errors[0];
  const errorObject = {
    message: firstError?.message ?? cell.staleReason ?? "",
    level: firstError?.level ?? "",
    line: firstError?.line ?? "",
    status: cell.status,
  };
  const resolved = readPath(errorObject, path);

  if (resolved === undefined || resolved === "") {
    return { error: `Cannot resolve ${raw}: field ${path.join(".")} was not found in ${cell.alias} error.` };
  }

  return { value: stringifyReferenceValue(resolved), label: raw };
}

function findInputSource(targetAlias: string, notebook: Notebook, workspace: WorkspaceState): NotebookCell | undefined {
  return [...notebook.cells]
    .reverse()
    .filter(isIntentCell)
    .find((candidate) => {
      if (!candidate.lastRun) return false;
      const parsed = parseCellDsl(candidate.controlHeader, candidate.promptBody, parseOptions(notebook, workspace));
      return parsed.flow.type === "forward" && (parsed.flow.targets ?? [parsed.flow.target]).includes(targetAlias);
    });
}

function resolveMetaReference(cell: NotebookCell, key?: string): string {
  const run = cell.lastRun;
  if (!key) return "";
  if (key === "status") return cell.status;
  if (!run) return "";
  if (key === "cost" || key === "cost_usd") return String(run.costUsd);
  if (key === "latency" || key === "latency_ms") return String(run.latencyMs);
  if (key === "tokens_in") return String(run.tokensIn);
  if (key === "tokens_out") return String(run.tokensOut);
  if (key === "run_id") return run.id;
  if (key === "created_at") return run.startedAt;
  if (key === "provider") return run.providerRuns[0]?.provider ?? "";
  if (key === "model") return run.providerRuns[0]?.model ?? "";
  return "";
}

function resolveArtifactReference(
  cell: NotebookCell,
  filename?: string,
): Artifact | { error: string } {
  const created = cell.artifacts.filter((artifact) => artifact.status === "created");
  if (filename) {
    return created.find((artifact) => artifact.displayName === filename) ?? {
      error: `artifact \`${filename}\` not found in ${cell.alias}.`,
    };
  }
  if (created.length === 1) return created[0];
  if (!created.length) return { error: `${cell.alias} has no created artifacts.` };
  return { error: `%file.${cell.alias} is ambiguous because ${cell.alias} has ${created.length} artifacts.` };
}

function isReferenceDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.message.startsWith("Reference error:");
}

function markDownstreamStale(notebook: Notebook, sourceAlias: string): Notebook {
  const staleAliases = new Set<string>();
  const queue = [sourceAlias];

  while (queue.length) {
    const alias = queue.shift()!;
    for (const dependentAlias of findDependents(notebook, alias)) {
      if (staleAliases.has(dependentAlias)) continue;
      staleAliases.add(dependentAlias);
      queue.push(dependentAlias);
    }
  }

  if (!staleAliases.size) return notebook;

  return {
    ...notebook,
    cells: notebook.cells.map((cell) =>
      isIntentCell(cell) && staleAliases.has(cell.alias) && cell.lastRun
        ? {
            ...cell,
            status: "stale",
            staleReason: `Upstream cell ${sourceAlias} changed after this result was generated.`,
            updatedAt: nowIso(),
          }
        : cell,
    ),
  };
}

function findDependents(notebook: Notebook, sourceAlias: string): string[] {
  const dependents = new Set<string>();
  const intentCells = notebook.cells.filter(isIntentCell);
  const source = intentCells.find((cell) => cell.alias === sourceAlias);

  if (source) {
    const fallback = createInitialWorkspace();
    const parsedSource = parseCellDsl(source.controlHeader, source.promptBody, {
      knownAliases: intentCells.map((cell) => cell.alias),
      providerAliases: providerAliasOptions(fallback.settings),
      defaultLoopIterations: fallback.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: fallback.settings.orchestration.maxLoopIterations,
      cells: intentCells,
    });

    if (parsedSource.flow.type === "forward") {
      (parsedSource.flow.targets ?? [parsedSource.flow.target]).forEach((target) => dependents.add(target));
    }
    if (parsedSource.flow.type === "chain") parsedSource.flow.nodes.forEach((alias) => alias !== sourceAlias && dependents.add(alias));
    if (parsedSource.flow.type === "if") {
      if (parsedSource.flow.target !== "stop" && parsedSource.flow.target !== "done") dependents.add(parsedSource.flow.target);
      if (parsedSource.flow.elseTarget && parsedSource.flow.elseTarget !== "stop" && parsedSource.flow.elseTarget !== "done") {
        dependents.add(parsedSource.flow.elseTarget);
      }
    }
  }

  intentCells.forEach((cell) => {
    if (cell.alias === sourceAlias) return;
    const fallback = createInitialWorkspace();
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: intentCells.map((candidate) => candidate.alias),
      providerAliases: providerAliasOptions(fallback.settings),
      defaultLoopIterations: fallback.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: fallback.settings.orchestration.maxLoopIterations,
      cells: intentCells,
    });
    if (parsed.dependencies.includes(sourceAlias) || parsed.outputs.uses.some((use) => use.alias === sourceAlias)) {
      dependents.add(cell.alias);
    }
  });

  return [...dependents];
}

function normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    settings: normalizeSettings(workspace.settings),
    projects: workspace.projects.map((project) => ({
      ...project,
      createdAt: project.createdAt ?? project.updatedAt ?? nowIso(),
      notebooks: project.notebooks.map(normalizeNotebook),
    })),
  };
}

function normalizeNotebook(notebook: Notebook): Notebook {
  const createdAt = notebook.createdAt ?? notebook.updatedAt ?? nowIso();

  return {
    ...notebook,
    metadata: normalizeNotebookMetadata(notebook.metadata, createdAt),
    snapshots: (notebook.snapshots ?? []).map((snapshot) => ({
      ...snapshot,
      state: {
        ...snapshot.state,
        metadata: normalizeNotebookMetadata(snapshot.state?.metadata, snapshot.state?.createdAt ?? snapshot.createdAt),
        snapshots: snapshot.state?.snapshots ?? [],
        viewState: snapshot.state?.viewState ?? defaultViewState(),
        createdAt: snapshot.state?.createdAt ?? snapshot.createdAt,
        updatedAt: snapshot.state?.updatedAt ?? snapshot.createdAt,
        cells: (snapshot.state?.cells ?? []).map(normalizeCell),
      },
    })),
    viewState: notebook.viewState ?? defaultViewState(),
    createdAt,
    cells: notebook.cells.map(normalizeCell),
  };
}

function normalizeSettings(settings: WorkspaceState["settings"] | undefined): WorkspaceState["settings"] {
  const fallback = createInitialWorkspace().settings;

  return {
    ...fallback,
    ...settings,
    orchestration: normalizeOrchestrationSettings({
      ...fallback.orchestration,
      ...settings?.orchestration,
    }),
    providers: (settings?.providers ?? fallback.providers).map(normalizeProviderSettings),
  };
}

function normalizeCell(cell: NotebookCell): NotebookCell {
  const migratedStatus = cell.status === ("idle" as CellStatus) ? "not_run" : cell.status;
  const kind = cell.kind ?? "intent";

  return {
    ...cell,
    kind,
    alias: kind === "text" ? "" : cell.alias,
    noteBody: cell.noteBody ?? "",
    status: migratedStatus,
    viewMode: cell.viewMode ?? "expanded",
    vars: cell.vars ?? {},
    attachments: (cell.attachments ?? []).map(normalizeAttachment),
    artifacts: cell.artifacts ?? [],
    runHistory: cell.runHistory ?? [],
    collapsedPrompt: cell.collapsedPrompt ?? false,
    collapsedOutput: cell.collapsedOutput ?? false,
  };
}

function normalizeImportedAttachments(rawCell: Record<string, unknown>, cellId: string): CellAttachment[] {
  const direct = Array.isArray(rawCell.attachments) ? rawCell.attachments : undefined;
  const input = rawCell.input && typeof rawCell.input === "object" ? rawCell.input as { attachments?: unknown } : undefined;
  const inputAttachments = Array.isArray(input?.attachments) ? input.attachments : undefined;

  return (direct ?? inputAttachments ?? [])
    .filter((attachment): attachment is Partial<CellAttachment> => Boolean(attachment) && typeof attachment === "object")
    .map((attachment) => normalizeAttachment({ ...attachment, cellId }));
}

function normalizeAttachment(attachment: Partial<CellAttachment>): CellAttachment {
  const displayName = String(attachment.displayName ?? "attachment.txt");
  const extension = String(attachment.extension ?? (displayName.match(/(\.[a-z0-9]+)$/i)?.[1] ?? ""));
  const encoding = attachment.encoding === "base64" ? "base64" : "text";

  return {
    id: String(attachment.id ?? createId("attachment")),
    cellId: String(attachment.cellId ?? ""),
    displayName,
    extension,
    mimeType: String(attachment.mimeType ?? (encoding === "text" ? "text/plain" : "application/octet-stream")),
    sizeBytes: Number(attachment.sizeBytes ?? String(attachment.content ?? "").length),
    content: String(attachment.content ?? ""),
    encoding,
    createdAt: String(attachment.createdAt ?? nowIso()),
  };
}

function defaultViewState(): Notebook["viewState"] {
  return {
    mode: "expanded",
    sidebarVisible: true,
    inspectorVisible: true,
    showArtifacts: true,
    showExecutionMetadata: false,
    showCellIds: true,
    showDslPreview: true,
  };
}

function cloneNotebook(notebook: Notebook): Notebook {
  return JSON.parse(JSON.stringify(notebook)) as Notebook;
}

function isIntentCell(cell: NotebookCell): boolean {
  return cell.kind !== "text";
}

function isTextCell(cell: NotebookCell): boolean {
  return cell.kind === "text";
}

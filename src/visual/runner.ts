import { executeCellRun } from "../domain/providerExecution";
import { createInitialWorkspace } from "../domain/fixtures";
import { providerAliasOptions } from "../domain/providerAliases";
import type { NotebookCell, ParsedVars, WorkspaceSettings } from "../domain/types";
import { parseCellDsl } from "../language/latest";
import { serializeStep } from "./icc";
import type { WorkflowDocument, WorkflowFile, WorkflowStep } from "./types";

export type StepRunStatus = "queued" | "running" | "completed" | "failed";

export interface VisualStepRun {
  alias: string;
  title: string;
  status: StepRunStatus;
  output: string;
  costUsd: number;
  latencyMs: number;
  artifacts: VisualRunArtifact[];
  error?: string;
}

export interface VisualRunArtifact {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
}

export interface VisualRunState {
  status: "idle" | "running" | "completed" | "budget_reached" | "iteration_reached" | "failed" | "stopped";
  currentAlias?: string;
  totalCostUsd: number;
  loopPasses: number;
  message: string;
  steps: Record<string, VisualStepRun>;
}

export interface WorkflowRunLimits {
  maxLoopPasses: number;
  maxBudgetUsd: number;
}

export async function generateWorkflowWithAI(request: string, signal: AbortSignal, configuredSettings?: WorkspaceSettings): Promise<string> {
  const settings = executionSettings(configuredSettings);
  const linkedProviderIds = readLinkedProviderIds();
  const builderProvider = settings.providers.find((provider) => provider.enabled && (linkedProviderIds.has(provider.id) || provider.provider === "local"));
  if (!builderProvider) throw new Error("Link a provider key in Settings before using the AI workflow builder.");
  const route = `${builderProvider.alias || builderProvider.label}.max`;
  const prompt = `Design an executable ICC-GO v1.04 workflow for this request:\n\n${request.trim()}\n\nReturn only valid ICC DSL, without Markdown fences or commentary. Requirements:\n- Use 3 to 6 cells named # c1, # c2, and so on.\n- Each cell must have a clear model route, a concrete prompt, and an output directive.\n- Include at least one useful feedback loop or conditional return.\n- Bound every loop with < iterations <= N.\n- Keep the workflow understandable to a non-technical user.\n- Use %from cN whenever a step consumes another step's result.`;
  const now = new Date().toISOString();
  const cell: NotebookCell = {
    id: crypto.randomUUID(), kind: "intent", alias: "c1", title: "Design workflow", controlHeader: `> ${route}\n@text <7000`, promptBody: prompt,
    output: "", status: "not_run", viewMode: "expanded", collapsedPrompt: false, collapsedOutput: false,
    vars: {}, attachments: [], artifacts: [], runHistory: [], createdAt: now, updatedAt: now,
  };
  const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
    knownAliases: ["c1"], providerAliases: providerAliasOptions(settings),
    defaultLoopIterations: 3, maxLoopIterations: 20, cells: [cell],
  });
  const result = await executeCellRun(cell, parsed, settings, {}, { signal });
  if (signal.aborted) throw new Error("Workflow generation stopped.");
  if (result.status !== "completed") throw new Error(result.errors.map((item) => item.message).join(" ") || "The model could not generate a workflow.");
  const raw = result.run.textOutputRaw.trim().replace(/^```(?:icc)?\s*/i, "").replace(/```\s*$/i, "");
  const start = raw.search(/^#\s+c1\s*$/im);
  if (start < 0) throw new Error("The model response did not contain valid ICC cells. Try a more specific request.");
  return raw.slice(start).trim();
}

export async function executeVisualWorkflow(
  document: WorkflowDocument,
  limits: WorkflowRunLimits,
  signal: AbortSignal,
  onState: (state: VisualRunState) => void,
  configuredSettings?: WorkspaceSettings,
): Promise<VisualRunState> {
  const settings = executionSettings(configuredSettings);
  const byAlias = new Map(document.steps.map((step) => [step.alias, step]));
  const entry = document.steps.find((step) => step.id === document.entryStepId) ?? document.steps[0];
  const order = new Map(document.steps.map((step, index) => [step.alias, index]));
  const chainTargets = buildChainTargets(document.steps);
  const outputs: Record<string, string> = {};
  const vars: Record<string, ParsedVars> = {};
  const artifacts: Record<string, NotebookCell["artifacts"]> = {};
  let current = entry;
  let totalCostUsd = 0;
  let loopPasses = 0;
  let state: VisualRunState = {
    status: "running",
    totalCostUsd,
    loopPasses,
    message: entry ? "Running workflow…" : "This workflow has no steps.",
    steps: Object.fromEntries(document.steps.map((step) => [step.alias, emptyStepRun(step)])),
  };
  onState(state);

  if (!current) return finish("failed", "This workflow has no steps.");

  const safetyRunCap = Math.max(document.steps.length * (limits.maxLoopPasses + 2), 10);
  for (let runIndex = 0; runIndex < safetyRunCap; runIndex += 1) {
    if (signal.aborted) return finish("stopped", "Run stopped.");
    if (totalCostUsd >= limits.maxBudgetUsd) return finish("budget_reached", "Budget limit reached before the next step.");

    state = patchState(state, current.alias, { status: "running", output: "", error: undefined }, {
      currentAlias: current.alias,
      message: `Running ${current.alias}: ${current.title}`,
    });
    onState(state);

    const cell = makeCell(current, outputs[current.alias] ?? "", vars[current.alias] ?? {}, artifacts[current.alias] ?? []);
    const allCells = document.steps.map((step) => makeCell(step, outputs[step.alias] ?? "", vars[step.alias] ?? {}, artifacts[step.alias] ?? []));
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: document.steps.map((step) => step.alias),
      providerAliases: providerAliasOptions(settings),
      defaultLoopIterations: limits.maxLoopPasses,
      maxLoopIterations: limits.maxLoopPasses,
      cells: allCells,
    });
    const resolvedPromptBody = appendAttachmentContext(resolveReferences(current.prompt, outputs), current.attachments);
    const result = await executeCellRun(cell, parsed, settings, { resolvedPromptBody }, { signal });

    if (signal.aborted) return finish("stopped", "Run stopped.");
    totalCostUsd = roundMoney(totalCostUsd + result.run.costUsd);
    outputs[current.alias] = result.output;
    vars[current.alias] = result.vars;
    artifacts[current.alias] = result.artifacts;

    if (result.status !== "completed") {
      const error = [...new Set(result.errors.flatMap((item) => item.message.split(/\r?\n/)).map((message) => message.trim()).filter(Boolean))].join("\n") || `Step ${current.alias} failed.`;
      state = patchState(state, current.alias, { status: "failed", output: result.output, costUsd: result.run.costUsd, latencyMs: result.run.latencyMs, error }, { totalCostUsd });
      onState(state);
      return finish("failed", error);
    }

    state = patchState(state, current.alias, {
      status: "completed",
      output: result.output,
      costUsd: result.run.costUsd,
      latencyMs: result.run.latencyMs,
      artifacts: result.artifacts.map((artifact) => ({ id: artifact.id, name: artifact.displayName, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, content: artifact.content })),
    }, { totalCostUsd });
    onState(state);

    if (totalCostUsd >= limits.maxBudgetUsd) return finish("budget_reached", "Budget limit reached. No additional loop pass was started.");
    const target = nextTarget(current, result.vars, result.decision?.result, chainTargets);
    if (!target || target === "done") return finish("completed", "Workflow completed.");
    if (target === "stop") return finish("stopped", "Workflow stopped by its flow rule.");

    const next = byAlias.get(target);
    if (!next) return finish("failed", `Unknown next step: ${target}.`);
    if ((order.get(next.alias) ?? 0) <= (order.get(current.alias) ?? 0)) {
      loopPasses += 1;
      state = { ...state, loopPasses };
      onState(state);
      if (loopPasses >= limits.maxLoopPasses) return finish("iteration_reached", `Loop limit reached after ${loopPasses} passes.`);
    }
    current = next;
  }

  return finish("iteration_reached", "Safety run limit reached.");

  function finish(status: VisualRunState["status"], message: string): VisualRunState {
    state = { ...state, status, currentAlias: undefined, totalCostUsd, loopPasses, message };
    onState(state);
    return state;
  }
}

function makeCell(step: WorkflowStep, output: string, vars: ParsedVars, artifacts: NotebookCell["artifacts"]): NotebookCell {
  const lines = serializeStep(step).split(/\r?\n/).slice(1);
  const separator = lines.findIndex((line) => !line.trim());
  const controlHeader = (separator >= 0 ? lines.slice(0, separator) : lines).join("\n");
  const now = new Date().toISOString();
  return {
    id: step.id,
    kind: "intent",
    alias: step.alias,
    title: step.title,
    controlHeader,
    promptBody: step.prompt,
    output,
    status: output ? "completed" : "not_run",
    viewMode: "expanded",
    collapsedPrompt: false,
    collapsedOutput: false,
    vars,
    attachments: step.attachments.map((file) => ({
      id: file.id,
      cellId: step.id,
      displayName: file.name,
      extension: fileExtension(file.name),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      content: file.content,
      encoding: file.encoding,
      createdAt: file.createdAt,
    })),
    artifacts,
    runHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function emptyStepRun(step: WorkflowStep): VisualStepRun {
  return { alias: step.alias, title: step.title, status: "queued", output: "", costUsd: 0, latencyMs: 0, artifacts: [] };
}

function patchState(
  state: VisualRunState,
  alias: string,
  patch: Partial<VisualStepRun>,
  statePatch: Partial<VisualRunState> = {},
): VisualRunState {
  return { ...state, ...statePatch, steps: { ...state.steps, [alias]: { ...state.steps[alias], ...patch } } };
}

function resolveReferences(prompt: string, outputs: Record<string, string>): string {
  return prompt.replace(/%from\s+(c[0-9]+)/gi, (_match, alias: string) => outputs[alias.toLowerCase()] || `[No previous output from ${alias} yet]`);
}

function appendAttachmentContext(prompt: string, files: WorkflowFile[]): string {
  if (!files.length) return prompt;
  const context = files.map((file) => file.encoding === "text"
    ? `--- attached file: ${file.name} ---\n${file.content}`
    : `--- attached file: ${file.name} (${file.mimeType}, ${file.sizeBytes} bytes) ---`).join("\n\n");
  return `${prompt.trim()}\n\nAttached files:\n${context}`;
}

function nextTarget(step: WorkflowStep, vars: ParsedVars, runtimeDecision: boolean | undefined, chainTargets: Map<string, string>): string | undefined {
  if (step.flow.kind === "forward") return step.flow.targets[0];
  if (step.flow.kind === "condition") {
    const actual = vars[step.flow.variable];
    const passed = runtimeDecision ?? compare(actual, step.flow.operator, step.flow.value);
    return passed ? step.flow.trueTarget : step.flow.falseTarget;
  }
  return chainTargets.get(step.alias) ?? (step.flow.kind === "chain" ? step.flow.chain[0] : undefined);
}

function buildChainTargets(steps: WorkflowStep[]): Map<string, string> {
  const targets = new Map<string, string>();
  steps.forEach((step) => {
    if (step.flow.kind !== "chain") return;
    step.flow.chain.slice(0, -1).forEach((source, index) => targets.set(source, step.flow.chain[index + 1]));
  });
  return targets;
}

function compare(actual: unknown, operator: WorkflowStep["flow"]["operator"], expectedRaw: string): boolean {
  const expectedNumber = Number(expectedRaw);
  const actualNumber = Number(actual);
  const expected = Number.isFinite(expectedNumber) ? expectedNumber : expectedRaw;
  const value = Number.isFinite(actualNumber) ? actualNumber : String(actual ?? "");
  if (operator === ">") return value > expected;
  if (operator === ">=") return value >= expected;
  if (operator === "<") return value < expected;
  if (operator === "<=") return value <= expected;
  if (operator === "!=") return value !== expected;
  return value === expected;
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function fileExtension(name: string): string {
  const match = name.match(/(\.[a-z0-9]+)$/i);
  return match?.[1] ?? "";
}

function readLinkedProviderIds(): Set<string> {
  try {
    const stored = localStorage.getItem("icc-go.provider-secrets.v1");
    if (!stored) return new Set();
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return new Set(Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.trim()).map(([id]) => id));
  } catch {
    return new Set();
  }
}

function executionSettings(configuredSettings?: WorkspaceSettings): WorkspaceSettings {
  const source = configuredSettings ?? createInitialWorkspace().settings;
  const linkedProviderIds = readLinkedProviderIds();
  return {
    providers: source.providers.map((provider) => ({
      ...provider,
      balance: { ...provider.balance },
      modelCatalog: provider.modelCatalog?.map((model) => ({ ...model })),
      enabled: provider.enabled || linkedProviderIds.has(provider.id),
      apiKeyMasked: linkedProviderIds.has(provider.id) ? provider.apiKeyMasked || "••••••••" : provider.apiKeyMasked,
    })),
    orchestration: { ...source.orchestration },
  };
}

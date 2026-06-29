import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCellDsl } from "../language/latest";
import { createId, nowIso } from "../lib/id";
import { splitUnifiedCellSource } from "./cellSource";
import { createInitialWorkspace } from "./fixtures";
import { executeCellRun } from "./providerExecution";
import { providerAliasOptions } from "./providerAliases";
import { writeProviderSecret } from "./providerSecrets";
import type { CellAttachment, NotebookCell, ProviderKind, WorkspaceState } from "./types";

declare const process: { env: Record<string, string | undefined> };

const liveEnabled = process.env.RUN_LIVE_RELEASE_NOTEBOOKS === "1";
const liveImageEnabled = liveEnabled && process.env.RUN_LIVE_RELEASE_IMAGE_NOTEBOOKS === "1";

const describeLive = liveEnabled ? describe.sequential : describe.skip;
const describeLiveImages = liveImageEnabled ? describe.sequential : describe.skip;

const exampleModules = import.meta.glob("../../examples/*.icc", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const textExampleFiles = [
  "multi_model_hypothesis.icc",
  "contract_review_with_notes.icc",
  "code_generation_to_files.icc",
  "hft_strategy_branching.icc",
];

const providerEnvNames: Partial<Record<ProviderKind, string[]>> = {
  openai: ["OPENAI_API_KEY", "OPENAI_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_KEY"],
  gemini: ["GEMINI_API_KEY", "GEMINI_KEY"],
  xai: ["XAI_API_KEY", "GROK_API_KEY", "GROK_KEY"],
  deepseek: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
};

describeLive("live public example notebooks", () => {
  beforeEach(stubLocalStorage);

  it.each(textExampleFiles)("executes %s end-to-end with real providers", async (fileName) => {
    const result = await runExampleNotebook(fileName);

    expect(result.failedCells, result.summary).toEqual([]);
    expect(result.outputs.size).toBeGreaterThanOrEqual(2);
  }, 600_000);
});

describeLiveImages("live public image example notebook", () => {
  beforeEach(stubLocalStorage);

  it("executes the image artifact path with OpenRouter and a reference attachment", async () => {
    const source = exampleSource("image_and_markdown_artifacts.icc").replace(
      "@image -png output_{01..10}.png",
      "@image -png output_01.png",
    );
    const result = await runExampleSource("image_and_markdown_artifacts.icc", source, {
      c1: [samplePngAttachment("c1")],
    });

    expect(result.failedCells, result.summary).toEqual([]);
    expect(result.outputs.get("c1")).toContain("output_01.png");
  }, 600_000);
});

interface NotebookRunResult {
  outputs: Map<string, string>;
  failedCells: string[];
  summary: string;
}

async function runExampleNotebook(fileName: string): Promise<NotebookRunResult> {
  return runExampleSource(fileName, exampleSource(fileName));
}

async function runExampleSource(
  fileName: string,
  source: string,
  attachmentsByAlias: Record<string, CellAttachment[]> = {},
): Promise<NotebookRunResult> {
  const workspace = liveWorkspace();
  const cells = parsePlainIccNotebook(source);
  const knownAliases = cells.map((cell) => cell.alias);
  const outputs = new Map<string, string>();
  const failedCells: string[] = [];
  const summaryLines: string[] = [];

  for (const cellSource of cells) {
    const split = splitUnifiedCellSource(cellSource.source.trim());
    const resolvedPromptBody = resolveCellReferences(split.promptBody, outputs);
    const cell = buildCell(workspace, cellSource.alias, split.controlHeader, split.promptBody, attachmentsByAlias[cellSource.alias] ?? []);
    const parsed = parseCellDsl(split.controlHeader, split.promptBody, {
      knownAliases,
      providerAliases: providerAliasOptions(workspace.settings),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
      cells: knownAliases.map((alias) => ({ alias, vars: {}, artifacts: [] })),
    });
    const parseErrors = parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error");
    if (parseErrors.length) {
      failedCells.push(`${cellSource.alias}: ${parseErrors.map((error) => error.message).join("; ")}`);
      continue;
    }

    const result = await executeCellRun(cell, parsed, workspace.settings, {
      inputResolved: parsed.references.map((reference) => reference.raw).join(", "),
      resolvedPromptBody,
    });

    outputs.set(cellSource.alias, result.output);
    summaryLines.push(`${fileName} ${cellSource.alias}: ${result.status}`);

    const blockingErrors = result.errors.filter((error) =>
      ["provider_error", "missing_image_executor", "timeout", "missing_renderer", "binary_format_not_directly_generatable"].includes(error.code ?? ""),
    );
    if (result.status !== "completed" || blockingErrors.length) {
      const errorDetails = result.errors.map((error) => `${error.code ?? error.level}: ${error.message}`);
      const outputExcerpt = (result.run.textOutputRaw || result.output).replace(/\s+/g, " ").slice(0, 700);
      failedCells.push(
        `${cellSource.alias}: ${result.status}${errorDetails.length ? ` - ${errorDetails.join("; ")}` : ""} | output: ${outputExcerpt}`,
      );
    }
  }

  return { outputs, failedCells, summary: summaryLines.join("\n") };
}

function liveWorkspace(): WorkspaceState {
  const workspace = createInitialWorkspace();

  workspace.settings.providers.forEach((provider) => {
    const key = envForProvider(provider.provider);
    provider.enabled = Boolean(key);
    provider.apiKeyMasked = key ? maskKey(key) : "";
    if (key) writeProviderSecret(provider.id, key);
  });

  const openAi = workspace.settings.providers.find((provider) => provider.provider === "openai");
  if (openAi) {
    openAi.defaultModel = "gpt-5.4-mini";
    openAi.fastModel = "gpt-5.4-nano";
    openAi.cheapModel = "gpt-5.4-nano";
    openAi.imageModel = "gpt-image-1";
  }

  workspace.settings.orchestration.selectorModel = envForProvider("openai") ? "openai:gpt-5.4-mini" : "openrouter:openrouter/auto";
  workspace.settings.orchestration.synthesisModel = envForProvider("anthropic")
    ? "claude:claude-sonnet-4-6"
    : "openrouter:openrouter/fusion";
  workspace.settings.orchestration.evaluatorModel = workspace.settings.orchestration.selectorModel;

  return workspace;
}

function buildCell(
  workspace: WorkspaceState,
  alias: string,
  controlHeader: string,
  promptBody: string,
  attachments: CellAttachment[],
): NotebookCell {
  return {
    ...workspace.projects[0].notebooks[0].cells[0],
    id: createId("cell"),
    alias,
    title: alias,
    controlHeader,
    promptBody,
    output: "",
    status: "not_run",
    attachments,
    artifacts: [],
    vars: {},
    runHistory: [],
  };
}

function resolveCellReferences(source: string, outputs: Map<string, string>): string {
  return source.replace(/%(?:from|output)\s+(c\d+)/gi, (raw, alias: string) => {
    const output = outputs.get(alias);
    return output ? `Prior output from ${alias}:\n${output}` : raw;
  });
}

function parsePlainIccNotebook(source: string): Array<{ alias: string; source: string }> {
  const cells: Array<{ alias: string; source: string }> = [];
  let current: { alias: string; lines: string[] } | undefined;

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^#\s+(c\d+)\s*$/);
    if (heading) {
      if (current) cells.push({ alias: current.alias, source: current.lines.join("\n").trim() });
      current = { alias: heading[1], lines: [] };
      continue;
    }
    current?.lines.push(line);
  }

  if (current) cells.push({ alias: current.alias, source: current.lines.join("\n").trim() });
  return cells;
}

function exampleSource(fileName: string): string {
  const source = exampleModules[`../../examples/${fileName}`];
  if (!source) throw new Error(`Missing example notebook: ${fileName}`);
  return source;
}

function envForProvider(provider: ProviderKind): string {
  return (providerEnvNames[provider] ?? []).map((name) => process.env[name]?.trim()).find(Boolean) ?? "";
}

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}...`;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function stubLocalStorage() {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
}

function samplePngAttachment(cellId: string): CellAttachment {
  const content =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABuklEQVR4nO2bwbGDMAxElz9phUIogwopg0Iohpw8w2cSkGzZKwW/Uw4Js/tsA07IsO87nswfOwCbLoAdgE0XwA7ApgtgB2DzsjjIuM60m4ltWoaSzw8lN0LM4mdyRWQJ8FT8jFaE+hzguTygz6cS4L18QpNTLCBK+YQ07+MvgyIB0UY/IcndZ8DdG6KOfuIuf58B7AC5bNNicpyQAlJ5CwnhBJxLb9NSJCKcgG/kSggl4KrkuM5ZxwwjoEZ5IIgAqzP+J0IIuKJk9IEAAmpN/YRrAbXLA44F1Fz3R9wKuMJq9AGnAlpM/YQ7AS3LAxUElKzdVuv+iKkAy13amRqjDxgK+LRLK/n8kVrlASMB38JLJbDKA0YCrkLeSWCs+yNmS6BEQs4xrTA9CWolMKd+wvwyKJXgoTxQ6UboTgJ73R+pdieYO4otRx+ofCusLdO6PNBgLyAtxSgPNNoMscpJaLYbvJLAFNR0O5yKjuv87zUT0VNikX8iv3tqzN0XIq0RCSh9GpOFJHefAdI3RpsF0ryqGRBFgianegl4l6DN158Wt/jf4GP/L/AL9MsgOwCbLoAdgE0XwA7A5g2O8LVlHMvhZwAAAABJRU5ErkJggg==";
  return {
    id: createId("att"),
    cellId,
    displayName: "reference_style.png",
    extension: ".png",
    mimeType: "image/png",
    sizeBytes: 499,
    content,
    encoding: "base64",
    createdAt: nowIso(),
  };
}

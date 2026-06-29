import type { Notebook, NotebookCell, Project, ProviderSettings, WorkspaceState } from "./types";
import { createId, nowIso } from "../lib/id";
import { createNotebookMetadata } from "./notebookMetadata";

function createCell(alias: string, title: string, controlHeader: string, promptBody: string): NotebookCell {
  const timestamp = nowIso();

  return {
    id: createId("cell"),
    kind: "intent",
    alias,
    title,
    controlHeader,
    promptBody,
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

function createNotebook(): Notebook {
  const timestamp = nowIso();

  return {
    id: createId("notebook"),
    title: "Trading hypothesis workflow",
    description: "Compare, evaluate, and branch from LLM outputs.",
    metadata: createNotebookMetadata(timestamp),
    cellAliasCounter: 5,
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
    createdAt: timestamp,
    updatedAt: timestamp,
    cells: [
      createCell(
        "c1",
        "Generate candidate",
        "> (openai + claude).best\n< cost <= $3.33\n< latency <= 3m\n@forward c2",
        "Find a realistic HFT hypothesis for Binance USDM.\nAccount for fees, latency, fill probability, adverse selection, and overfit risk.",
      ),
      createCell(
        "c2",
        "Evaluate PnL",
        "> openai.max\n@if pnl > 0 -> c3\n@else -> c4",
        'Analyze the hypothesis from %from c1.\nReturn final answer as JSON with numeric "pnl" and short "reason" keys.',
      ),
      createCell(
        "c3",
        "Write strategy code",
        "> claude.max\n< tokens <= 50000\n@file -python strategy_code.py\n@text <300",
        "Write strategy code for the accepted hypothesis.\n\nInput:\n%from c2",
      ),
      createCell(
        "c4",
        "Close hypothesis",
        "> openai\n@file -markdown closeout_note.md\n@text <100",
        "Create a short markdown closeout note explaining why the hypothesis did not pass.\n\nData:\n%from c2",
      ),
    ],
  };
}

const providers: ProviderSettings[] = [
  {
    id: "provider_openai",
    provider: "openai",
    label: "OpenAI",
    alias: "OpenAI",
    enabled: true,
    apiKeyMasked: "",
    defaultModel: "gpt-5.4-mini",
    maxModel: "gpt-5.5",
    ensembleModel: "gpt-5.5",
    cheapModel: "gpt-5.4-nano",
    fastModel: "gpt-5.4-nano",
    codeModel: "gpt-5.3-codex",
    imageModel: "gpt-image-1.5",
    contextLimit: 200000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
  {
    id: "provider_anthropic",
    provider: "anthropic",
    label: "Anthropic",
    alias: "Claude",
    enabled: true,
    apiKeyMasked: "",
    defaultModel: "claude-sonnet-4-6",
    maxModel: "claude-opus-4-6",
    ensembleModel: "claude-opus-4-6",
    cheapModel: "claude-haiku-4-5-20251001",
    fastModel: "claude-haiku-4-5-20251001",
    codeModel: "claude-sonnet-4-6",
    imageModel: "",
    contextLimit: 200000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
  {
    id: "provider_openrouter",
    provider: "openrouter",
    label: "OpenRouter",
    alias: "OpenRouter",
    enabled: false,
    apiKeyMasked: "",
    defaultModel: "openrouter/auto",
    maxModel: "openrouter/auto",
    ensembleModel: "openrouter/fusion",
    cheapModel: "openrouter/auto",
    fastModel: "openrouter/auto",
    codeModel: "anthropic/claude-sonnet-4.6",
    imageModel: "",
    contextLimit: 200000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
  {
    id: "provider_gemini",
    provider: "gemini",
    label: "Gemini",
    alias: "Gemini",
    enabled: false,
    apiKeyMasked: "",
    defaultModel: "gemini-2.5-pro",
    maxModel: "gemini-2.5-pro",
    ensembleModel: "gemini-2.5-pro",
    cheapModel: "gemini-2.5-flash",
    fastModel: "gemini-2.5-flash",
    codeModel: "gemini-2.5-pro",
    imageModel: "",
    contextLimit: 1000000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
  {
    id: "provider_xai",
    provider: "xai",
    label: "xAI",
    alias: "xAI",
    enabled: false,
    apiKeyMasked: "",
    defaultModel: "grok-4.3",
    maxModel: "grok-4.3",
    ensembleModel: "grok-4.3",
    cheapModel: "grok-4.20-0309-non-reasoning",
    fastModel: "grok-4.20-0309-non-reasoning",
    codeModel: "grok-4.3",
    imageModel: "",
    contextLimit: 256000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
  {
    id: "provider_deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    alias: "DeepSeek",
    enabled: false,
    apiKeyMasked: "",
    defaultModel: "deepseek-v4-flash",
    maxModel: "deepseek-v4-pro",
    ensembleModel: "deepseek-v4-pro",
    cheapModel: "deepseek-v4-flash",
    fastModel: "deepseek-v4-flash",
    codeModel: "deepseek-v4-pro",
    imageModel: "",
    contextLimit: 128000,
    balance: { state: "unchecked", message: "Balance has not been checked yet." },
  },
];

export function createInitialWorkspace(): WorkspaceState {
  const notebook = createNotebook();
  const timestamp = nowIso();
  const project: Project = {
    id: createId("project"),
    name: "Research",
    notebooks: [notebook],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    projects: [project],
    activeProjectId: project.id,
    activeNotebookId: notebook.id,
    selectedCellId: notebook.cells[0]?.id,
    settings: {
      providers: cloneProviders(providers),
      orchestration: {
        selectorModel: "openai:gpt-5.4-mini",
        synthesisModel: "claude:claude-sonnet-4-6",
        evaluatorModel: "openai:gpt-5.4-mini",
        defaultCostCapUsd: 3.33,
        defaultLatencyCapSec: 180,
        defaultLoopIterations: 3,
        maxLoopIterations: 10,
        fallbackProvider: "OpenAI",
        retryPolicy: "once",
      },
    },
  };
}

function cloneProviders(items: ProviderSettings[]): ProviderSettings[] {
  return items.map((provider) => ({
    ...provider,
    balance: { ...provider.balance },
    modelCatalog: provider.modelCatalog?.map((model) => ({ ...model })),
  }));
}

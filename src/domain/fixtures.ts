import type { Notebook, NotebookCell, Project, ProviderSettings, WorkspaceState } from "./types";
import { createId, nowIso } from "../lib/id";
import { createNotebookMetadata } from "./notebookMetadata";
import { autoModelProfiles } from "./providerModelRegistry";

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
    title: "Product spec workflow",
    description: "Draft, critique, and export a product spec from reusable intent cells.",
    metadata: createNotebookMetadata(timestamp),
    cellAliasCounter: 4,
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
        "Draft product spec",
        "> openai.max\n@forward c2\n@text <700",
        "Draft a product spec for a lightweight issue triage assistant.\nInclude target users, core workflow, data boundaries, and non-goals.",
      ),
      createCell(
        "c2",
        "Critique spec",
        "> claude.max\n@forward c3\n@text <600",
        "Critique %from c1.\nIdentify missing requirements, ambiguous scope, privacy risks, and launch blockers.",
      ),
      createCell(
        "c3",
        "Export final spec",
        "> auto\n@file -markdown final_spec.md",
        "Rewrite the product spec using %from c1 and %from c2.\nProduce a concise Markdown file with assumptions, user flows, acceptance criteria, and open questions.",
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
    defaultModel: "gpt-4o-mini",
    maxModel: autoModelProfiles.max,
    ensembleModel: autoModelProfiles.ensemble,
    cheapModel: "gpt-4o-mini",
    fastModel: "gpt-4o-mini",
    codeModel: "gpt-4o",
    imageModel: "gpt-image-1",
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
    defaultModel: "claude-sonnet-latest",
    maxModel: autoModelProfiles.max,
    ensembleModel: autoModelProfiles.ensemble,
    cheapModel: "claude-haiku-latest",
    fastModel: "claude-haiku-latest",
    codeModel: "claude-sonnet-latest",
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
    codeModel: "openrouter/auto",
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
    maxModel: autoModelProfiles.max,
    ensembleModel: autoModelProfiles.ensemble,
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
    defaultModel: "grok-4",
    maxModel: autoModelProfiles.max,
    ensembleModel: autoModelProfiles.ensemble,
    cheapModel: "grok-3-mini",
    fastModel: "grok-3-mini",
    codeModel: "grok-4",
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
    defaultModel: "deepseek-chat",
    maxModel: autoModelProfiles.max,
    ensembleModel: autoModelProfiles.ensemble,
    cheapModel: "deepseek-chat",
    fastModel: "deepseek-chat",
    codeModel: "deepseek-reasoner",
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
        selectorModel: "openai:gpt-4o-mini",
        synthesisModel: "claude:claude-sonnet-latest",
        evaluatorModel: "openai:gpt-4o-mini",
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

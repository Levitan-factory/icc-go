import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCellDsl } from "../language/latest";
import { createInitialWorkspace } from "./fixtures";
import { executeCellRun } from "./providerExecution";
import { providerAliasOptions } from "./providerAliases";
import { writeProviderSecret } from "./providerSecrets";
import type { NotebookCell, ProviderKind, WorkspaceState } from "./types";

declare const process: { env: Record<string, string | undefined> };

const liveEnabled = process.env.RUN_LIVE_PROVIDER_TESTS === "1";
const liveImagesEnabled = liveEnabled && process.env.RUN_LIVE_IMAGE_TESTS === "1";

const describeLive = liveEnabled ? describe.sequential : describe.skip;
const describeLiveImages = liveImagesEnabled ? describe.sequential : describe.skip;

const providerEnvNames: Partial<Record<ProviderKind, string[]>> = {
  openai: ["OPENAI_API_KEY", "OPENAI_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_KEY"],
  gemini: ["GEMINI_API_KEY", "GEMINI_KEY"],
  xai: ["XAI_API_KEY", "GROK_API_KEY", "GROK_KEY"],
  deepseek: ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
};

describeLive("live provider execution", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  const providerCases: Array<{ provider: ProviderKind; route: string; marker: string }> = [
    { provider: "openai", route: "> openai", marker: "ICC_OK_OPENAI" },
    { provider: "openrouter", route: "> openrouter", marker: "ICC_OK_OPENROUTER" },
    { provider: "anthropic", route: "> claude.fast", marker: "ICC_OK_ANTHROPIC" },
    { provider: "gemini", route: "> gemini.fast", marker: "ICC_OK_GEMINI" },
    { provider: "xai", route: "> xai.fast", marker: "ICC_OK_XAI" },
    { provider: "deepseek", route: "> deepseek.fast", marker: "ICC_OK_DEEPSEEK" },
  ];

  providerCases.forEach(({ provider, route, marker }) => {
    it.skipIf(!envForProvider(provider))(`executes a one-cell notebook through ${provider}`, async () => {
      const workspace = liveWorkspace();
      const cell = testCell(workspace, route, `Reply with exactly ${marker}. No markdown. No extra words.`);

      const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

      expect(result.status).toBe("completed");
      expect(result.output).not.toContain("Simulated provider run");
      expect(result.output.toUpperCase()).toContain(marker);
    }, 120_000);
  });

  it.skipIf(!envForProvider("openai"))("passes %from output into the next live cell without returning the prior prompt", async () => {
    const workspace = liveWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const c1 = {
      ...notebook.cells[0],
      alias: "c1",
      title: "Seed",
      controlHeader: "> openai",
      promptBody: "Reply with exactly SOURCE_ALPHA.",
    };
    const c1Result = await executeCellRun(c1, parse(workspace, c1), workspace.settings);
    expect(c1Result.status).toBe("completed");
    expect(c1Result.output.toUpperCase()).toContain("SOURCE_ALPHA");

    const c2 = {
      ...notebook.cells[1],
      alias: "c2",
      title: "Use source",
      controlHeader: "> openai\n%from c1",
      promptBody: "Read the prior output and reply with exactly FORWARD_OK if it contains SOURCE_ALPHA.",
    };
    const resolvedPromptBody = `${c2.promptBody}\n\nPrior output:\n${c1Result.output}`;
    const c2Result = await executeCellRun(c2, parse(workspace, c2), workspace.settings, {
      inputResolved: "%from c1",
      resolvedPromptBody,
    });

    expect(c2Result.status).toBe("completed");
    expect(c2Result.output).not.toBe(c1Result.output);
    expect(c2Result.output.toUpperCase()).toContain("FORWARD_OK");
  }, 120_000);

  it.skipIf(!envForProvider("openai"))("extracts a live markdown artifact and keeps @text as an instruction instead of clipping", async () => {
    const workspace = liveWorkspace();
    const cell = testCell(
      workspace,
      "> openai\n@file -markdown live_report.md\n@text <80\n< cost <= $0.0001",
      [
        "Your response must include this exact artifact section first:",
        "--- file: live_report.md ---",
        "# ICC Live File",
        "ICC_FILE_OK",
        "After that section, reply with ICC_VISIBLE_TEXT_OK in the visible answer.",
      ].join("\n"),
    );

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toContain("ICC_VISIBLE_TEXT_OK");
    expect(result.output.length).toBeGreaterThan(80);
    expect(result.artifacts.some((artifact) => artifact.displayName === "live_report.md")).toBe(true);
    expect(result.artifacts.find((artifact) => artifact.displayName === "live_report.md")?.content).toContain("ICC_FILE_OK");
  }, 120_000);

  it.skipIf(!envForProvider("openai"))("honors a tiny latency constraint by failing fast with a clear timeout", async () => {
    const workspace = liveWorkspace();
    const cell = testCell(workspace, "> openai\n< latency <= 1ms", "Wait two seconds, then say LATENCY_SHOULD_NOT_COMPLETE.");

    const started = performance.now();
    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(performance.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe("timeout");
    expect(result.errors.some((error) => error.code === "timeout")).toBe(true);
    expect(result.output).toContain("provider did not respond within");
  }, 30_000);
});

describeLiveImages("live image provider execution", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
  });

  it.skipIf(!envForProvider("openai"))("creates one PNG image artifact through the configured provider", async () => {
    const workspace = liveWorkspace();
    const cell = testCell(
      workspace,
      "> openai\n@image -png live_icon.png",
      "Create a simple transparent PNG icon: a green check mark in a clean vector-like style. No text.",
    );

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      displayName: "live_icon.png",
      mimeType: "image/png",
    });
    expect(result.artifacts[0].sizeBytes).toBeGreaterThan(1000);
  }, 240_000);

  it.skipIf(!envForProvider("openrouter"))("creates one PNG image artifact through an explicit OpenRouter image route", async () => {
    const workspace = liveWorkspace();
    const cell = testCell(
      workspace,
      "> openrouter:openai/gpt-image-1\n@image -png live_openrouter_icon.png",
      "Create a tiny transparent PNG icon: a green square with one white diagonal line. No text.",
    );

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      displayName: "live_openrouter_icon.png",
      mimeType: "image/png",
    });
    expect(result.artifacts[0].sizeBytes).toBeGreaterThan(1000);
  }, 240_000);
});

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
    openAi.defaultModel = "gpt-4o-mini";
    openAi.fastModel = "gpt-4o-mini";
    openAi.cheapModel = "gpt-4o-mini";
  }

  workspace.settings.orchestration.selectorModel = envForProvider("openai") ? "openai:gpt-4o-mini" : "openrouter:openrouter/auto";
  workspace.settings.orchestration.synthesisModel = envForProvider("openai") ? "openai:gpt-4o-mini" : "openrouter:openrouter/fusion";
  workspace.settings.orchestration.evaluatorModel = workspace.settings.orchestration.selectorModel;

  return workspace;
}

function envForProvider(provider: ProviderKind): string {
  return (providerEnvNames[provider] ?? []).map((name) => process.env[name]?.trim()).find(Boolean) ?? "";
}

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}...`;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function testCell(workspace: WorkspaceState, controlHeader: string, promptBody: string): NotebookCell {
  return {
    ...workspace.projects[0].notebooks[0].cells[0],
    controlHeader,
    promptBody,
    artifacts: [],
    attachments: [],
    output: "",
  };
}

function parse(workspace: WorkspaceState, cell: NotebookCell) {
  return parseCellDsl(cell.controlHeader, cell.promptBody, {
    knownAliases: workspace.projects[0].notebooks[0].cells.map((candidate) => candidate.alias),
    providerAliases: providerAliasOptions(workspace.settings),
    defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
    maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
  });
}

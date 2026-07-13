import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCellDsl } from "../language/latest";
import { createInitialWorkspace } from "./fixtures";
import { executeCellRun } from "./providerExecution";
import { createProviderSettings, providerAliasOptions } from "./providerAliases";
import { writeProviderSecret } from "./providerSecrets";
import type { NotebookCell, WorkspaceState } from "./types";

describe("provider execution", () => {
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
    vi.restoreAllMocks();
  });

  it("calls the OpenAI Responses API when a full local key is bound", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: "Live OpenAI answer." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live OpenAI answer.");
    expect(result.output).not.toContain("Simulated provider run");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      model: "gpt-4o",
      input: cell.promptBody,
      store: false,
    });
  });

  it("uses the built-in fallback catalog as a live safety net when no cached provider catalog exists", async () => {
    const workspace = createInitialWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: "Fallback catalog answer." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Fallback catalog answer.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(body).toMatchObject({ model: "gpt-4o" });
    expect(result.run.providerRuns).toEqual([
      expect.objectContaining({ provider: "OpenAI", model: "gpt-4o", status: "completed" }),
    ]);
  });

  it("resolves a provider-only route through the provider auto/default profile", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: "Default profile answer." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Default profile answer.");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      model: "gpt-4o-mini",
    });
  });

  it("accepts OpenAI Responses payloads with a null error field", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        status: "completed",
        error: null,
        output: [{ type: "message", content: [{ type: "output_text", text: "Live OpenAI answer." }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live OpenAI answer.");
  });

  it("passes @text length limits as provider instructions without clipping the answer", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max\n@text <40");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");
    const longAnswer = "This live answer is intentionally longer than forty characters.";

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: longAnswer }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(body.input).toContain("Keep the visible text answer within 40 characters.");
    expect(body.input).toContain(cell.promptBody);
    expect(result.output).toBe(longAnswer);
  });

  it("reports unsupported live cost preflight without blocking a completed run", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max\n< cost <= $0.01");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: "Cost-aware live answer." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toContain("Cost cap <= $0.01 is recorded for this cell.");
    expect(result.output).toContain("cost preflight is not available");
    expect(result.output).not.toContain("provider execution adapters are not enabled");
    expect(result.output).not.toContain("Linked key detected");
    expect(result.output).toContain("Cost-aware live answer.");
  });

  it("calls OpenRouter chat completions for explicit OpenRouter model routes", async () => {
    const workspace = createLiveWorkspace();
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!openRouter) throw new Error("OpenRouter fixture missing");

    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> openrouter:openrouter/auto");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Live OpenRouter answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live OpenRouter answer.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      model: "openrouter/auto",
      messages: [{ role: "user", content: cell.promptBody }],
    });
  });

  it("resolves provider-only OpenRouter routes through OpenRouter auto", async () => {
    const workspace = createLiveWorkspace();
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!openRouter) throw new Error("OpenRouter fixture missing");

    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    openRouter.defaultModel = "openrouter/auto";
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> openrouter");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Auto-routed OpenRouter answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Auto-routed OpenRouter answer.");
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body).toMatchObject({
      model: "openrouter/auto",
      messages: [{ role: "user", content: cell.promptBody }],
    });
  });

  it("routes Anthropic text calls through OpenRouter when a linked OpenRouter transport is available", async () => {
    const workspace = createLiveWorkspace();
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!anthropic || !openRouter) throw new Error("Provider fixtures missing");

    anthropic.enabled = true;
    anthropic.apiKeyMasked = "";
    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> claude.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Anthropic answer through OpenRouter." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toContain("Anthropic answer through OpenRouter.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("~anthropic/claude-opus-latest");
    expect(result.run.providerRuns).toEqual([
      expect.objectContaining({
        provider: "Claude via OpenRouter",
        model: "~anthropic/claude-opus-latest",
        status: "completed",
      }),
    ]);
  });

  it("keeps Anthropic browser routes on the OpenRouter bridge even when a direct Anthropic key is linked", async () => {
    const workspace = createLiveWorkspace();
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!anthropic || !openRouter) throw new Error("Provider fixtures missing");

    anthropic.enabled = true;
    anthropic.apiKeyMasked = "sk-ant-...test";
    writeProviderSecret(anthropic.id, "sk-ant-test");
    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> claude.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Bridged Anthropic answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("~anthropic/claude-opus-latest");
    expect(result.output).toContain("Bridged Anthropic answer.");
    expect(result.run.providerRuns).toEqual([
      expect.objectContaining({
        provider: "Claude via OpenRouter",
        model: "~anthropic/claude-opus-latest",
        status: "completed",
      }),
    ]);
  });

  it("uses the first enabled linked provider when a cell has no explicit route", async () => {
    const workspace = createLiveWorkspace();
    workspace.settings.providers.forEach((provider) => {
      provider.enabled = false;
      provider.apiKeyMasked = "";
    });
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!openRouter) throw new Error("OpenRouter fixture missing");

    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    openRouter.defaultModel = "openrouter/auto";
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Fallback provider answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Fallback provider answer.");
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(body.model).toBe("openrouter/auto");
  });

  it("blocks direct Anthropic browser calls when no OpenRouter transport is linked", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    if (!provider) throw new Error("Anthropic fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "sk-ant-...test";
    writeProviderSecret(provider.id, "sk-ant-test");

    const cell = testCell(workspace, "> claude.max");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("Anthropic cannot be called directly from the browser");
    expect(result.output).toContain("Link an OpenRouter key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Gemini generateContent for Gemini routes", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "gemini");
    if (!provider) throw new Error("Gemini fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "AIza...test";
    writeProviderSecret(provider.id, "AIza-test-gemini");

    const cell = testCell(workspace, "> gemini.fast");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "Live Gemini answer." }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live Gemini answer.");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIza-test-gemini",
    );
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: cell.promptBody }] }],
      generationConfig: { maxOutputTokens: 4096 },
    });
  });

  it("calls xAI chat completions for xAI routes", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!provider) throw new Error("xAI fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "xai-...test";
    writeProviderSecret(provider.id, "xai-test");

    const cell = testCell(workspace, "> xai.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Live xAI answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live xAI answer.");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.x.ai/v1/chat/completions");
    expect(body).toMatchObject({
      model: "grok-4",
      messages: [{ role: "user", content: cell.promptBody }],
      stream: false,
    });
  });

  it("auto-heals stale non-text .max profile models before xAI execution", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!provider) throw new Error("xAI fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "xai-...test";
    provider.maxModel = "grok-4.20-multi-agent-0309";
    writeProviderSecret(provider.id, "xai-test");

    const cell = testCell(workspace, "> xai.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Healed xAI answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Healed xAI answer.");
    expect(body).toMatchObject({
      model: "grok-4",
      messages: [{ role: "user", content: cell.promptBody }],
    });
  });

  it("rejects explicit non-text xAI models before issuing a provider request", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!provider) throw new Error("xAI fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "xai-...test";
    writeProviderSecret(provider.id, "xai-test");

    const cell = testCell(workspace, "> xai:grok-imagine-image-quality");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("not a text/chat model");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls DeepSeek chat completions for DeepSeek routes", async () => {
    const workspace = createLiveWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "deepseek");
    if (!provider) throw new Error("DeepSeek fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "sk-...test";
    writeProviderSecret(provider.id, "sk-test-deepseek");

    const cell = testCell(workspace, "> deepseek.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ choices: [{ message: { content: "Live DeepSeek answer." } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live DeepSeek answer.");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(body).toMatchObject({
      model: "deepseek-chat",
      messages: [{ role: "user", content: cell.promptBody }],
      stream: false,
    });
  });

  it("runs grouped .best routes through candidates and the configured selector", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((candidate) => candidate.provider === "openrouter");
    if (!openAi || !anthropic || !openRouter) throw new Error("Provider fixtures missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> (openai + claude).best");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === "https://api.openai.com/v1/responses" && String(body.input).includes("ICC-GO selector task")) {
        return jsonResponse({ output_text: '{"winner": 2, "reason": "More concrete."}' });
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse({ output_text: "OpenAI candidate answer." });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        return jsonResponse({ choices: [{ message: { content: "Anthropic candidate answer." } }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Anthropic candidate answer.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const openRouterCall = fetchMock.mock.calls.find(([input]) => String(input) === "https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String((openRouterCall?.[1] as RequestInit).body))).toMatchObject({
      model: "~anthropic/claude-sonnet-latest",
    });
  });

  it("accepts loose selector answers for grouped .best routes", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((candidate) => candidate.provider === "openrouter");
    if (!openAi || !anthropic || !openRouter) throw new Error("Provider fixtures missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");
    writeProviderSecret(openRouter.id, "sk-or-test");

    const cell = testCell(workspace, "> (openai + claude).best");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === "https://api.openai.com/v1/responses" && String(body.input).includes("ICC-GO selector task")) {
        return jsonResponse({ output_text: "winner: 1" });
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse({ output_text: "OpenAI candidate answer." });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        return jsonResponse({ choices: [{ message: { content: "Anthropic candidate answer." } }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("OpenAI candidate answer.");
    const openRouterCall = fetchMock.mock.calls.find(([input]) => String(input) === "https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(String((openRouterCall?.[1] as RequestInit).body))).toMatchObject({
      model: "~anthropic/claude-sonnet-latest",
    });
  });

  it("surfaces partial provider failures while preserving grouped ensemble output", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((candidate) => candidate.provider === "openrouter");
    const xai = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!openAi || !anthropic || !openRouter || !xai) throw new Error("Provider fixtures missing");

    openAi.enabled = true;
    anthropic.enabled = true;
    openRouter.enabled = true;
    xai.enabled = true;
    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    openRouter.apiKeyMasked = "sk-or-...test";
    xai.apiKeyMasked = "xai-...test";
    workspace.settings.orchestration.synthesisModel = "openai:gpt-4o-mini";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");
    writeProviderSecret(openRouter.id, "sk-or-test");
    writeProviderSecret(xai.id, "xai-test");

    const cell = testCell(workspace, "> (openai.max + claude.max + xai.max).ensemble");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === "https://api.openai.com/v1/responses" && String(body.input).includes("ICC-GO ensemble task")) {
        return jsonResponse({ output_text: "Synthesized answer." });
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse({ output_text: "OpenAI candidate answer." });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        expect(body.model).toBe("~anthropic/claude-opus-latest");
        return jsonResponse({ error: { message: "Anthropic quota exhausted through OpenRouter" } }, 429);
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        return jsonResponse({ choices: [{ message: { content: "xAI candidate answer." } }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("partial_failed");
    expect(result.output).toContain("Ensemble completed with 2 of 3 provider candidates. Failed providers: Claude via OpenRouter / ~anthropic/claude-opus-latest.");
    expect(result.output).toContain("Provider warning (Claude via OpenRouter / ~anthropic/claude-opus-latest): Anthropic quota exhausted through OpenRouter");
    expect(result.output).toContain("Synthesized answer.");
    expect(result.run.textOutputRaw).toBe("Synthesized answer.");
    expect(result.run.summary).toBe("Completed with provider warnings.");
    expect(result.run.providerRuns).toEqual([
      expect.objectContaining({ provider: "OpenAI", status: "completed" }),
      expect.objectContaining({ provider: "Claude via OpenRouter", status: "failed" }),
      expect.objectContaining({ provider: "xAI", status: "completed" }),
    ]);
  });

  it("explains Gemini empty responses caused by output token exhaustion", async () => {
    const workspace = createLiveWorkspace();
    const gemini = workspace.settings.providers.find((candidate) => candidate.provider === "gemini");
    if (!gemini) throw new Error("Gemini fixture missing");

    gemini.enabled = true;
    gemini.apiKeyMasked = "AIza...test";
    writeProviderSecret(gemini.id, "AIza-test");

    const cell = testCell(workspace, "> gemini.max");
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Gemini returned no text because its output token budget was exhausted");
  });

  it("reports every missing participant in a four-provider ensemble run", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    const openRouter = workspace.settings.providers.find((candidate) => candidate.provider === "openrouter");
    const gemini = workspace.settings.providers.find((candidate) => candidate.provider === "gemini");
    const xai = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!openAi || !anthropic || !openRouter || !gemini || !xai) throw new Error("Provider fixtures missing");

    openAi.enabled = true;
    anthropic.enabled = true;
    openRouter.enabled = true;
    gemini.enabled = true;
    xai.enabled = true;
    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    openRouter.apiKeyMasked = "sk-or-...test";
    gemini.apiKeyMasked = "AIza...test";
    xai.apiKeyMasked = "xai-...test";
    workspace.settings.orchestration.synthesisModel = "openai:gpt-4o-mini";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");
    writeProviderSecret(openRouter.id, "sk-or-test");
    writeProviderSecret(gemini.id, "AIza-test");
    writeProviderSecret(xai.id, "xai-test");

    const cell = testCell(workspace, "> (openai.max + claude.max + gemini.max + xai.max).ensemble");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === "https://api.openai.com/v1/responses" && String(body.input).includes("ICC-GO ensemble task")) {
        expect(body.input).toContain("Failed provider candidates:");
        expect(body.input).toContain("Claude via OpenRouter / ~anthropic/claude-opus-latest: Anthropic quota exhausted");
        expect(body.input).toContain("Gemini / gemini-2.5-pro: Gemini request failed with HTTP 503.");
        return jsonResponse({ output_text: "Synthesis from the available OpenAI and xAI candidates." });
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse({ output_text: "OpenAI candidate answer." });
      }
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        expect(body.model).toBe("~anthropic/claude-opus-latest");
        return jsonResponse({ error: { message: "Anthropic quota exhausted" } }, 429);
      }
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        return jsonResponse({}, 503);
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        return jsonResponse({ choices: [{ message: { content: "xAI candidate answer." } }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("partial_failed");
    expect(result.output).toContain(
      "Ensemble completed with 2 of 4 provider candidates. Failed providers: Claude via OpenRouter / ~anthropic/claude-opus-latest, Gemini / gemini-2.5-pro.",
    );
    expect(result.output).toContain("Provider warning (Claude via OpenRouter / ~anthropic/claude-opus-latest): Anthropic quota exhausted");
    expect(result.output).toContain("Provider warning (Gemini / gemini-2.5-pro): Gemini request failed with HTTP 503.");
    expect(result.output).toContain("Synthesis from the available OpenAI and xAI candidates.");
    expect(result.run.providerRuns).toEqual([
      expect.objectContaining({ provider: "OpenAI", status: "completed" }),
      expect.objectContaining({ provider: "Claude via OpenRouter", status: "failed" }),
      expect.objectContaining({ provider: "Gemini", status: "failed" }),
      expect.objectContaining({ provider: "xAI", status: "completed" }),
    ]);
  });

  it("warns when grouped ensemble falls back to candidate output after synthesizer failure", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const xai = workspace.settings.providers.find((candidate) => candidate.provider === "xai");
    if (!openAi || !xai) throw new Error("Provider fixtures missing");

    openAi.enabled = true;
    xai.enabled = true;
    openAi.apiKeyMasked = "sk-proj-...test";
    xai.apiKeyMasked = "xai-...test";
    workspace.settings.orchestration.synthesisModel = "openai:gpt-4o-mini";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(xai.id, "xai-test");

    const cell = testCell(workspace, "> (openai.max + xai.max).ensemble");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url === "https://api.openai.com/v1/responses" && String(body.input).includes("ICC-GO ensemble task")) {
        throw new TypeError("synthesizer unavailable");
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse({ output_text: "OpenAI candidate answer." });
      }
      if (url === "https://api.x.ai/v1/chat/completions") {
        return jsonResponse({ choices: [{ message: { content: "xAI candidate answer." } }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("partial_failed");
    expect(result.output).toContain("Ensemble warning (OpenAI / gpt-4o-mini): synthesizer unavailable");
    expect(result.output).toContain("// --- OpenAI / gpt-4o ---");
    expect(result.output).toContain("OpenAI candidate answer.");
    expect(result.output).toContain("// --- xAI / grok-4 ---");
    expect(result.output).toContain("xAI candidate answer.");
    expect(result.run.textOutputRaw).not.toContain("Ensemble warning");
  });

  it("blocks execution when a route references an unknown model from the provider catalog", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai:not-a-real-model");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const parsed = parse(workspace, cell);
    const result = await executeCellRun(cell, parsed, workspace.settings);

    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("Unknown model `not-a-real-model`"))).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.output).toContain("Unknown model `not-a-real-model` for OpenAI");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks execution when the provider alias does not match any configured alias", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> chinese.max");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const parsed = parse(workspace, cell);
    const result = await executeCellRun(cell, parsed, workspace.settings);

    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("Unknown provider alias: chinese"))).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.output).toContain("Unknown provider alias: chinese");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates repeated provider/model routes in grouped .best runs", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    if (!openAi) throw new Error("OpenAI fixture missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");

    const cell = testCell(workspace, "> (openai.max + openai.max).best");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ output_text: "Single OpenAI candidate answer." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toContain("Duplicate provider route ignored (OpenAI / gpt-4o).");
    expect(result.output).toContain("Single OpenAI candidate answer.");
    expect(result.run.providerRuns).toEqual([expect.objectContaining({ provider: "OpenAI", model: "gpt-4o" })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a grouped route when one repeated model entry is invalid", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    if (!openAi) throw new Error("OpenAI fixture missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");
    const cell = testCell(workspace, "> (openai.max + openai:not-a-real-model).best");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const parsed = parse(workspace, cell);
    const result = await executeCellRun(cell, parsed, workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Unknown model `not-a-real-model` for OpenAI");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects grouped routes with too many unique provider/model targets before API calls", async () => {
    const workspace = createLiveWorkspace();
    const providers = [];
    workspace.settings.providers = [];

    for (let index = 1; index <= 9; index += 1) {
      const provider = createProviderSettings("openrouter", index);
      provider.alias = `or${index}`;
      provider.label = `OpenRouter ${index}`;
      workspace.settings.providers.push(provider);
      providers.push(provider);
    }

    providers.forEach((provider, index) => {
      provider.enabled = true;
      provider.apiKeyMasked = `sk-or-...${index}`;
      writeProviderSecret(provider.id, `sk-or-test-${index}`);
    });

    const route = providers.map((provider) => `${provider.alias}.max`).join(" + ");
    const cell = testCell(workspace, `> (${route}).ensemble`);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("grouped routes support up to 8 unique provider/model targets");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a provider whose last balance check is in an error state", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    if (!openAi) throw new Error("OpenAI fixture missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    openAi.balance = { state: "error", message: "Insufficient credits." };
    writeProviderSecret(openAi.id, "sk-test-openai");
    const cell = testCell(workspace, "> openai.max");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("OpenAI balance check failed: Insufficient credits.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat a successful balance check as a linked key", async () => {
    const workspace = createLiveWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    if (!openAi) throw new Error("OpenAI fixture missing");

    openAi.apiKeyMasked = "";
    openAi.balance = { state: "ok", message: "Balance ok." };
    const cell = testCell(workspace, "> openai.max");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("no API key is linked for OpenAI");
    expect(result.output).not.toContain("Balance ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports provider billing or quota API failures clearly", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ error: { message: "insufficient_quota: billing hard limit reached" } }, 402),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Provider error (OpenAI / gpt-4o): insufficient_quota: billing hard limit reached");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("creates image artifacts through the OpenAI Images API", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai\n@image -png output_{01..02}.png");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "aW1hZ2Ux" }, { b64_json: "aW1hZ2Uy" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.output).toContain("Created:");
    expect(result.artifacts.map((artifact) => artifact.displayName)).toEqual(["output_01.png", "output_02.png"]);
    expect(result.artifacts.map((artifact) => artifact.mimeType)).toEqual(["image/png", "image/png"]);
    expect(result.artifacts.map((artifact) => artifact.content)).toEqual(["aW1hZ2Ux", "aW1hZ2Uy"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
    expect(body).toMatchObject({
      model: "gpt-image-1",
      n: 2,
      output_format: "png",
      background: "transparent",
    });
  });

  it("lets the @image range contract override conflicting prose image counts", async () => {
    const workspace = createLiveWorkspace();
    const cell = {
      ...testCell(workspace, "> openai\n@image -png output_{01..03}.png"),
      promptBody: "Create exactly two transparent PNG images from the references.",
    };
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "aW1nMQ==" }, { b64_json: "aW1nMg==" }, { b64_json: "aW1nMw==" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(body.prompt).toContain("Create exactly two transparent PNG images");
    expect(body.prompt).toContain("- Generate 3 images.");
    expect(body.prompt).toContain("- Target artifact names: output_01.png, output_02.png, output_03.png.");
    expect(body.n).toBe(3);
    expect(result.artifacts.map((artifact) => artifact.displayName)).toEqual(["output_01.png", "output_02.png", "output_03.png"]);
  });

  it("fails clearly when an image provider returns fewer images than the declared range", async () => {
    const workspace = createLiveWorkspace();
    const cell = {
      ...testCell(workspace, "> openai\n@image -png output_{01..03}.png"),
      promptBody: "Create exactly two transparent PNG images from the references.",
    };
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "aW1nMQ==" }, { b64_json: "aW1nMg==" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Image provider error (OpenAI / gpt-image-1): OpenAI returned 2 image(s), but 3 were requested.");
  });

  it("uses explicit OpenAI image model routes for image artifacts", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai:gpt-image-1\n@image -webp icon.webp");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "aWNvbg==" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(result.artifacts[0]).toMatchObject({
      displayName: "icon.webp",
      mimeType: "image/webp",
      content: "aWNvbg==",
    });
    expect(body).toMatchObject({
      model: "gpt-image-1",
      output_format: "webp",
      background: "transparent",
    });
  });

  it("uses OpenAI image edits when image attachments are present", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai\n@image -png normalized.png");
    cell.attachments = [
      {
        id: "attachment_ref",
        cellId: cell.id,
        displayName: "reference.png",
        extension: ".png",
        mimeType: "image/png",
        sizeBytes: 4,
        content: "iVBORw==",
        encoding: "base64",
        createdAt: "2026-06-23T00:00:00.000Z",
      },
    ];
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "bmV3aW1hZ2U=" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;

    expect(result.status).toBe("completed");
    expect(result.artifacts[0]).toMatchObject({
      displayName: "normalized.png",
      mimeType: "image/png",
      content: "bmV3aW1hZ2U=",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/edits");
    expect(body.get("model")).toBe("gpt-image-1");
    expect(body.get("n")).toBe("1");
    expect(body.get("output_format")).toBe("png");
    expect(body.getAll("image[]")).toHaveLength(1);
  });

  it("uses the selected OpenRouter provider for image outputs", async () => {
    const workspace = createLiveWorkspace();
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (!openRouter) throw new Error("OpenRouter fixture missing");

    openRouter.enabled = true;
    openRouter.apiKeyMasked = "sk-or-...test";
    openRouter.imageModel = "x-ai/grok-imagine-image-quality";
    writeProviderSecret(openRouter.id, "sk-or-test");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const cell = testCell(workspace, "> openrouter.max\n@image -png output.png");
    cell.attachments = [
      {
        id: "attachment_ref",
        cellId: cell.id,
        displayName: "reference.png",
        extension: ".png",
        mimeType: "image/png",
        sizeBytes: 4,
        content: "iVBORw==",
        encoding: "base64",
        createdAt: "2026-06-23T00:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ b64_json: "b3BlbnJvdXRlcl9pbWFnZQ==" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

    expect(result.status).toBe("completed");
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/images");
    expect(body).toMatchObject({
      model: "x-ai/grok-imagine-image-quality",
      n: 1,
      output_format: "png",
      background: "transparent",
    });
    expect(body.input_references).toHaveLength(1);
    expect(body.input_references[0].image_url.url).toContain("data:image/png;base64,iVBORw==");
    expect(result.artifacts[0]).toMatchObject({
      displayName: "output.png",
      mimeType: "image/png",
      content: "b3BlbnJvdXRlcl9pbWFnZQ==",
    });
  });

  it("stops live provider execution when the latency constraint expires", async () => {
    vi.useFakeTimers();

    try {
      const workspace = createLiveWorkspace();
      const cell = testCell(workspace, "> openai.max\n< latency <= 1s");
      workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
      writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const run = executeCellRun(cell, parse(workspace, cell), workspace.settings);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await run;

      expect(result.status).toBe("timeout");
      expect(result.output).toContain("provider did not respond within 1s");
      expect(result.run.summary).toBe("Provider latency limit exceeded.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows provider API detail errors as diagnostics instead of raw JSON output", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ detail: "Unsupported content type" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Provider error (OpenAI / gpt-4o): Unsupported content type");
    expect(result.output).not.toContain('{"detail"');
  });

  it("fails clearly when a provider only has a masked key reference", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("has only a masked key reference");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use a stored secret unless the workspace also marks the provider as linked", async () => {
    const workspace = createLiveWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.output).toContain("no API key is linked for OpenAI");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createLiveWorkspace(): WorkspaceState {
  const workspace = createInitialWorkspace();
  const fetchedAt = "2026-07-07T00:00:00.000Z";
  const catalogs: Record<string, { label: string; value: string }[]> = {
    openai: [
      { label: "GPT-4o", value: "gpt-4o" },
      { label: "GPT-4o mini", value: "gpt-4o-mini" },
      { label: "GPT Image 1", value: "gpt-image-1" },
    ],
    anthropic: [
      { label: "Claude Sonnet latest", value: "claude-sonnet-latest" },
      { label: "Claude Haiku latest", value: "claude-haiku-latest" },
    ],
    openrouter: [
      { label: "OpenRouter Auto", value: "openrouter/auto" },
      { label: "OpenRouter Fusion", value: "openrouter/fusion" },
      { label: "Anthropic Claude Sonnet latest", value: "~anthropic/claude-sonnet-latest" },
      { label: "Anthropic Claude Haiku latest", value: "~anthropic/claude-haiku-latest" },
      { label: "OpenAI GPT-4o", value: "openai/gpt-4o" },
      { label: "Google Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
      { label: "xAI Grok 4", value: "x-ai/grok-4" },
      { label: "xAI Grok Imagine Image Quality", value: "x-ai/grok-imagine-image-quality" },
    ],
    gemini: [
      { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
      { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
    ],
    xai: [
      { label: "Grok 4", value: "grok-4" },
      { label: "Grok 3 mini", value: "grok-3-mini" },
    ],
    deepseek: [
      { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
      { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
    ],
  };

  workspace.settings.providers.forEach((provider) => {
    const catalog = catalogs[provider.provider];
    if (!catalog) return;
    provider.modelCatalog = catalog;
    provider.modelCatalogUpdatedAt = fetchedAt;
    provider.modelCatalogSource = provider.provider === "openrouter" ? "public-api" : "provider-api";
  });

  return workspace;
}

function testCell(workspace: WorkspaceState, controlHeader: string): NotebookCell {
  return {
    ...workspace.projects[0].notebooks[0].cells[0],
    controlHeader,
    promptBody: "Return a short live answer.",
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

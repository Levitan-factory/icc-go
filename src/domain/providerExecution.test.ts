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
    const workspace = createInitialWorkspace();
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
      model: "gpt-5.5",
      input: cell.promptBody,
      store: false,
    });
  });

  it("resolves a provider-only route through the provider auto/default profile", async () => {
    const workspace = createInitialWorkspace();
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
      model: "gpt-5.4-mini",
    });
  });

  it("accepts OpenAI Responses payloads with a null error field", async () => {
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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

  it("uses the first enabled linked provider when a cell has no explicit route", async () => {
    const workspace = createInitialWorkspace();
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

  it("calls Anthropic Messages API for Claude aliases", async () => {
    const workspace = createInitialWorkspace();
    const provider = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    if (!provider) throw new Error("Anthropic fixture missing");

    provider.enabled = true;
    provider.apiKeyMasked = "sk-ant-...test";
    writeProviderSecret(provider.id, "sk-ant-test");

    const cell = testCell(workspace, "> claude.max");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ content: [{ type: "text", text: "Live Anthropic answer." }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Live Anthropic answer.");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
    });
    expect(body).toMatchObject({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: cell.promptBody }],
    });
  });

  it("calls Gemini generateContent for Gemini routes", async () => {
    const workspace = createInitialWorkspace();
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
      generationConfig: { maxOutputTokens: 1024 },
    });
  });

  it("calls xAI chat completions for xAI routes", async () => {
    const workspace = createInitialWorkspace();
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
      model: "grok-4.3",
      messages: [{ role: "user", content: cell.promptBody }],
      stream: false,
    });
  });

  it("calls DeepSeek chat completions for DeepSeek routes", async () => {
    const workspace = createInitialWorkspace();
    const provider = createProviderSettings("deepseek");
    workspace.settings.providers.push(provider);

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
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: cell.promptBody }],
      stream: false,
    });
  });

  it("runs grouped .best routes through candidates and the configured selector", async () => {
    const workspace = createInitialWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    if (!openAi || !anthropic) throw new Error("Provider fixtures missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");

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
      if (url === "https://api.anthropic.com/v1/messages") {
        return jsonResponse({ content: [{ type: "text", text: "Anthropic candidate answer." }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Anthropic candidate answer.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts loose selector answers for grouped .best routes", async () => {
    const workspace = createInitialWorkspace();
    const openAi = workspace.settings.providers.find((candidate) => candidate.provider === "openai");
    const anthropic = workspace.settings.providers.find((candidate) => candidate.provider === "anthropic");
    if (!openAi || !anthropic) throw new Error("Provider fixtures missing");

    openAi.apiKeyMasked = "sk-proj-...test";
    anthropic.apiKeyMasked = "sk-ant-...test";
    writeProviderSecret(openAi.id, "sk-test-openai");
    writeProviderSecret(anthropic.id, "sk-ant-test");

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
      if (url === "https://api.anthropic.com/v1/messages") {
        return jsonResponse({ content: [{ type: "text", text: "Anthropic candidate answer." }] });
      }
      return jsonResponse({ error: { message: `Unexpected URL ${url}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("OpenAI candidate answer.");
  });

  it("creates image artifacts through the OpenAI Images API", async () => {
    const workspace = createInitialWorkspace();
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
      model: "gpt-image-1.5",
      n: 2,
      output_format: "png",
      background: "transparent",
    });
  });

  it("lets the @image range contract override conflicting prose image counts", async () => {
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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
    expect(result.output).toContain("Image provider error (OpenAI / gpt-image-1.5): OpenAI returned 2 image(s), but 3 were requested.");
  });

  it("uses explicit OpenAI image model routes for image artifacts", async () => {
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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
    expect(body.get("model")).toBe("gpt-image-1.5");
    expect(body.get("n")).toBe("1");
    expect(body.get("output_format")).toBe("png");
    expect(body.getAll("image[]")).toHaveLength(1);
  });

  it("uses the selected OpenRouter provider for image outputs", async () => {
    const workspace = createInitialWorkspace();
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
      const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
    const cell = testCell(workspace, "> openai.max");
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
    writeProviderSecret(workspace.settings.providers[0].id, "sk-test-openai");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ detail: "Unsupported content type" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCellRun(cell, parse(workspace, cell), workspace.settings);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Provider error (OpenAI / gpt-5.5): Unsupported content type");
    expect(result.output).not.toContain('{"detail"');
  });

  it("fails clearly when a provider only has a masked key reference", async () => {
    const workspace = createInitialWorkspace();
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
    const workspace = createInitialWorkspace();
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

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

import { describe, expect, it } from "vitest";
import {
  autoModelProfiles,
  classifyRegistryModelCapability,
  chooseAutoModelForProvider,
  chooseStrongestModelForProfile,
  normalizeKnownModelAlias,
  resolveModelProfileForProvider,
} from "./providerModelRegistry";
import type { ProviderSettings } from "./types";

describe("provider model registry", () => {
  it("keeps provider-only OpenAI routes on the Auto model profile instead of API list order", () => {
    const choices = [
      { label: "GPT-4o", value: "gpt-4o" },
      { label: "GPT-4o mini", value: "gpt-4o-mini" },
    ];

    expect(chooseAutoModelForProvider("openai", choices, "default")).toBe("gpt-4o-mini");
    expect(chooseAutoModelForProvider("openai", choices, "max")).toBe(autoModelProfiles.max);
  });

  it("migrates stale current model ids before validating the provider catalog", () => {
    const choices = [{ label: "GPT-4o mini", value: "gpt-4o-mini" }];

    expect(chooseAutoModelForProvider("openai", choices, "default", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("uses OpenRouter native auto routing for provider-only OpenRouter routes", () => {
    const choices = [
      { label: "Anthropic Claude Sonnet latest", value: "~anthropic/claude-sonnet-latest" },
      { label: "Auto router", value: "openrouter/auto" },
    ];

    expect(chooseAutoModelForProvider("openrouter", choices, "default")).toBe("openrouter/auto");
    expect(chooseAutoModelForProvider("openrouter", choices, "max")).toBe("openrouter/auto");
  });

  it("keeps Anthropic .max on the strongest current profile instead of stale valid ids", () => {
    const choices = [
      { label: "Claude Haiku latest latest", value: "claude-haiku-latest" },
      { label: "Claude Sonnet latest latest", value: "claude-sonnet-latest" },
    ];

    expect(chooseAutoModelForProvider("anthropic", choices, "max", "claude-sonnet-latest")).toBe(autoModelProfiles.max);
    expect(chooseAutoModelForProvider("anthropic", choices, "ensemble", "claude-sonnet-latest")).toBe(autoModelProfiles.ensemble);
    expect(chooseAutoModelForProvider("anthropic", choices, "default", "claude-sonnet-latest")).toBe("claude-sonnet-latest");
  });

  it("resolves managed .max from the latest provider catalog instead of a hardcoded model id", () => {
    const provider: ProviderSettings = {
      id: "provider_anthropic",
      provider: "anthropic",
      label: "Anthropic",
      alias: "claude",
      enabled: true,
      apiKeyMasked: "sk-ant-...test",
      defaultModel: "claude-sonnet-latest",
      maxModel: autoModelProfiles.max,
      ensembleModel: autoModelProfiles.ensemble,
      imageModel: "",
      cheapModel: "claude-haiku-latest",
      fastModel: "claude-haiku-latest",
      codeModel: "claude-sonnet-latest",
      contextLimit: 200000,
      modelCatalog: [
        { label: "Claude Haiku latest", value: "claude-haiku-latest" },
        { label: "Claude Sonnet latest", value: "claude-sonnet-latest" },
      ],
      modelCatalogUpdatedAt: "2026-07-05T00:00:00.000Z",
      modelCatalogSource: "provider-api",
      balance: { state: "ok", message: "Balance ok" },
    };

    const resolution = resolveModelProfileForProvider(provider, "max");

    expect(resolution.model).toBe("claude-sonnet-latest");
    expect(resolution.source).toBe("auto-provider-api");
    expect(resolution.profile).toBe("max");
  });

  it("keeps non-chat catalog entries out of text .max routing", () => {
    const xaiChoices = [
      { label: "Grok 3 mini", value: "grok-3-mini" },
      { label: "Grok Imagine quality", value: "grok-imagine-image-quality" },
      { label: "Grok 4", value: "grok-4" },
    ];

    expect(chooseStrongestModelForProfile("xai", xaiChoices, "max")).toBe("grok-4");
  });

  it("classifies provider catalogs before profile ranking", () => {
    expect(classifyRegistryModelCapability("gpt-4o")).toBe("text");
    expect(classifyRegistryModelCapability("openai/gpt-image-1")).toBe("image");
    expect(classifyRegistryModelCapability("grok-4")).toBe("text");
    expect(classifyRegistryModelCapability("text-embedding-3-large")).toBe("embedding");
    expect(classifyRegistryModelCapability("rerank-english-v3")).toBe("rerank");
  });

  it("treats previous generated max settings as managed auto at runtime", () => {
    const provider: ProviderSettings = {
      id: "provider_openai",
      provider: "openai",
      label: "OpenAI",
      alias: "openai",
      enabled: true,
      apiKeyMasked: "sk-proj-...test",
      defaultModel: "gpt-4o-mini",
      maxModel: "gpt-4o",
      ensembleModel: "gpt-4o",
      imageModel: "gpt-image-1",
      cheapModel: "gpt-4o-mini",
      fastModel: "gpt-4o-mini",
      codeModel: "gpt-4o",
      contextLimit: 200000,
      modelCatalog: [
        { label: "GPT-4o", value: "gpt-4o" },
        { label: "GPT-6 Pro", value: "gpt-6-pro" },
      ],
      modelCatalogUpdatedAt: "2026-07-05T00:00:00.000Z",
      modelCatalogSource: "provider-api",
      balance: { state: "ok", message: "Balance ok" },
    };

    const resolution = resolveModelProfileForProvider(provider, "max");

    expect(resolution.model).toBe("gpt-6-pro");
    expect(resolution.source).toBe("auto-provider-api");
  });

  it("migrates retired Anthropic profile aliases", () => {
    expect(normalizeKnownModelAlias("claude-fable-5")).toBe("claude-sonnet-latest");
    expect(normalizeKnownModelAlias("claude-opus-4-6")).toBe("claude-sonnet-latest");
    expect(normalizeKnownModelAlias("anthropic/claude-opus-4.6")).toBe("~anthropic/claude-opus-latest");
  });
});

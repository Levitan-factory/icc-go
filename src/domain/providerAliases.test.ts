import { describe, expect, it } from "vitest";
import {
  createProviderSettings,
  normalizeOrchestrationSettings,
  normalizeProviderSettings,
  providerKindLabel,
  providerKinds,
} from "./providerAliases";
import type { ProviderSettings } from "./types";

describe("provider aliases", () => {
  it("uses Anthropic as provider kind and Claude as the default routing alias", () => {
    const provider = createProviderSettings("anthropic");

    expect(providerKinds).toContain("anthropic");
    expect(providerKinds).not.toContain("claude");
    expect(providerKindLabel("anthropic")).toBe("Anthropic");
    expect(provider.label).toBe("Anthropic");
    expect(provider.alias).toBe("Claude");
  });

  it("migrates legacy Claude provider settings to Anthropic without breaking the alias", () => {
    const legacy = normalizeProviderSettings({
      id: "provider_claude",
      provider: "claude",
      label: "Claude",
      alias: "Claude",
      enabled: true,
      apiKeyMasked: "",
      defaultModel: "claude-sonnet-4-6",
      maxModel: "claude-opus-4-6",
      ensembleModel: "claude-opus-4-6",
      cheapModel: "claude-haiku-4-5-20251001",
      fastModel: "claude-haiku-4-5-20251001",
      codeModel: "claude-sonnet-4-6",
      contextLimit: 200000,
      balance: { state: "unchecked", message: "Balance has not been checked yet." },
    } as unknown as ProviderSettings);

    expect(legacy.provider).toBe("anthropic");
    expect(legacy.label).toBe("Anthropic");
    expect(legacy.alias).toBe("Claude");
  });

  it("migrates stale provider model defaults to the current registry aliases", () => {
    const legacy = normalizeProviderSettings({
      id: "provider_openai",
      provider: "openai",
      label: "OpenAI",
      alias: "OpenAI",
      enabled: true,
      apiKeyMasked: "",
      defaultModel: "gpt-5.5-mini",
      maxModel: "gpt-5.5",
      ensembleModel: "gpt-5.5",
      cheapModel: "gpt-5.5-mini",
      fastModel: "gpt-5.5-nano",
      codeModel: "gpt-5.5-code",
      contextLimit: 200000,
      balance: { state: "unchecked", message: "Balance has not been checked yet." },
    } as unknown as ProviderSettings);

    expect(legacy.defaultModel).toBe("gpt-5.4-mini");
    expect(legacy.cheapModel).toBe("gpt-5.4-nano");
    expect(legacy.fastModel).toBe("gpt-5.4-nano");
    expect(legacy.codeModel).toBe("gpt-5.3-codex");
  });

  it("migrates stale orchestration model refs", () => {
    const normalized = normalizeOrchestrationSettings({
      selectorModel: "openai:gpt-5.5-mini",
      synthesisModel: "claude:claude-sonnet-4-6",
      evaluatorModel: "openai:gpt-5.5-nano",
      defaultCostCapUsd: 3.33,
      defaultLatencyCapSec: 180,
      defaultLoopIterations: 3,
      maxLoopIterations: 10,
      fallbackProvider: "OpenAI",
      retryPolicy: "once",
    });

    expect(normalized.selectorModel).toBe("openai:gpt-5.4-mini");
    expect(normalized.evaluatorModel).toBe("openai:gpt-5.4-nano");
  });
});

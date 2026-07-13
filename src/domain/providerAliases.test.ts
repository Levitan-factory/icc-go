import { describe, expect, it } from "vitest";
import {
  createProviderSettings,
  normalizeOrchestrationSettings,
  normalizeProviderSettings,
  providerKindLabel,
  providerKinds,
} from "./providerAliases";
import { autoModelProfiles } from "./providerModelRegistry";
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
      defaultModel: "claude-sonnet-latest",
      maxModel: "claude-sonnet-latest",
      ensembleModel: "claude-sonnet-latest",
      cheapModel: "claude-haiku-4-5-20251001",
      fastModel: "claude-haiku-4-5-20251001",
      codeModel: "claude-sonnet-latest",
      contextLimit: 200000,
      balance: { state: "unchecked", message: "Balance has not been checked yet." },
    } as unknown as ProviderSettings);

    expect(legacy.provider).toBe("anthropic");
    expect(legacy.label).toBe("Anthropic");
    expect(legacy.alias).toBe("Claude");
    expect(legacy.defaultModel).toBe("claude-sonnet-latest");
    expect(legacy.maxModel).toBe(autoModelProfiles.max);
    expect(legacy.ensembleModel).toBe(autoModelProfiles.ensemble);
    expect(legacy.codeModel).toBe("claude-sonnet-latest");
  });

  it("migrates stale provider model defaults to the current registry aliases", () => {
    const legacy = normalizeProviderSettings({
      id: "provider_openai",
      provider: "openai",
      label: "OpenAI",
      alias: "OpenAI",
      enabled: true,
      apiKeyMasked: "",
      defaultModel: "gpt-4o-mini",
      maxModel: "gpt-4o",
      ensembleModel: "gpt-4o",
      cheapModel: "gpt-4o-mini",
      fastModel: "gpt-4o-mini",
      codeModel: "gpt-4o",
      contextLimit: 200000,
      balance: { state: "unchecked", message: "Balance has not been checked yet." },
    } as unknown as ProviderSettings);

    expect(legacy.defaultModel).toBe("gpt-4o-mini");
    expect(legacy.maxModel).toBe(autoModelProfiles.max);
    expect(legacy.ensembleModel).toBe(autoModelProfiles.ensemble);
    expect(legacy.cheapModel).toBe("gpt-4o-mini");
    expect(legacy.fastModel).toBe("gpt-4o-mini");
    expect(legacy.codeModel).toBe("gpt-4o");
  });

  it("migrates previously generated xAI max picks back to managed auto routing", () => {
    const legacy = normalizeProviderSettings({
      id: "provider_xai",
      provider: "xai",
      label: "xAI",
      alias: "xAI",
      enabled: true,
      apiKeyMasked: "",
      defaultModel: "grok-4",
      maxModel: "grok-4",
      ensembleModel: "grok-4",
      cheapModel: "grok-3-mini",
      fastModel: "grok-3-mini",
      codeModel: "grok-4",
      contextLimit: 256000,
      balance: { state: "unchecked", message: "Balance has not been checked yet." },
    } as unknown as ProviderSettings);

    expect(legacy.maxModel).toBe(autoModelProfiles.max);
    expect(legacy.ensembleModel).toBe(autoModelProfiles.ensemble);
  });

  it("migrates stale orchestration model refs", () => {
    const normalized = normalizeOrchestrationSettings({
      selectorModel: "openai:gpt-4o-mini",
      synthesisModel: "claude:claude-sonnet-latest",
      evaluatorModel: "openai:gpt-4o-mini",
      defaultCostCapUsd: 3.33,
      defaultLatencyCapSec: 180,
      defaultLoopIterations: 3,
      maxLoopIterations: 10,
      fallbackProvider: "OpenAI",
      retryPolicy: "once",
    });

    expect(normalized.selectorModel).toBe("openai:gpt-4o-mini");
    expect(normalized.synthesisModel).toBe("claude:claude-sonnet-latest");
    expect(normalized.evaluatorModel).toBe("openai:gpt-4o-mini");
  });
});

import { createId, nowIso } from "../lib/id";
import { knownModelValuesForProvider } from "./modelCatalog";
import {
  normalizeKnownModelAlias,
  normalizeKnownModelRef,
  providerPresets,
  uniqueRegistryModelChoices,
} from "./providerModelRegistry";
import type { ProviderKind, ProviderSettings, WorkspaceSettings } from "./types";

export const providerKinds: ProviderKind[] = [
  "openai",
  "anthropic",
  "gemini",
  "xai",
  "mistral",
  "deepseek",
  "openrouter",
  "local",
  "custom",
];

export function providerAliasOptions(settings: WorkspaceSettings) {
  return settings.providers.map((provider) => ({
    id: provider.id,
    alias: provider.alias?.trim() || provider.label || provider.id,
    label: provider.label,
    provider: provider.provider,
    models: knownModelValuesForProvider(provider),
  }));
}

export function normalizeProviderSettings(provider: ProviderSettings): ProviderSettings {
  const rawProviderKind = String(provider.provider ?? provider.id ?? "").trim().toLowerCase();
  const providerKind = normalizeProviderKind(rawProviderKind);
  const preset = providerPresets[providerKind];
  const id = provider.id?.trim() || createId("provider");
  const rawLabel = provider.label?.trim();
  const label = rawProviderKind === "claude" && (!rawLabel || rawLabel === "Claude") ? preset.label : rawLabel || preset.label;

  return {
    ...provider,
    id,
    provider: providerKind,
    label,
    alias: provider.alias?.trim() || provider.label || preset.alias || id,
    enabled: Boolean(provider.enabled),
    apiKeyMasked: provider.apiKeyMasked ?? "",
    defaultModel: normalizeProfileModel(provider.defaultModel, preset.defaultModel),
    maxModel: normalizeProfileModel(provider.maxModel, preset.maxModel),
    ensembleModel: normalizeProfileModel(provider.ensembleModel || provider.maxModel, preset.ensembleModel),
    imageModel: normalizeProfileModel(provider.imageModel, preset.imageModel),
    cheapModel: normalizeProfileModel(provider.cheapModel, preset.cheapModel),
    fastModel: normalizeProfileModel(provider.fastModel, preset.fastModel),
    codeModel: normalizeProfileModel(provider.codeModel, preset.codeModel),
    contextLimit: Number(provider.contextLimit) || preset.contextLimit,
    modelCatalog: provider.modelCatalog ? uniqueRegistryModelChoices(provider.modelCatalog) : undefined,
    modelCatalogUpdatedAt: provider.modelCatalogUpdatedAt,
    modelCatalogSource: provider.modelCatalogSource,
    balance: provider.balance ?? {
      state: "unchecked",
      message: "Balance has not been checked yet.",
    },
  };
}

function normalizeProfileModel(rawModel: string | undefined, fallbackModel: string): string {
  const raw = rawModel?.trim();
  if (!raw) return fallbackModel;
  if (raw === "gpt-5.5-mini" && fallbackModel === "gpt-5.4-nano") return fallbackModel;
  return normalizeKnownModelAlias(raw);
}

export function createProviderSettings(provider: ProviderKind, index = 1): ProviderSettings {
  const preset = providerPresets[provider];
  const suffix = index > 1 ? ` ${index}` : "";

  return normalizeProviderSettings({
    id: createId("provider"),
    provider,
    label: `${preset.label}${suffix}`,
    alias: `${preset.alias}${suffix}`.replace(/\s+/g, ""),
    enabled: true,
    apiKeyMasked: "",
    defaultModel: preset.defaultModel,
    maxModel: preset.maxModel,
    ensembleModel: preset.ensembleModel,
    imageModel: preset.imageModel,
    cheapModel: preset.cheapModel,
    fastModel: preset.fastModel,
    codeModel: preset.codeModel,
    contextLimit: preset.contextLimit,
    balance: {
      state: "unchecked",
      message: "Balance has not been checked yet.",
      checkedAt: nowIso(),
    },
  });
}

export function providerKindLabel(provider: ProviderKind): string {
  return providerPresets[provider]?.label ?? provider;
}

export function normalizeOrchestrationSettings(settings: WorkspaceSettings["orchestration"]): WorkspaceSettings["orchestration"] {
  return {
    ...settings,
    selectorModel: normalizeKnownModelRef(settings.selectorModel),
    synthesisModel: normalizeKnownModelRef(settings.synthesisModel),
    evaluatorModel: normalizeKnownModelRef(settings.evaluatorModel),
  };
}

export function fallbackProvider(settings: WorkspaceSettings): ProviderSettings | undefined {
  return settings.providers.find((provider) => provider.enabled) ?? settings.providers[0];
}

export function providerModelForProfile(
  provider: ProviderSettings | undefined,
  profile: string | undefined,
  explicitModel?: string,
): string {
  if (explicitModel) return explicitModel;
  if (!provider) return profile || "workspace default";

  switch (profile) {
    case "max":
      return provider.maxModel;
    case "ensemble":
      return provider.ensembleModel;
    case "cheap":
      return provider.cheapModel;
    case "fast":
      return provider.fastModel;
    case "code":
      return provider.codeModel;
    case "default":
    case undefined:
      return provider.defaultModel;
    default:
      return provider.defaultModel;
  }
}

function normalizeProviderKind(value: string): ProviderKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  return providerKinds.includes(normalized as ProviderKind) ? (normalized as ProviderKind) : "custom";
}

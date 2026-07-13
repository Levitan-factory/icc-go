import type { ProviderKind, ProviderSettings } from "./types";

export interface RegistryModelChoice {
  label: string;
  value: string;
}

export interface ProviderPreset {
  label: string;
  alias: string;
  defaultModel: string;
  maxModel: string;
  ensembleModel: string;
  imageModel: string;
  cheapModel: string;
  fastModel: string;
  codeModel: string;
  contextLimit: number;
}

export interface ProviderModelRefresh {
  choices: RegistryModelChoice[];
  fetchedAt: string;
  source: "provider-api" | "public-api";
}

export const providerModelRegistryVersion = "2026-07-09";

export type ModelProfileName = "default" | "max" | "ensemble" | "cheap" | "fast" | "code" | "image";
export type RegistryModelCapability =
  | "text"
  | "image"
  | "audio"
  | "embedding"
  | "moderation"
  | "rerank"
  | "agent"
  | "vision-only";

export interface ModelProfileResolution {
  model: string;
  source: "explicit" | "pinned" | "native-router" | "auto-provider-api" | "auto-public-api" | "auto-fallback";
  profile: ModelProfileName;
  catalogUpdatedAt?: string;
  policy?: string;
}

export const autoModelProfiles: Record<ModelProfileName, string> = {
  default: "auto:default",
  max: "auto:max",
  ensemble: "auto:ensemble",
  cheap: "auto:cheap",
  fast: "auto:fast",
  code: "auto:code",
  image: "auto:image",
};

const autoProfileLabels: Record<ModelProfileName, string> = {
  default: "Auto default",
  max: "Auto strongest",
  ensemble: "Auto ensemble",
  cheap: "Auto cheap",
  fast: "Auto fast",
  code: "Auto code",
  image: "Auto image",
};

const autoManagedProfiles = new Set<ModelProfileName>(["max", "ensemble"]);

const openAiTextModels: RegistryModelChoice[] = [
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
];

const openAiImageModels: RegistryModelChoice[] = [
  { label: "GPT Image 1", value: "gpt-image-1" },
  { label: "GPT Image 1 mini", value: "gpt-image-1-mini" },
  { label: "ChatGPT Image latest", value: "chatgpt-image-latest" },
];

const anthropicModels: RegistryModelChoice[] = [
  { label: "Claude Sonnet latest", value: "claude-sonnet-latest" },
  { label: "Claude Haiku latest", value: "claude-haiku-latest" },
];

const geminiModels: RegistryModelChoice[] = [
  { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
  { label: "Gemini 2.5 Flash Image", value: "gemini-2.5-flash-image-preview" },
];

const xAiModels: RegistryModelChoice[] = [
  { label: "Grok 4", value: "grok-4" },
  { label: "Grok 3 mini", value: "grok-3-mini" },
  { label: "Grok Imagine quality", value: "grok-imagine-image-quality" },
];

const openRouterCoreModels: RegistryModelChoice[] = [
  { label: "Auto router", value: "openrouter/auto" },
  { label: "Fusion ensemble", value: "openrouter/fusion" },
  { label: "OpenAI GPT-4o", value: "openai/gpt-4o" },
  { label: "OpenAI GPT-4o mini", value: "openai/gpt-4o-mini" },
  { label: "OpenAI GPT Image 1", value: "openai/gpt-image-1" },
  { label: "Anthropic Claude Opus latest", value: "~anthropic/claude-opus-latest" },
  { label: "Anthropic Claude Sonnet latest", value: "~anthropic/claude-sonnet-latest" },
  { label: "Anthropic Claude Haiku latest", value: "~anthropic/claude-haiku-latest" },
  { label: "Google Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
  { label: "Google Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
  { label: "DeepSeek Chat", value: "deepseek/deepseek-chat" },
  { label: "DeepSeek Reasoner", value: "deepseek/deepseek-reasoner" },
  { label: "xAI Grok 4", value: "x-ai/grok-4" },
  { label: "xAI Grok 3 mini", value: "x-ai/grok-3-mini" },
  { label: "xAI Grok Imagine quality", value: "x-ai/grok-imagine-image-quality" },
];

export const providerPresets: Record<ProviderKind, ProviderPreset> = {
	  openai: {
	    label: "OpenAI",
	    alias: "OpenAI",
	    defaultModel: "gpt-4o-mini",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "gpt-image-1",
    cheapModel: "gpt-4o-mini",
    fastModel: "gpt-4o-mini",
    codeModel: "gpt-4o",
    contextLimit: 200000,
  },
	  anthropic: {
	    label: "Anthropic",
	    alias: "Claude",
	    defaultModel: "claude-sonnet-latest",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "",
    cheapModel: "claude-haiku-latest",
    fastModel: "claude-haiku-latest",
    codeModel: "claude-sonnet-latest",
    contextLimit: 200000,
  },
	  gemini: {
	    label: "Gemini",
	    alias: "Gemini",
	    defaultModel: "gemini-2.5-pro",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "",
    cheapModel: "gemini-2.5-flash",
    fastModel: "gemini-2.5-flash",
    codeModel: "gemini-2.5-pro",
    contextLimit: 1000000,
  },
	  xai: {
	    label: "xAI",
	    alias: "xAI",
	    defaultModel: "grok-4",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "",
    cheapModel: "grok-3-mini",
    fastModel: "grok-3-mini",
    codeModel: "grok-4",
    contextLimit: 256000,
  },
	  mistral: {
	    label: "Mistral",
	    alias: "Mistral",
	    defaultModel: "mistral-large-latest",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "",
    cheapModel: "mistral-small-latest",
    fastModel: "mistral-small-latest",
    codeModel: "codestral-latest",
    contextLimit: 128000,
  },
	  deepseek: {
	    label: "DeepSeek",
	    alias: "DeepSeek",
	    defaultModel: "deepseek-chat",
	    maxModel: autoModelProfiles.max,
	    ensembleModel: autoModelProfiles.ensemble,
    imageModel: "",
    cheapModel: "deepseek-chat",
    fastModel: "deepseek-chat",
    codeModel: "deepseek-reasoner",
    contextLimit: 128000,
  },
  openrouter: {
    label: "OpenRouter",
    alias: "OpenRouter",
    defaultModel: "openrouter/auto",
    maxModel: "openrouter/auto",
    ensembleModel: "openrouter/fusion",
    imageModel: "",
    cheapModel: "openrouter/auto",
    fastModel: "openrouter/auto",
    codeModel: "openrouter/auto",
    contextLimit: 200000,
  },
  local: {
    label: "Local",
    alias: "Local",
    defaultModel: "local/default",
    maxModel: "local/max",
    ensembleModel: "local/ensemble",
    imageModel: "",
    cheapModel: "local/cheap",
    fastModel: "local/fast",
    codeModel: "local/code",
    contextLimit: 32000,
  },
  custom: {
    label: "Custom",
    alias: "Custom",
    defaultModel: "custom/default",
    maxModel: "custom/max",
    ensembleModel: "custom/ensemble",
    imageModel: "",
    cheapModel: "custom/cheap",
    fastModel: "custom/fast",
    codeModel: "custom/code",
    contextLimit: 128000,
  },
};

export const fallbackProviderModelCatalog: Partial<Record<ProviderKind, RegistryModelChoice[]>> = {
  openai: [...openAiTextModels, ...openAiImageModels],
  anthropic: anthropicModels,
  gemini: geminiModels,
  xai: xAiModels,
  mistral: [
    { label: "Mistral Large", value: "mistral-large-latest" },
    { label: "Mistral Small", value: "mistral-small-latest" },
    { label: "Codestral", value: "codestral-latest" },
  ],
  deepseek: [
    { label: "DeepSeek Chat", value: "deepseek-chat" },
    { label: "DeepSeek Reasoner", value: "deepseek-reasoner" },
  ],
  openrouter: openRouterCoreModels,
  local: [
    { label: "Local default", value: "local/default" },
    { label: "Local max", value: "local/max" },
    { label: "Local ensemble", value: "local/ensemble" },
    { label: "Local cheap", value: "local/cheap" },
    { label: "Local fast", value: "local/fast" },
    { label: "Local code", value: "local/code" },
  ],
  custom: [
    { label: "Custom default", value: "custom/default" },
    { label: "Custom max", value: "custom/max" },
    { label: "Custom ensemble", value: "custom/ensemble" },
    { label: "Custom cheap", value: "custom/cheap" },
    { label: "Custom fast", value: "custom/fast" },
    { label: "Custom code", value: "custom/code" },
  ],
};

// Migration-only aliases for old notebook/settings data. Current model choice
// must come from provider/OpenRouter catalogs, with fallbackProviderModelCatalog
// only as a safety net when live catalogs are unavailable.
const modelMigrations: Record<string, string> = {
  "gpt-5.5": "gpt-4o",
  "gpt-5.5-pro": "gpt-4o",
  "gpt-5.5-mini": "gpt-4o-mini",
  "gpt-5.5-nano": "gpt-4o-mini",
  "gpt-5.5-code": "gpt-4o",
  "gpt-5.4": "gpt-4o",
  "gpt-5.4-mini": "gpt-4o-mini",
  "gpt-5.4-nano": "gpt-4o-mini",
  "gpt-5.3-codex": "gpt-4o",
  "gpt-image-2": "gpt-image-1",
  "gpt-image-1.5": "gpt-image-1",
  "openai/gpt-5.5": "openai/gpt-4o",
  "openai/gpt-5.5-pro": "openai/gpt-4o",
  "openai/gpt-5.5-mini": "openai/gpt-4o-mini",
  "openai/gpt-5.5-nano": "openai/gpt-4o-mini",
  "openai/gpt-5.5-code": "openai/gpt-4o",
  "openai/gpt-5.4": "openai/gpt-4o",
  "openai/gpt-5.4-mini": "openai/gpt-4o-mini",
  "openai/gpt-5.4-nano": "openai/gpt-4o-mini",
  "openai/gpt-5.3-codex": "openai/gpt-4o",
  "openai/gpt-image-2": "openai/gpt-image-1",
  "openai/gpt-image-1.5": "openai/gpt-image-1",
  "claude-3-5-sonnet-latest": "claude-sonnet-latest",
  "claude-3-5-haiku-latest": "claude-haiku-latest",
  "claude-fable-5": "claude-sonnet-latest",
  "claude-opus-4-6": "claude-sonnet-latest",
  "claude-opus-4-7": "claude-sonnet-latest",
  "claude-opus-4-8": "claude-sonnet-latest",
  "claude-sonnet-5": "claude-sonnet-latest",
  "claude-sonnet-4-6": "claude-sonnet-latest",
  "claude-sonnet-4-5-20250929": "claude-sonnet-latest",
  "claude-haiku-4-5-20251001": "claude-haiku-latest",
  "anthropic/claude-3.5-sonnet": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-3-haiku": "~anthropic/claude-haiku-latest",
  "anthropic/claude-3-5-sonnet-latest": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-3-5-haiku-latest": "~anthropic/claude-haiku-latest",
  "anthropic/claude-fable-5": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-opus-4.8": "~anthropic/claude-opus-latest",
  "anthropic/claude-sonnet-5": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-sonnet-4.5": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-sonnet-4.6": "~anthropic/claude-sonnet-latest",
  "anthropic/claude-opus-4.5": "~anthropic/claude-opus-latest",
  "anthropic/claude-opus-4.6": "~anthropic/claude-opus-latest",
  "anthropic/claude-opus-4.7": "~anthropic/claude-opus-latest",
  "anthropic/claude-haiku-4-5-20251001": "~anthropic/claude-haiku-latest",
  "deepseek-v4-flash": "deepseek-chat",
  "deepseek-v4-pro": "deepseek-reasoner",
  "deepseek-coder": "deepseek-reasoner",
  "deepseek/deepseek-v4-flash": "deepseek/deepseek-chat",
  "deepseek/deepseek-v4-pro": "deepseek/deepseek-reasoner",
  "deepseek/deepseek-coder": "deepseek/deepseek-reasoner",
  "grok-4.3": "grok-4",
  "grok-4.20-multi-agent-0309": "grok-4",
  "grok-4.20-0309-reasoning": "grok-4",
  "grok-4.20-0309-non-reasoning": "grok-3-mini",
  "x-ai/grok-4.3": "x-ai/grok-4",
  "x-ai/grok-4.20-multi-agent-0309": "x-ai/grok-4",
  "x-ai/grok-4.20-0309-reasoning": "x-ai/grok-4",
  "x-ai/grok-4.20-0309-non-reasoning": "x-ai/grok-3-mini",
  "x-ai/grok-4-mini": "x-ai/grok-3-mini",
};

export function normalizeKnownModelAlias(model: string | undefined): string {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return "";
  return modelMigrations[trimmed] ?? modelMigrations[trimmed.toLowerCase()] ?? trimmed;
}

export function normalizeKnownModelRef(modelRef: string | undefined): string {
  const value = (modelRef ?? "").trim();
  if (!value) return "";
  const separator = value.indexOf(":");
  if (separator < 0) return normalizeKnownModelAlias(value);
  const provider = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  return `${provider}:${normalizeKnownModelAlias(model)}`;
}

export function normalizeModelChoice(choice: RegistryModelChoice): RegistryModelChoice {
  const value = normalizeKnownModelAlias(choice.value);
  return {
    label: choice.label || value,
    value,
  };
}

export function uniqueRegistryModelChoices(choices: RegistryModelChoice[]): RegistryModelChoice[] {
  const seen = new Set<string>();
  return choices.map(normalizeModelChoice).filter((choice) => {
    const key = choice.value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function modelCatalogForProvider(provider: ProviderSettings): RegistryModelChoice[] {
  return uniqueRegistryModelChoices([...(provider.modelCatalog ?? []), ...(fallbackProviderModelCatalog[provider.provider] ?? [])]);
}

export function isAutoModelProfile(model: string | undefined): boolean {
  return Boolean(autoModelProfileName(model));
}

export function autoModelProfileName(model: string | undefined): ModelProfileName | undefined {
  const value = (model ?? "").trim().toLowerCase();
  if (!value.startsWith("auto:")) return undefined;
  const profile = value.slice("auto:".length) as ModelProfileName;
  return Object.prototype.hasOwnProperty.call(autoModelProfiles, profile) ? profile : undefined;
}

export function autoModelProfileChoiceLabel(model: string): string | undefined {
  const profile = autoModelProfileName(model);
  return profile ? autoProfileLabels[profile] : undefined;
}

export function resolveModelProfileForProvider(
  provider: ProviderSettings,
  profile: string | undefined,
  explicitModel?: string,
): ModelProfileResolution {
  const profileName = normalizeProfileName(profile);
  const explicit = normalizeKnownModelAlias(explicitModel);
  if (explicit) {
    return {
      model: explicit,
      source: "explicit",
      profile: profileName,
      policy: "Explicit route model from the ICC header.",
    };
  }

  const configuredRawModel = modelSettingForProfile(provider, profileName);
  const configuredModel = normalizeKnownModelAlias(configuredRawModel);
  const autoProfile = autoModelProfileName(configuredModel);
  const shouldAutoResolve =
    Boolean(autoProfile) ||
    shouldTreatSettingAsManagedAuto(provider.provider, profileName, configuredRawModel) ||
    shouldTreatSettingAsManagedAuto(provider.provider, profileName, configuredModel);

  if (!shouldAutoResolve) {
    const pinnedModel = configuredModel || providerPresets[provider.provider].defaultModel;
    return {
      model: pinnedModel,
      source: provider.provider === "openrouter" && isOpenRouterNativeRouter(pinnedModel) ? "native-router" : "pinned",
      profile: profileName,
      policy: "Pinned model from workspace settings.",
    };
  }

  const targetProfile = autoProfile ?? profileName;
  if (provider.provider === "openrouter") {
    const model = targetProfile === "ensemble" ? "openrouter/fusion" : "openrouter/auto";
    return {
      model,
      source: "native-router",
      profile: targetProfile,
      catalogUpdatedAt: provider.modelCatalogUpdatedAt,
      policy: "OpenRouter native router selects the model at execution time.",
    };
  }

  const choices = provider.modelCatalog?.length ? uniqueRegistryModelChoices(provider.modelCatalog) : modelCatalogForProvider(provider);
  const model = chooseStrongestModelForProfile(provider.provider, choices, targetProfile) || fallbackResolvedModel(provider.provider, targetProfile);
  const source = sourceForResolvedModel(provider, model);

  return {
    model,
    source,
    profile: targetProfile,
    catalogUpdatedAt: provider.modelCatalogUpdatedAt,
    policy:
      source === "auto-fallback"
        ? "Auto profile resolved from ICC-GO fallback catalog because no fresh provider catalog is available."
        : "Auto profile resolved from the latest cached provider catalog.",
  };
}

export function chooseAutoModelForProvider(
  providerKind: ProviderKind,
  choices: RegistryModelChoice[],
  profile: ModelProfileName,
  current?: string,
): string {
  if (autoManagedProfiles.has(profile) && providerKind !== "local" && providerKind !== "custom") {
    return providerKind === "openrouter" ? (profile === "ensemble" ? "openrouter/fusion" : "openrouter/auto") : autoModelProfiles[profile];
  }

  const normalizedChoices = uniqueRegistryModelChoices(choices);
  const values = new Set(normalizedChoices.map((choice) => choice.value.toLowerCase()));
  const preset = providerPresets[providerKind];
  const presetModel = profile === "image" ? preset.imageModel : String(preset[`${profile}Model` as keyof ProviderPreset] ?? "");
  const presetPreferred = normalizeKnownModelAlias(presetModel);
  const preferred = [presetPreferred, ...profileModelPreferences(providerKind, profile)]
    .map(normalizeKnownModelAlias)
    .find((candidate) => candidate && (!values.size || values.has(candidate.toLowerCase())));

  if ((profile === "max" || profile === "ensemble") && preferred) return preferred;

  const normalizedCurrent = normalizeKnownModelAlias(current);
  if (normalizedCurrent && values.has(normalizedCurrent.toLowerCase())) return normalizedCurrent;
  if (preferred) return preferred;

  return normalizedChoices[0]?.value ?? presetPreferred;
}

function profileModelPreferences(
  providerKind: ProviderKind,
  profile: ModelProfileName,
): string[] {
  if (providerKind === "openai") {
    const byProfile = {
      default: ["gpt-4o-mini", "gpt-4o"],
      max: ["gpt-4o", "gpt-4o-mini"],
      ensemble: ["gpt-4o", "gpt-4o-mini"],
      cheap: ["gpt-4o-mini"],
      fast: ["gpt-4o-mini"],
      code: ["gpt-4o", "gpt-4o-mini"],
      image: ["gpt-image-1", "gpt-image-1-mini", "chatgpt-image-latest"],
    };
    return byProfile[profile];
  }

  if (providerKind === "openrouter") {
    const byProfile = {
      default: ["openrouter/auto"],
      max: ["openrouter/auto", "~anthropic/claude-opus-latest", "~anthropic/claude-sonnet-latest", "openai/gpt-4o"],
      ensemble: ["openrouter/fusion", "openrouter/auto"],
      cheap: ["openrouter/auto"],
      fast: ["openrouter/auto"],
      code: ["openrouter/auto", "~anthropic/claude-sonnet-latest", "~anthropic/claude-opus-latest", "openai/gpt-4o"],
      image: ["openai/gpt-image-1", "google/gemini-2.5-flash-image-preview", "x-ai/grok-imagine-image-quality"],
    };
    return byProfile[profile];
  }

  if (providerKind === "anthropic") {
    const byProfile = {
      default: ["claude-sonnet-latest", "claude-haiku-latest"],
      max: ["claude-sonnet-latest", "claude-haiku-latest"],
      ensemble: ["claude-sonnet-latest", "claude-haiku-latest"],
      cheap: ["claude-haiku-latest"],
      fast: ["claude-haiku-latest"],
      code: ["claude-sonnet-latest", "claude-haiku-latest"],
      image: [],
    };
    return byProfile[profile];
  }

  if (providerKind === "gemini") {
    const byProfile = {
      default: ["gemini-2.5-pro", "gemini-2.5-flash"],
      max: ["gemini-2.5-pro", "gemini-2.5-flash"],
      ensemble: ["gemini-2.5-pro", "gemini-2.5-flash"],
      cheap: ["gemini-2.5-flash"],
      fast: ["gemini-2.5-flash"],
      code: ["gemini-2.5-pro", "gemini-2.5-flash"],
      image: ["gemini-2.5-flash-image-preview"],
    };
    return byProfile[profile];
  }

  if (providerKind === "xai") {
    const byProfile = {
      default: ["grok-4", "grok-3-mini"],
      max: ["grok-4", "grok-3-mini"],
      ensemble: ["grok-4", "grok-3-mini"],
      cheap: ["grok-3-mini"],
      fast: ["grok-3-mini"],
      code: ["grok-4", "grok-3-mini"],
      image: ["grok-imagine-image-quality"],
    };
    return byProfile[profile];
  }

  if (providerKind === "mistral") {
    const byProfile = {
      default: ["mistral-large-latest", "mistral-small-latest"],
      max: ["mistral-large-latest", "mistral-small-latest"],
      ensemble: ["mistral-large-latest", "mistral-small-latest"],
      cheap: ["mistral-small-latest"],
      fast: ["mistral-small-latest"],
      code: ["codestral-latest", "mistral-large-latest"],
      image: [],
    };
    return byProfile[profile];
  }

  if (providerKind === "deepseek") {
    const byProfile = {
      default: ["deepseek-chat"],
      max: ["deepseek-reasoner", "deepseek-chat"],
      ensemble: ["deepseek-reasoner", "deepseek-chat"],
      cheap: ["deepseek-chat"],
      fast: ["deepseek-chat"],
      code: ["deepseek-reasoner", "deepseek-chat"],
      image: [],
    };
    return byProfile[profile];
  }

  return [];
}

function normalizeProfileName(profile: string | undefined): ModelProfileName {
  const normalized = (profile ?? "default").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(autoModelProfiles, normalized) ? (normalized as ModelProfileName) : "default";
}

function modelSettingForProfile(provider: ProviderSettings, profile: ModelProfileName): string {
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
    case "image":
      return provider.imageModel;
    case "default":
    default:
      return provider.defaultModel;
  }
}

function shouldTreatSettingAsManagedAuto(providerKind: ProviderKind, profile: ModelProfileName, model: string): boolean {
  if (!autoManagedProfiles.has(profile)) return false;
  if (providerKind === "local" || providerKind === "custom") return false;
  if (!model) return true;
  if (providerKind === "openrouter") return isOpenRouterNativeRouter(model);

  const normalized = normalizeKnownModelAlias(model).toLowerCase();
  const generatedValues = [
    String(providerPresets[providerKind][`${profile}Model` as keyof ProviderPreset] ?? ""),
    ...profileModelPreferences(providerKind, profile),
    ...legacyManagedAutoValues(providerKind, profile),
  ]
    .map(normalizeKnownModelAlias)
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  return generatedValues.includes(normalized);
}

export function normalizeManagedAutoModelSetting(
  providerKind: ProviderKind,
  profile: ModelProfileName,
  rawModel: string | undefined,
  fallbackModel: string,
): string {
  const raw = rawModel?.trim() || fallbackModel;
  if (shouldTreatSettingAsManagedAuto(providerKind, profile, raw)) {
    if (providerKind === "openrouter") return profile === "ensemble" ? "openrouter/fusion" : "openrouter/auto";
    return autoModelProfiles[profile];
  }

  const normalized = normalizeKnownModelAlias(raw);
  if (shouldTreatSettingAsManagedAuto(providerKind, profile, normalized)) {
    if (providerKind === "openrouter") return profile === "ensemble" ? "openrouter/fusion" : "openrouter/auto";
    return autoModelProfiles[profile];
  }

  return normalized || fallbackModel;
}

// Values that previous ICC-GO builds wrote as concrete profile models. Treating
// them as managed auto keeps old workspaces following the catalog instead of
// freezing on stale ids.
function legacyManagedAutoValues(providerKind: ProviderKind, profile: ModelProfileName): string[] {
  if (profile !== "max" && profile !== "ensemble") return [];
  if (providerKind === "openai") return ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-4o"];
  if (providerKind === "anthropic") {
    return [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-6",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-3-5-sonnet-latest",
    ];
  }
  if (providerKind === "gemini") return ["gemini-2.5-pro"];
  if (providerKind === "xai") return ["grok-4.3", "grok-4", "grok-4.20-multi-agent-0309", "grok-4.20-0309-reasoning"];
  if (providerKind === "mistral") return ["mistral-large-latest"];
  if (providerKind === "deepseek") return ["deepseek-v4-pro", "deepseek-reasoner"];
  return [];
}

function isOpenRouterNativeRouter(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "openrouter/auto" || normalized === "openrouter/fusion";
}

export function chooseStrongestModelForProfile(
  providerKind: ProviderKind,
  choices: RegistryModelChoice[],
  profile: ModelProfileName,
): string | undefined {
  const candidates = uniqueRegistryModelChoices(choices)
    .filter((choice) => isCompatibleProfileChoice(choice.value, profile))
    .map((choice) => ({
      choice,
      score: capabilityScore(providerKind, choice.value, profile),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score || a.choice.value.localeCompare(b.choice.value));

  return candidates[0]?.choice.value;
}

function fallbackResolvedModel(providerKind: ProviderKind, profile: ModelProfileName): string {
  if (providerKind === "openrouter") return profile === "ensemble" ? "openrouter/fusion" : "openrouter/auto";

  const fallbackChoices = fallbackProviderModelCatalog[providerKind] ?? [];
  const strongest = chooseStrongestModelForProfile(providerKind, fallbackChoices, profile);
  if (strongest) return strongest;

  const preset = providerPresets[providerKind];
  const presetValue = profile === "image" ? preset.imageModel : String(preset[`${profile}Model` as keyof ProviderPreset] ?? "");
  if (presetValue && !isAutoModelProfile(presetValue)) return presetValue;
  return preset.defaultModel || fallbackChoices[0]?.value || `${providerKind}/default`;
}

function sourceForResolvedModel(provider: ProviderSettings, model: string): ModelProfileResolution["source"] {
  const modelKey = model.trim().toLowerCase();
  const liveCatalogHasModel = Boolean(provider.modelCatalog?.some((choice) => normalizeKnownModelAlias(choice.value).toLowerCase() === modelKey));
  if (!liveCatalogHasModel) return "auto-fallback";
  return provider.modelCatalogSource === "public-api" ? "auto-public-api" : "auto-provider-api";
}

export function classifyRegistryModelCapability(model: string): RegistryModelCapability | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized || isAutoModelProfile(normalized)) return undefined;

  if (/multi[-_]?agent|agent[-_]?mode|grok-build|build-/.test(normalized)) return "agent";
  if (/embed|embedding/.test(normalized)) return "embedding";
  if (/moderation/.test(normalized)) return "moderation";
  if (/rerank/.test(normalized)) return "rerank";
  if (/audio|tts|whisper|speech|transcrib/.test(normalized)) return "audio";
  if (/vision-only/.test(normalized)) return "vision-only";
  if (/image|dall[-_]?e|imagine|imagen|flux|stable-diffusion/.test(normalized)) return "image";

  return "text";
}

function isCompatibleProfileChoice(model: string, profile: ModelProfileName): boolean {
  const capability = classifyRegistryModelCapability(model);
  if (!capability) return false;
  if (profile === "image") return capability === "image";
  return capability === "text";
}

export function isModelCompatibleWithProfile(model: string, profile: ModelProfileName): boolean {
  return isCompatibleProfileChoice(model, profile);
}

function capabilityScore(providerKind: ProviderKind, model: string, profile: ModelProfileName): number {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return Number.NEGATIVE_INFINITY;

  let score = versionScore(normalized) * 1000;

  const add = (pattern: RegExp, weight: number) => {
    if (pattern.test(normalized)) score += weight;
  };

  add(/\bopus\b|opus-/, 110000);
  add(/\bpro\b|pro-/, 100000);
  add(/\bultra\b|ultra-/, 98000);
  add(/\bmax\b|max-/, 96000);
  add(/\bsonnet\b|sonnet-/, 80000);
  add(/\blarge\b|large-/, 78000);
  add(/\breasoning\b|reasoning-/, 5000);
  add(/\bcodex\b|codex-/, profile === "code" ? 12000 : 3000);
  add(/\blatest\b|latest-/, 2000);

  if (providerKind === "openai") add(/\bgpt\b|gpt-/, 85000);
  if (providerKind === "anthropic") add(/\bclaude\b|claude-/, 85000);
  if (providerKind === "gemini") add(/\bgemini\b|gemini-/, 85000);
  if (providerKind === "xai") add(/\bgrok\b|grok-/, 85000);
  if (providerKind === "deepseek") add(/\bdeepseek\b|deepseek-/, 85000);
  if (providerKind === "mistral") add(/\bmistral\b|mistral-/, 85000);

  if (/\bmini\b|mini-|nano|small|haiku|flash|lite/.test(normalized)) score -= profile === "cheap" || profile === "fast" ? 0 : 50000;
  if (/non[-_]?reasoning/.test(normalized)) score -= profile === "cheap" || profile === "fast" ? 0 : 25000;
  if (/free|preview|beta|experimental/.test(normalized)) score -= 5000;
  if (profile === "cheap" || profile === "fast") {
    if (/\bmini\b|mini-|nano|small|haiku|flash|lite/.test(normalized)) score += 80000;
    if (/\bpro\b|opus|large|max/.test(normalized)) score -= 70000;
  }

  return score;
}

function versionScore(value: string): number {
  const tokens = value.match(/\d+(?:[.-]\d+)*/g) ?? [];
  const scores = tokens.map(versionTokenScore).filter((score) => score > 0);
  return scores.length ? Math.max(...scores) : 0;
}

function versionTokenScore(token: string): number {
  const parts = token.split(/[.-]/).map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part > 100)) return 0;
  return parts.reduce((score, part, index) => score + part / 10 ** index, 0);
}

export async function refreshProviderModelCatalog(provider: ProviderSettings, key?: string): Promise<ProviderModelRefresh> {
  const fetchedAt = new Date().toISOString();

  if (provider.provider === "openai") {
    const payload = await fetchJson("https://api.openai.com/v1/models", key ? { Authorization: `Bearer ${key}` } : undefined);
    return { choices: choicesFromOpenAi(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "anthropic") {
    const payload = await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
      "anthropic-version": "2023-06-01",
      ...(key ? { "x-api-key": key } : {}),
    });
    return { choices: choicesFromAnthropic(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "gemini") {
    if (!key) throw new Error("Gemini model refresh requires a linked API key.");
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    return { choices: choicesFromGemini(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "xai") {
    const payload = await fetchJson("https://api.x.ai/v1/models", key ? { Authorization: `Bearer ${key}` } : undefined);
    return { choices: choicesFromOpenAiCompatible(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "mistral") {
    if (!key) throw new Error("Mistral model refresh requires a linked API key.");
    const payload = await fetchJson("https://api.mistral.ai/v1/models", { Authorization: `Bearer ${key}` });
    return { choices: choicesFromOpenAiCompatible(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "deepseek") {
    if (!key) throw new Error("DeepSeek model refresh requires a linked API key.");
    const payload = await fetchJson("https://api.deepseek.com/v1/models", { Authorization: `Bearer ${key}` });
    return { choices: choicesFromOpenAiCompatible(payload), fetchedAt, source: "provider-api" };
  }

  if (provider.provider === "openrouter") {
    const payload = await fetchJson("https://openrouter.ai/api/v1/models", key ? { Authorization: `Bearer ${key}` } : undefined);
    return { choices: choicesFromOpenRouter(payload), fetchedAt, source: "public-api" };
  }

  throw new Error(`${provider.label} does not expose a supported model catalog endpoint yet.`);
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(providerApiError(payload, `Model refresh failed with HTTP ${response.status}.`));
  return payload;
}

function choicesFromOpenAi(payload: unknown): RegistryModelChoice[] {
  return choicesFromOpenAiCompatible(payload).filter((choice) => /^(gpt|chatgpt|o[0-9]|codex|dall-e)/i.test(choice.value));
}

function choicesFromOpenAiCompatible(payload: unknown): RegistryModelChoice[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return uniqueRegistryModelChoices(data.map((item) => modelChoiceFromRecord(item)).filter(Boolean) as RegistryModelChoice[]);
}

function choicesFromAnthropic(payload: unknown): RegistryModelChoice[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return uniqueRegistryModelChoices(data.map((item) => modelChoiceFromRecord(item)).filter(Boolean) as RegistryModelChoice[]);
}

function choicesFromGemini(payload: unknown): RegistryModelChoice[] {
  const data = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
  return uniqueRegistryModelChoices(
    data
      .map((item) => {
        if (!isRecord(item)) return undefined;
        const raw = String(item.name ?? item.id ?? "").replace(/^models\//, "");
        return raw ? { label: raw, value: raw } : undefined;
      })
      .filter(Boolean) as RegistryModelChoice[],
  );
}

function choicesFromOpenRouter(payload: unknown): RegistryModelChoice[] {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return uniqueRegistryModelChoices([
    ...openRouterCoreModels,
    ...(data.map((item) => modelChoiceFromRecord(item)).filter(Boolean) as RegistryModelChoice[]),
  ]);
}

function modelChoiceFromRecord(item: unknown): RegistryModelChoice | undefined {
  if (!isRecord(item)) return undefined;
  const id = String(item.id ?? item.name ?? "").trim();
  if (!id) return undefined;
  return {
    label: String(item.name ?? item.display_name ?? item.id ?? id),
    value: id,
  };
}

function providerApiError(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error) && typeof error.message === "string") return error.message;
    if (typeof error === "string") return error;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.detail === "string") return payload.detail;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

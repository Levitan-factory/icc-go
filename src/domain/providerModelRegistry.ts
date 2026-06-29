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

export const providerModelRegistryVersion = "2026-06-25";

const openAiTextModels: RegistryModelChoice[] = [
  { label: "GPT-5.5", value: "gpt-5.5" },
  { label: "GPT-5.5 Pro", value: "gpt-5.5-pro" },
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "GPT-5.4 mini", value: "gpt-5.4-mini" },
  { label: "GPT-5.4 nano", value: "gpt-5.4-nano" },
  { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
  { label: "GPT-5.2", value: "gpt-5.2" },
  { label: "GPT-5.1", value: "gpt-5.1" },
  { label: "GPT-5 mini", value: "gpt-5-mini" },
  { label: "GPT-5 nano", value: "gpt-5-nano" },
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
];

const openAiImageModels: RegistryModelChoice[] = [
  { label: "GPT Image 2", value: "gpt-image-2" },
  { label: "GPT Image 1.5", value: "gpt-image-1.5" },
  { label: "GPT Image 1", value: "gpt-image-1" },
  { label: "GPT Image 1 mini", value: "gpt-image-1-mini" },
  { label: "ChatGPT Image latest", value: "chatgpt-image-latest" },
];

const anthropicModels: RegistryModelChoice[] = [
  { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
  { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
  { label: "Claude Opus 4.6", value: "claude-opus-4-6" },
  { label: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5-20250929" },
];

const geminiModels: RegistryModelChoice[] = [
  { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
  { label: "Gemini 2.5 Flash Image", value: "gemini-2.5-flash-image-preview" },
];

const xAiModels: RegistryModelChoice[] = [
  { label: "Grok 4.3", value: "grok-4.3" },
  { label: "Grok 4.20 non-reasoning", value: "grok-4.20-0309-non-reasoning" },
  { label: "Grok 4.20 reasoning", value: "grok-4.20-0309-reasoning" },
  { label: "Grok Build 0.1", value: "grok-build-0.1" },
  { label: "Grok Imagine quality", value: "grok-imagine-image-quality" },
];

const openRouterCoreModels: RegistryModelChoice[] = [
  { label: "Auto router", value: "openrouter/auto" },
  { label: "Fusion ensemble", value: "openrouter/fusion" },
  { label: "OpenAI GPT-5.5", value: "openai/gpt-5.5" },
  { label: "OpenAI GPT-5.4 mini", value: "openai/gpt-5.4-mini" },
  { label: "OpenAI GPT Image 1", value: "openai/gpt-image-1" },
  { label: "OpenAI GPT Image 2", value: "openai/gpt-image-2" },
  { label: "Anthropic Claude Opus 4.8", value: "anthropic/claude-opus-4.8" },
  { label: "Anthropic Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
  { label: "Anthropic Claude Haiku 4.5", value: "anthropic/claude-haiku-4-5-20251001" },
  { label: "Google Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
  { label: "DeepSeek V4 Flash", value: "deepseek/deepseek-v4-flash" },
  { label: "DeepSeek V4 Pro", value: "deepseek/deepseek-v4-pro" },
  { label: "xAI Grok 4", value: "x-ai/grok-4" },
  { label: "xAI Grok Imagine quality", value: "x-ai/grok-imagine-image-quality" },
];

export const providerPresets: Record<ProviderKind, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    alias: "OpenAI",
    defaultModel: "gpt-5.4-mini",
    maxModel: "gpt-5.5",
    ensembleModel: "gpt-5.5",
    imageModel: "gpt-image-1.5",
    cheapModel: "gpt-5.4-nano",
    fastModel: "gpt-5.4-nano",
    codeModel: "gpt-5.3-codex",
    contextLimit: 200000,
  },
  anthropic: {
    label: "Anthropic",
    alias: "Claude",
    defaultModel: "claude-sonnet-4-6",
    maxModel: "claude-opus-4-6",
    ensembleModel: "claude-opus-4-6",
    imageModel: "",
    cheapModel: "claude-haiku-4-5-20251001",
    fastModel: "claude-haiku-4-5-20251001",
    codeModel: "claude-sonnet-4-6",
    contextLimit: 200000,
  },
  gemini: {
    label: "Gemini",
    alias: "Gemini",
    defaultModel: "gemini-2.5-pro",
    maxModel: "gemini-2.5-pro",
    ensembleModel: "gemini-2.5-pro",
    imageModel: "",
    cheapModel: "gemini-2.5-flash",
    fastModel: "gemini-2.5-flash",
    codeModel: "gemini-2.5-pro",
    contextLimit: 1000000,
  },
  xai: {
    label: "xAI",
    alias: "xAI",
    defaultModel: "grok-4.3",
    maxModel: "grok-4.3",
    ensembleModel: "grok-4.3",
    imageModel: "",
    cheapModel: "grok-4.20-0309-non-reasoning",
    fastModel: "grok-4.20-0309-non-reasoning",
    codeModel: "grok-4.3",
    contextLimit: 256000,
  },
  mistral: {
    label: "Mistral",
    alias: "Mistral",
    defaultModel: "mistral-large-latest",
    maxModel: "mistral-large-latest",
    ensembleModel: "mistral-large-latest",
    imageModel: "",
    cheapModel: "mistral-small-latest",
    fastModel: "mistral-small-latest",
    codeModel: "codestral-latest",
    contextLimit: 128000,
  },
  deepseek: {
    label: "DeepSeek",
    alias: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    maxModel: "deepseek-v4-pro",
    ensembleModel: "deepseek-v4-pro",
    imageModel: "",
    cheapModel: "deepseek-v4-flash",
    fastModel: "deepseek-v4-flash",
    codeModel: "deepseek-v4-pro",
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
    codeModel: "anthropic/claude-sonnet-4.6",
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
    { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
    { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" },
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

const modelMigrations: Record<string, string> = {
  "gpt-5.5-mini": "gpt-5.4-mini",
  "gpt-5.5-nano": "gpt-5.4-nano",
  "gpt-5.5-code": "gpt-5.3-codex",
  "openai/gpt-5.5-mini": "openai/gpt-5.4-mini",
  "openai/gpt-5.5-nano": "openai/gpt-5.4-nano",
  "openai/gpt-5.5-code": "openai/gpt-5.3-codex",
  "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.5": "anthropic/claude-opus-4.6",
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
  "deepseek-coder": "deepseek-v4-pro",
  "deepseek/deepseek-chat": "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-reasoner": "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-coder": "deepseek/deepseek-v4-pro",
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

export function chooseAutoModelForProvider(
  providerKind: ProviderKind,
  choices: RegistryModelChoice[],
  profile: "default" | "max" | "ensemble" | "cheap" | "fast" | "code" | "image",
  current?: string,
): string {
  const normalizedChoices = uniqueRegistryModelChoices(choices);
  const values = new Set(normalizedChoices.map((choice) => choice.value.toLowerCase()));
  const normalizedCurrent = normalizeKnownModelAlias(current);
  if (normalizedCurrent && values.has(normalizedCurrent.toLowerCase())) return normalizedCurrent;

  const preset = providerPresets[providerKind];
  const presetPreferred = normalizeKnownModelAlias(profile === "image" ? preset.imageModel : preset[`${profile}Model` as keyof ProviderPreset] as string);
  const preferred = [presetPreferred, ...profileModelPreferences(providerKind, profile)]
    .map(normalizeKnownModelAlias)
    .find((candidate) => candidate && (!values.size || values.has(candidate.toLowerCase())));
  if (preferred) return preferred;

  return normalizedChoices[0]?.value ?? presetPreferred;
}

function profileModelPreferences(
  providerKind: ProviderKind,
  profile: "default" | "max" | "ensemble" | "cheap" | "fast" | "code" | "image",
): string[] {
  if (providerKind === "openai") {
    const byProfile = {
      default: ["gpt-5.4-mini", "gpt-5-mini", "gpt-4o-mini", "gpt-5.4", "gpt-5.5"],
      max: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.2", "gpt-4o"],
      ensemble: ["gpt-5.5", "gpt-5.4", "gpt-5.2", "gpt-4o"],
      cheap: ["gpt-5.4-nano", "gpt-5-nano", "gpt-4o-mini", "gpt-5.4-mini"],
      fast: ["gpt-5.4-nano", "gpt-5-nano", "gpt-4o-mini", "gpt-5.4-mini"],
      code: ["gpt-5.3-codex", "gpt-5.5", "gpt-5.4", "gpt-4o"],
      image: ["gpt-image-1.5", "gpt-image-1", "gpt-image-2", "chatgpt-image-latest"],
    };
    return byProfile[profile];
  }

  if (providerKind === "openrouter") {
    const byProfile = {
      default: ["openrouter/auto"],
      max: ["openrouter/auto", "openai/gpt-5.5", "anthropic/claude-opus-4.8"],
      ensemble: ["openrouter/fusion", "openrouter/auto"],
      cheap: ["openrouter/auto"],
      fast: ["openrouter/auto"],
      code: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.3-codex", "openrouter/auto"],
      image: ["openai/gpt-image-1", "openai/gpt-image-2", "google/gemini-2.5-flash-image-preview", "x-ai/grok-imagine-image-quality"],
    };
    return byProfile[profile];
  }

  return [];
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

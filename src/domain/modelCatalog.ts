import type { ProviderKind, ProviderSettings } from "./types";
import {
  autoModelProfileChoiceLabel,
  fallbackProviderModelCatalog,
  modelCatalogForProvider,
  normalizeKnownModelAlias,
} from "./providerModelRegistry";

export interface ModelChoice {
  label: string;
  value: string;
}

export interface OpenRouterFamily {
  id: string;
  label: string;
  models: ModelChoice[];
}

export const modelProfileFields = [
  ["Default", "defaultModel"],
  ["Max", "maxModel"],
  ["Ensemble", "ensembleModel"],
  ["Image", "imageModel"],
  ["Code", "codeModel"],
  ["Cheap", "cheapModel"],
  ["Fast", "fastModel"],
] as const;

export const openRouterFamilies: OpenRouterFamily[] = [
  {
    id: "openrouter",
    label: "OpenRouter routing",
    models: [
      { label: "Auto router", value: "openrouter/auto" },
      { label: "Fusion ensemble", value: "openrouter/fusion" },
    ],
  },
  {
    id: "image",
    label: "Image generation",
    models: [
      { label: "GPT Image 1", value: "openai/gpt-image-1" },
      { label: "GPT Image 1 mini", value: "openai/gpt-image-1-mini" },
      { label: "Grok Imagine quality", value: "x-ai/grok-imagine-image-quality" },
      { label: "Gemini image preview", value: "google/gemini-2.5-flash-image-preview" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { label: "GPT-4o", value: "openai/gpt-4o" },
      { label: "GPT-4o mini", value: "openai/gpt-4o-mini" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { label: "Claude Sonnet latest", value: "~anthropic/claude-sonnet-latest" },
      { label: "Claude 3 Haiku", value: "~anthropic/claude-haiku-latest" },
    ],
  },
  {
    id: "google",
    label: "Google",
    models: [
      { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
      { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    models: [
      { label: "DeepSeek Chat", value: "deepseek/deepseek-chat" },
      { label: "DeepSeek Reasoner", value: "deepseek/deepseek-reasoner" },
      { label: "DeepSeek Chat free", value: "deepseek/deepseek-chat:free" },
    ],
  },
  {
    id: "mistralai",
    label: "Mistral",
    models: [
      { label: "Mistral Large", value: "mistralai/mistral-large-latest" },
      { label: "Mistral Small", value: "mistralai/mistral-small-latest" },
      { label: "Codestral", value: "mistralai/codestral-latest" },
    ],
  },
  {
    id: "x-ai",
    label: "xAI",
    models: [
      { label: "Grok 4", value: "x-ai/grok-4" },
      { label: "Grok 3 mini", value: "x-ai/grok-3-mini" },
    ],
  },
  {
    id: "meta-llama",
    label: "Meta",
    models: [
      { label: "Llama 3.1 405B", value: "meta-llama/llama-3.1-405b-instruct" },
      { label: "Llama 3.1 70B", value: "meta-llama/llama-3.1-70b-instruct" },
    ],
  },
];

export const providerModelCatalog: Partial<Record<ProviderKind, ModelChoice[]>> = fallbackProviderModelCatalog;

export function modelChoicesForProviderSettings(provider: ProviderSettings): ModelChoice[] {
  const profileChoices = modelProfileFields
    .map(([, field]) => provider[field])
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => ({ label: autoModelProfileChoiceLabel(value) ?? value, value }));

  return uniqueModelChoices([...modelCatalogForProvider(provider), ...profileChoices]);
}

export function knownModelValuesForProvider(provider: ProviderSettings): string[] {
  return modelChoicesForProviderSettings(provider).map((choice) => choice.value);
}

export function uniqueModelChoices(choices: ModelChoice[]): ModelChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = normalizeModelValue(choice.value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeModelValue(value: string): string {
  return normalizeKnownModelAlias(value).trim().toLowerCase();
}

export function openRouterFamilyForModel(model: string | undefined): OpenRouterFamily {
  const normalized = normalizeModelValue(model ?? "");
  return (
    openRouterFamilies.find((family) => family.models.some((choice) => normalizeModelValue(choice.value) === normalized)) ??
    openRouterFamilies.find((family) => normalized.startsWith(`${family.id}/`)) ??
    openRouterFamilies[0]
  );
}

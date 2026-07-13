import {
  buildProviderPrompt,
  createCellRunResult,
  simulateCellRun,
  validateOutputCapabilities,
  type ArtifactContentOverride,
  type CellRunResult,
  type RunContext,
} from "./runtime";
import { attachmentToBlob } from "./attachments";
import { fallbackProvider, providerModelForProfile } from "./providerAliases";
import {
  classifyRegistryModelCapability,
  chooseStrongestModelForProfile,
  fallbackProviderModelCatalog,
  isModelCompatibleWithProfile,
  normalizeKnownModelAlias,
  resolveModelProfileForProvider,
  uniqueRegistryModelChoices,
  type ModelProfileResolution,
  type RegistryModelChoice,
} from "./providerModelRegistry";
import { readProviderSecret } from "./providerSecrets";
import { resultSectionDivider } from "./resultOutput";
import type {
  CellStatus,
  Diagnostic,
  ImageOutputDirective,
  NotebookCell,
  ParsedDsl,
  ProviderSelection,
  ProviderSettings,
  RunRecord,
  WorkspaceSettings,
} from "./types";

interface ExecuteProviderRunOptions {
  signal?: AbortSignal;
}

interface LiveProviderTarget {
  configured: ProviderSettings;
  selection: ProviderSelection;
  model: string;
  modelResolution: ModelProfileResolution;
  key: string;
  executor: TextProviderExecutor;
  transportProvider?: ProviderSettings;
  transportReason?: string;
}

interface LiveProviderResolution {
  targets: LiveProviderTarget[];
  diagnostics?: Diagnostic[];
}

interface ProviderResponse {
  output: string;
  latencyMs: number;
  diagnostics?: Diagnostic[];
  providerRuns?: RunRecord["providerRuns"];
}

type ProviderRunRecord = RunRecord["providerRuns"][number];

type TextProviderExecutor = "openai" | "openrouter" | "anthropic" | "gemini" | "xai" | "deepseek";
type BrowserTransportPolicy = "direct" | "openrouter_bridge";

const openAiResponsesUrl = "https://api.openai.com/v1/responses";
const openAiImageGenerationsUrl = "https://api.openai.com/v1/images/generations";
const openAiImageEditsUrl = "https://api.openai.com/v1/images/edits";
const openRouterChatUrl = "https://openrouter.ai/api/v1/chat/completions";
const openRouterImagesUrl = "https://openrouter.ai/api/v1/images";
const anthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const geminiGenerateContentBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const xAiChatUrl = "https://api.x.ai/v1/chat/completions";
const deepSeekChatUrl = "https://api.deepseek.com/chat/completions";
const defaultTextMaxTokens = 1024;
const defaultGeminiTextMaxTokens = 4096;
const maxGroupedProviderTargets = 8;

const browserTextTransportPolicy: Partial<Record<ProviderSettings["provider"], BrowserTransportPolicy>> = {
  openai: "direct",
  openrouter: "direct",
  anthropic: "openrouter_bridge",
  gemini: "direct",
  xai: "direct",
  deepseek: "direct",
};

const browserDirectTextExecutors: Partial<Record<ProviderSettings["provider"], TextProviderExecutor>> = {
  openai: "openai",
  openrouter: "openrouter",
  gemini: "gemini",
  xai: "xai",
  deepseek: "deepseek",
};

export async function executeCellRun(
  cell: NotebookCell,
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
  context: RunContext = {},
  options: ExecuteProviderRunOptions = {},
): Promise<CellRunResult> {
  const parsedErrors = parsed.diagnostics.filter(isBlockingDiagnostic);
  if (parsedErrors.length) {
    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: parsedErrors,
    });
  }

  const hasImageOutputs = parsed.outputs.images.length > 0;
  const outputErrors = validateOutputCapabilities(parsed, `${cell.title} ${context.resolvedPromptBody ?? cell.promptBody}`, {
    imageGenerationEnabled: hasImageOutputs,
  });
  if (outputErrors.length) {
    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: outputErrors,
    });
  }

  if (hasImageOutputs) {
    return executeImageCellRun(cell, parsed, settings, context, options);
  }

  const targetResolution = resolveLiveProviderTargets(parsed, settings);
  if (!targetResolution) {
    return simulateCellRun(cell, parsed, settings, context);
  }

  if ("error" in targetResolution) {
    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: [{ level: "error", message: targetResolution.error }],
    });
  }

  const runSignal = createRunSignal(options.signal, parsed.constraints.latencyMaxSec);

  try {
    const prompt = buildProviderPrompt(context.resolvedPromptBody ?? cell.promptBody, parsed);
    const response = await runTextProviderTargets(targetResolution.targets, parsed, settings, prompt, runSignal.signal);

    return createCellRunResult(cell, parsed, settings, context, response.output, {
      latencyMs: response.latencyMs,
      errors: [...(targetResolution.diagnostics ?? []), ...(response.diagnostics ?? [])],
      providerRuns: response.providerRuns,
      notice: buildLiveExecutionNotice(parsed),
    });
  } catch (error) {
    if (isAbortError(error)) {
      if (runSignal.timedOut()) {
        const limit = parsed.constraints.latencyMaxSec ?? 0;
        return createCellRunResult(cell, parsed, settings, context, "", {
          latencyMs: Math.round(limit * 1000),
          errors: [
            {
              level: "error",
              code: "timeout",
              message: buildTimeoutMessage("provider", limit),
            },
          ],
        });
      }

      return createCellRunResult(cell, parsed, settings, context, "Run cancelled.", {
        errors: [{ level: "warning", code: "cancelled", message: "Run cancelled before provider response completed." }],
      });
    }

    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: [
        {
          level: "error",
          code: "provider_error",
          message: `Provider error (${describeTextResolution(targetResolution)}): ${errorMessage(error)}`,
        },
      ],
    });
  } finally {
    runSignal.cleanup();
  }
}

interface LiveImageTarget {
  configured: ProviderSettings;
  selection?: ProviderSelection;
  model: string;
  key: string;
  executor: "openai" | "openrouter";
}

async function executeImageCellRun(
  cell: NotebookCell,
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
  context: RunContext,
  options: ExecuteProviderRunOptions,
): Promise<CellRunResult> {
  const target = resolveLiveImageTarget(parsed, settings);
  if ("error" in target) {
    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: [{ level: "error", code: "missing_image_executor", message: target.error }],
    });
  }

  const runSignal = createRunSignal(options.signal, parsed.constraints.latencyMaxSec);

  try {
    const response =
      target.executor === "openai"
        ? await runOpenAiImageOutputs(target, cell, parsed, context, runSignal.signal)
        : await runOpenRouterImageOutputs(target, cell, parsed, context, runSignal.signal);

    return createCellRunResult(cell, parsed, settings, context, response.output, {
      latencyMs: response.latencyMs,
      artifactContentByName: response.artifacts,
      notice: buildLiveExecutionNotice(parsed),
      providerRuns: [
        {
          provider: target.configured.alias || target.configured.label,
          model: target.model,
          status: "completed",
        },
      ],
    });
  } catch (error) {
    if (isAbortError(error)) {
      if (runSignal.timedOut()) {
        const limit = parsed.constraints.latencyMaxSec ?? 0;
        return createCellRunResult(cell, parsed, settings, context, "", {
          latencyMs: Math.round(limit * 1000),
          errors: [
            {
              level: "error",
              code: "timeout",
              message: buildTimeoutMessage("image provider", limit),
            },
          ],
        });
      }

      return createCellRunResult(cell, parsed, settings, context, "Run cancelled.", {
        errors: [{ level: "warning", code: "cancelled", message: "Run cancelled before image provider response completed." }],
      });
    }

    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: [{ level: "error", code: "provider_error", message: `Image provider error (${target.configured.label} / ${target.model}): ${errorMessage(error)}` }],
    });
  } finally {
    runSignal.cleanup();
  }
}

function resolveLiveImageTarget(parsed: ParsedDsl, settings: WorkspaceSettings): LiveImageTarget | { error: string } {
  const selection = parsed.routing?.providers[0];
  const providerCount = parsed.routing?.providers.length ?? 0;

  if (
    providerCount > 1 ||
    parsed.routing?.mode === "parallel" ||
    parsed.routing?.mode === "best" ||
    parsed.routing?.mode === "synthesis"
  ) {
    return {
      error:
        "Configuration error: @image output currently supports one image executor route. Multi-provider image routing is not enabled yet.",
    };
  }

  const configured = selection ? findConfiguredProvider(settings, selection) : fallbackProvider(settings);
  if (!configured) {
    return {
      error:
        selection
          ? `Configuration error: provider \`${selection.alias ?? selection.provider}\` is not configured for @image output.`
          : "Configuration error: @image output needs a selected provider with an image executor in Settings.",
    };
  }

  const executor = imageExecutorForProvider(configured);
  if (!executor) {
    return {
      error: `Configuration error: ${configured.label} does not have an image execution adapter enabled in this build.`,
    };
  }

  if (!configured.apiKeyMasked) {
    return { error: `Configuration error: no API key is linked for ${configured.label}. Add one in Settings to enable @image outputs.` };
  }

  const key = readProviderSecret(configured.id);
  if (!key) {
    return {
      error: `Configuration error: ${configured.label} has only a masked key reference. Re-bind the full API key in Settings once to enable @image outputs.`,
    };
  }

  return {
    configured,
    selection,
    model: imageModelForTarget(configured, selection),
    key,
    executor,
  };
}

function imageExecutorForProvider(provider: ProviderSettings): LiveImageTarget["executor"] | undefined {
  if (provider.provider === "openai") return "openai";
  if (provider.provider === "openrouter") return "openrouter";
  return undefined;
}

function imageModelForTarget(provider: ProviderSettings, selection?: ProviderSelection): string {
  if (selection?.model) return selection.model;
  if (provider.imageModel) return provider.imageModel;
  return providerModelForProfile(provider, selection?.profile, selection?.model);
}

interface ImageProviderResponse {
  output: string;
  latencyMs: number;
  artifacts: Record<string, ArtifactContentOverride>;
}

async function runOpenAiImageOutputs(
  target: LiveImageTarget,
  cell: NotebookCell,
  parsed: ParsedDsl,
  context: RunContext,
  signal?: AbortSignal,
): Promise<ImageProviderResponse> {
  const started = performance.now();
  const artifacts: Record<string, ArtifactContentOverride> = {};
  const imageAttachments = cell.attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  const groups = groupImageOutputs(parsed.outputs.images);

  for (const group of groups) {
    const prompt = buildImagePrompt(cell, group.outputs, context, imageAttachments.length > 0);
    const payload = imageAttachments.length
      ? await runOpenAiImageEdit(target, prompt, group, imageAttachments, signal)
      : await runOpenAiImageGeneration(target, prompt, group, signal);
    const images = extractGeneratedImages(payload);

    if (images.length < group.outputs.length) {
      throw new Error(`OpenAI returned ${images.length} image(s), but ${group.outputs.length} were requested.`);
    }

    group.outputs.forEach((directive, index) => {
      const displayName = imageOutputName(cell, directive);
      const b64 = images[index];
      artifacts[displayName] = {
        content: b64,
        mimeType: imageMimeType(group.format),
        sizeBytes: base64ByteLength(b64),
      };
    });
  }

  return {
    output: `Generated ${Object.keys(artifacts).length} image artifact(s).`,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    artifacts,
  };
}

async function runOpenRouterImageOutputs(
  target: LiveImageTarget,
  cell: NotebookCell,
  parsed: ParsedDsl,
  context: RunContext,
  signal?: AbortSignal,
): Promise<ImageProviderResponse> {
  const started = performance.now();
  const artifacts: Record<string, ArtifactContentOverride> = {};
  const imageAttachments = cell.attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  const groups = groupImageOutputs(parsed.outputs.images);

  for (const group of groups) {
    const prompt = buildImagePrompt(cell, group.outputs, context, imageAttachments.length > 0);
    const payload = await runOpenRouterImageGeneration(target, prompt, group, imageAttachments, signal);
    const images = extractGeneratedImages(payload);

    if (images.length < group.outputs.length) {
      throw new Error(`OpenRouter returned ${images.length} image(s), but ${group.outputs.length} were requested.`);
    }

    group.outputs.forEach((directive, index) => {
      const displayName = imageOutputName(cell, directive);
      const b64 = images[index];
      artifacts[displayName] = {
        content: b64,
        mimeType: imageMimeType(group.format),
        sizeBytes: base64ByteLength(b64),
      };
    });
  }

  return {
    output: `Generated ${Object.keys(artifacts).length} image artifact(s).`,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
    artifacts,
  };
}

interface ImageOutputGroup {
  format: "png" | "jpeg" | "webp";
  outputs: ImageOutputDirective[];
}

function groupImageOutputs(outputs: ImageOutputDirective[]): ImageOutputGroup[] {
  const groups = new Map<ImageOutputGroup["format"], ImageOutputDirective[]>();
  outputs.forEach((output) => {
    const format = imageOutputFormat(output);
    groups.set(format, [...(groups.get(format) ?? []), output]);
  });

  return [...groups.entries()].flatMap(([format, groupOutputs]) => {
    const chunks: ImageOutputGroup[] = [];
    for (let index = 0; index < groupOutputs.length; index += 10) {
      chunks.push({ format, outputs: groupOutputs.slice(index, index + 10) });
    }
    return chunks;
  });
}

function imageOutputFormat(output: ImageOutputDirective): ImageOutputGroup["format"] {
  const format = (output.formatId === "jpg" ? "jpeg" : output.formatId || output.extension?.replace(".", "") || "png").toLowerCase();
  if (format === "jpeg" || format === "webp" || format === "png") return format;
  return "png";
}

function imageOutputName(cell: NotebookCell, directive: ImageOutputDirective): string {
  const extension = directive.extension ?? `.${imageOutputFormat(directive) === "jpeg" ? "jpg" : imageOutputFormat(directive)}`;
  return directive.name ?? `${slugify(cell.title || cell.alias)}${extension}`;
}

function buildImagePrompt(
  cell: NotebookCell,
  outputs: ImageOutputDirective[],
  context: RunContext,
  hasReferenceImages: boolean,
): string {
  const names = outputs.map((output) => imageOutputName(cell, output));
  const basePrompt = context.resolvedPromptBody ?? cell.promptBody;
  const transparent = outputs.some((output) => imageOutputFormat(output) === "png" || imageOutputFormat(output) === "webp");

  return [
    basePrompt,
    "",
    "ICC-GO image output contract:",
    `- Generate ${outputs.length} image${outputs.length === 1 ? "" : "s"}.`,
    `- Target artifact name${names.length === 1 ? "" : "s"}: ${names.join(", ")}.`,
    transparent ? "- Use a transparent background where the requested image format supports transparency." : undefined,
    hasReferenceImages ? "- Use the attached images as visual references; normalize them into one coherent requested style." : undefined,
    "- Do not include explanatory text inside the image unless explicitly requested.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

async function runOpenAiImageGeneration(
  target: LiveImageTarget,
  prompt: string,
  group: ImageOutputGroup,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(openAiImageGenerationsUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: directModelNameForProvider(target.configured.provider, target.model),
      prompt,
      n: group.outputs.length,
      output_format: group.format,
      background: group.format === "png" || group.format === "webp" ? "transparent" : "auto",
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `OpenAI image request failed with HTTP ${response.status}.`));
  }
  return payload;
}

async function runOpenAiImageEdit(
  target: LiveImageTarget,
  prompt: string,
  group: ImageOutputGroup,
  imageAttachments: NotebookCell["attachments"],
  signal?: AbortSignal,
): Promise<unknown> {
  const body = new FormData();
  body.append("model", directModelNameForProvider(target.configured.provider, target.model));
  body.append("prompt", prompt);
  body.append("n", String(group.outputs.length));
  body.append("output_format", group.format);
  body.append("background", group.format === "png" || group.format === "webp" ? "transparent" : "auto");

  imageAttachments.forEach((attachment) => {
    const blob = attachmentToBlob(attachment);
    body.append("image[]", blob, attachment.displayName);
  });

  const response = await fetch(openAiImageEditsUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
    },
    body,
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `OpenAI image edit request failed with HTTP ${response.status}.`));
  }
  return payload;
}

async function runOpenRouterImageGeneration(
  target: LiveImageTarget,
  prompt: string,
  group: ImageOutputGroup,
  imageAttachments: NotebookCell["attachments"],
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(openRouterImagesUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "HTTP-Referer": "https://icc-go.com",
      "X-OpenRouter-Title": "ICC-GO",
    },
    body: JSON.stringify({
      model: target.model,
      prompt,
      n: group.outputs.length,
      output_format: group.format,
      background: group.format === "png" || group.format === "webp" ? "transparent" : "auto",
      input_references: imageAttachments.map(attachmentToImageReference),
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `OpenRouter image request failed with HTTP ${response.status}.`));
  }
  return payload;
}

function attachmentToImageReference(attachment: NotebookCell["attachments"][number]) {
  return {
    type: "image_url",
    image_url: {
      url: attachment.encoding === "base64" ? `data:${attachment.mimeType};base64,${attachment.content}` : textImageDataUrl(attachment),
    },
  };
}

function textImageDataUrl(attachment: NotebookCell["attachments"][number]): string {
  return `data:${attachment.mimeType};base64,${bytesToBase64(new TextEncoder().encode(attachment.content))}`;
}

function extractGeneratedImages(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const candidates = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.images) ? payload.images : [];
  return candidates.map(extractGeneratedImage).filter(Boolean);
}

function extractGeneratedImage(item: unknown): string {
  if (!isRecord(item)) return "";
  if (typeof item.b64_json === "string") return item.b64_json.trim();
  if (typeof item.base64 === "string") return stripDataUrl(item.base64);
  if (typeof item.url === "string") return stripDataUrl(item.url);
  const imageUrl = item.image_url;
  if (typeof imageUrl === "string") return stripDataUrl(imageUrl);
  if (isRecord(imageUrl) && typeof imageUrl.url === "string") return stripDataUrl(imageUrl.url);
  return "";
}

function stripDataUrl(value: string): string {
  const trimmed = value.trim();
  const marker = ";base64,";
  const markerIndex = trimmed.indexOf(marker);
  return markerIndex >= 0 ? trimmed.slice(markerIndex + marker.length) : trimmed;
}

function imageMimeType(format: ImageOutputGroup["format"]): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "artifact";
}

interface RunSignal {
  signal?: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

function createRunSignal(externalSignal: AbortSignal | undefined, latencyMaxSec: number | undefined): RunSignal {
  const timeoutMs = latencyMaxSec && Number.isFinite(latencyMaxSec) && latencyMaxSec > 0 ? Math.max(1, Math.round(latencyMaxSec * 1000)) : 0;
  if (!timeoutMs) {
    return {
      signal: externalSignal,
      timedOut: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort();
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

function buildLiveExecutionNotice(parsed: ParsedDsl): string | undefined {
  if (!parsed.constraints.costMaxUsd) return undefined;

  return [
    `Cost cap <= $${parsed.constraints.costMaxUsd} is recorded for this cell.`,
    "Live provider cost preflight is not available for this adapter yet, so ICC-GO executed the run and reports estimated cost after completion.",
  ].join("\n");
}

function resolveLiveProviderTargets(
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
): LiveProviderResolution | { error: string } | undefined {
  const fallbackSelection = fallbackProviderSelection(settings);
  const selections = parsed.routing?.providers.length ? parsed.routing.providers : fallbackSelection ? [fallbackSelection] : [];

  if (!selections.length) return undefined;

  const targets: LiveProviderTarget[] = [];
  const errors: string[] = [];

  selections.forEach((selection) => {
    const target = resolveLiveProviderTarget(selection, settings);
    if ("error" in target) errors.push(target.error);
    else targets.push(target);
  });

  if (errors.length) return { error: errors.join("\n") };
  const normalized = normalizeLiveProviderTargets(targets);
  if (normalized.targets.length > maxGroupedProviderTargets) {
    return {
      error: `Configuration error: grouped routes support up to ${maxGroupedProviderTargets} unique provider/model targets. Split this run into multiple cells.`,
    };
  }

  return normalized;
}

function resolveLiveProviderTarget(selection: ProviderSelection, settings: WorkspaceSettings): LiveProviderTarget | { error: string } {
  const configured = findConfiguredProvider(settings, selection);
  if (!configured) {
    return { error: `Configuration error: provider \`${selection.alias ?? selection.provider}\` is not configured.` };
  }

  let modelResolution = resolveModelProfileForProvider(configured, selection.profile, selection.model);
  const compatibleResolution = resolveLiveTextModelCompatibility(configured, selection, modelResolution);
  if ("error" in compatibleResolution) return compatibleResolution;
  modelResolution = compatibleResolution;
  const model = modelResolution.model;
  const transportPolicy = browserTextTransportPolicy[configured.provider];
  if (!transportPolicy) {
    return {
      error: `Configuration error: live adapter for ${configured.label} is not enabled yet. Supported live text adapters: OpenAI, OpenRouter, Anthropic, Gemini, xAI, and DeepSeek.`,
    };
  }

  if (transportPolicy === "openrouter_bridge") {
    const openRouterTransport = resolveOpenRouterTextTransport(configured, selection, modelResolution, settings);
    if (openRouterTransport && "error" in openRouterTransport) return openRouterTransport;
    if (openRouterTransport) return openRouterTransport;
    return {
      error: `Configuration error: ${configured.label} cannot be called directly from the browser. Link an OpenRouter key in Settings or enable the hosted provider proxy before running this route.`,
    };
  }

  const executor = browserDirectTextExecutors[configured.provider];
  if (!executor) {
    return {
      error: `Configuration error: ${configured.label} is not allowed for direct browser text execution. Use OpenRouter or the hosted provider proxy for this route.`,
    };
  }

  if (!configured.apiKeyMasked) {
    return { error: `Configuration error: no API key is linked for ${configured.label}. Add one in Settings.` };
  }

  if (configured.balance.state === "error") {
    return {
      error: `Configuration error: ${configured.label} balance check failed: ${configured.balance.message} Re-check the key or update billing before running this route.`,
    };
  }

  const key = readProviderSecret(configured.id);
  if (!key) {
    return {
      error: `Configuration error: ${configured.label} has only a masked key reference. Re-bind the full API key in Settings once to enable live execution.`,
    };
  }

  return { configured, selection, model, modelResolution, key, executor };
}

function resolveLiveTextModelCompatibility(
  configured: ProviderSettings,
  selection: ProviderSelection,
  modelResolution: ModelProfileResolution,
): ModelProfileResolution | { error: string } {
  if (isModelCompatibleWithProfile(modelResolution.model, modelResolution.profile)) return modelResolution;

  const capability = classifyRegistryModelCapability(modelResolution.model) ?? "unknown";
  const routeLabel = `${configured.alias || configured.label}.${modelResolution.profile}`;
  const isExplicitRoute = Boolean(selection.model) || modelResolution.source === "explicit";
  if (isExplicitRoute) {
    return {
      error: `Configuration error: ${routeLabel} resolves to \`${modelResolution.model}\`, which is ${capability}, not a text/chat model. Choose a text-capable model before running this cell.`,
    };
  }

  const replacement = resolveCompatibleLiveTextModel(configured, modelResolution);
  if (replacement) return replacement;

  return {
    error: `Configuration error: ${routeLabel} resolved to \`${modelResolution.model}\`, which is ${capability}, not a text/chat model. Refresh ${configured.label} models in Settings or pin a compatible text model before running this cell.`,
  };
}

function resolveCompatibleLiveTextModel(
  configured: ProviderSettings,
  modelResolution: ModelProfileResolution,
): ModelProfileResolution | undefined {
  const catalog = providerCatalogWithFallback(configured);
  if (!catalog.length) return undefined;

  const model = chooseStrongestModelForProfile(configured.provider, catalog, modelResolution.profile);
  if (!model || !isModelCompatibleWithProfile(model, modelResolution.profile)) return undefined;

  return {
    ...modelResolution,
    model,
    source: modelResolutionSourceForCatalogChoice(configured, model),
    catalogUpdatedAt: providerHasLiveCatalogModel(configured, model) ? configured.modelCatalogUpdatedAt : undefined,
    policy: [
      modelResolution.policy,
      `${configured.alias || configured.label}.${modelResolution.profile} had resolved to non-text model \`${modelResolution.model}\`; ICC-GO selected \`${model}\` from the ${modelCatalogLabelForChoice(configured, model)} for text execution.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function resolveOpenRouterTextTransport(
  configured: ProviderSettings,
  selection: ProviderSelection,
  modelResolution: ModelProfileResolution,
  settings: WorkspaceSettings,
): LiveProviderTarget | { error: string } | undefined {
  if (configured.provider !== "anthropic") return undefined;

  const transportProvider = settings.providers.find((provider) => provider.enabled && provider.provider === "openrouter");
  if (!transportProvider?.apiKeyMasked || transportProvider.balance.state === "error") return undefined;

  const key = readProviderSecret(transportProvider.id);
  if (!key) return undefined;

  const bridgeModel = resolveOpenRouterBridgeModel(configured, selection, modelResolution, transportProvider);
  if (!bridgeModel) {
    return {
      error: `Configuration error: ${configured.alias || configured.label}.${modelResolution.profile} cannot be bridged through OpenRouter. Refresh OpenRouter models in Settings or pin an explicit Anthropic model.`,
    };
  }

  const openRouterModel = bridgeModel.model;
  return {
    configured,
    selection,
    model: openRouterModel,
    modelResolution: {
      ...modelResolution,
      model: openRouterModel,
      source: bridgeModel.source,
      catalogUpdatedAt: bridgeModel.catalogUpdatedAt,
      policy: [
        modelResolution.policy,
        bridgeModel.policy,
        "Anthropic is routed through OpenRouter in the browser because Anthropic does not allow direct browser-origin API calls.",
      ]
        .filter(Boolean)
        .join(" "),
    },
    key,
    executor: "openrouter",
    transportProvider,
    transportReason:
      "Anthropic is routed through OpenRouter in the browser because Anthropic does not allow direct browser-origin API calls.",
  };
}

function resolveOpenRouterBridgeModel(
  configured: ProviderSettings,
  selection: ProviderSelection,
  modelResolution: ModelProfileResolution,
  transportProvider: ProviderSettings,
): { model: string; source: ModelProfileResolution["source"]; catalogUpdatedAt?: string; policy?: string } | undefined {
  if (!selection.model && (modelResolution.profile === "max" || modelResolution.profile === "ensemble")) {
    const prefix = openRouterModelPrefixForProvider(configured.provider);
    if (!prefix) return undefined;

    const choices = providerCatalogWithFallback(transportProvider, "openrouter").filter((choice) =>
      normalizeOpenRouterModelLookup(choice.value).startsWith(prefix),
    );
    const model = chooseStrongestModelForProfile(configured.provider, choices, modelResolution.profile);
    if (!model) return undefined;

    return {
      model,
      source: modelResolutionSourceForCatalogChoice(transportProvider, model),
      catalogUpdatedAt: providerHasLiveCatalogModel(transportProvider, model) ? transportProvider.modelCatalogUpdatedAt : undefined,
      policy: `${configured.alias || configured.label}.${modelResolution.profile} was selected from the ${modelCatalogLabelForChoice(transportProvider, model)} through OpenRouter for browser-safe execution.`,
    };
  }

  if (selection.model || modelResolution.source !== "auto-fallback") {
    const model = openRouterModelForProvider(configured.provider, modelResolution.model);
    if (!model) return undefined;

    return {
      model,
      source: modelResolution.source,
      catalogUpdatedAt: modelResolution.catalogUpdatedAt,
      policy: modelResolution.policy,
    };
  }

  return undefined;
}

function providerCatalogWithFallback(
  configured: ProviderSettings,
  fallbackKind: ProviderSettings["provider"] = configured.provider,
): RegistryModelChoice[] {
  return uniqueRegistryModelChoices([...(configured.modelCatalog ?? []), ...(fallbackProviderModelCatalog[fallbackKind] ?? [])]);
}

function providerHasLiveCatalogModel(configured: ProviderSettings, model: string): boolean {
  const needle = normalizeModelLookup(model);
  return Boolean((configured.modelCatalog ?? []).some((choice) => normalizeModelLookup(choice.value) === needle));
}

function modelResolutionSourceForCatalogChoice(
  configured: ProviderSettings,
  model: string,
): ModelProfileResolution["source"] {
  if (!providerHasLiveCatalogModel(configured, model)) return "auto-fallback";
  return configured.modelCatalogSource === "public-api" ? "auto-public-api" : "auto-provider-api";
}

function modelCatalogLabelForChoice(configured: ProviderSettings, model: string): string {
  return providerHasLiveCatalogModel(configured, model) ? "latest cached model catalog" : "bundled fallback model catalog";
}

function normalizeModelLookup(value: string): string {
  return normalizeKnownModelAlias(value).trim().toLowerCase();
}

function normalizeOpenRouterModelLookup(value: string): string {
  return normalizeModelLookup(value).replace(/^~/, "");
}

function normalizeLiveProviderTargets(targets: LiveProviderTarget[]): LiveProviderResolution {
  const uniqueTargets: LiveProviderTarget[] = [];
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  targets.forEach((target) => {
    const key = liveProviderTargetKey(target);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTargets.push(target);
      if (target.transportReason) {
        diagnostics.push({
          level: "info",
          code: "provider_transport",
          message: `${providerRunLabel(target)}: ${target.transportReason}`,
        });
      }
      return;
    }

    diagnostics.push({
      level: "warning",
      code: "duplicate_provider_route",
      message: `Duplicate provider route ignored (${providerRunLabel(target)}). Each provider/model target is executed once per grouped route.`,
    });
  });

  return { targets: uniqueTargets, diagnostics };
}

function liveProviderTargetKey(target: LiveProviderTarget): string {
  return [target.transportProvider?.id ?? target.configured.id, target.executor, target.model.trim().toLowerCase()].join("::");
}

function fallbackProviderSelection(settings: WorkspaceSettings): ProviderSelection | undefined {
  const provider = settings.providers.find((candidate) => candidate.enabled) ?? settings.providers[0];
  if (!provider) return undefined;
  return {
    provider: provider.id,
    alias: provider.alias,
    label: provider.label,
    profile: "default",
  };
}

function findConfiguredProvider(settings: WorkspaceSettings, selection: ProviderSelection): ProviderSettings | undefined {
  const requested = [selection.provider, selection.alias, selection.label]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLookupValue);
  const exactId = settings.providers.find((provider) => requested.includes(normalizeLookupValue(provider.id)));
  if (exactId) return exactId;

  const exactAlias = settings.providers.find((provider) =>
    [provider.alias, provider.label]
      .filter((value): value is string => Boolean(value))
      .some((value) => requested.includes(normalizeLookupValue(value))),
  );
  if (exactAlias) return exactAlias;

  const providerKind = settings.providers.find(
    (provider) => provider.enabled && requested.includes(normalizeLookupValue(provider.provider)),
  );
  if (providerKind) return providerKind;

  return settings.providers.find((provider) => requested.includes(normalizeLookupValue(provider.provider)));
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

interface ProviderCandidateResponse {
  target: LiveProviderTarget;
  response: ProviderResponse;
}

interface ProviderFailure {
  target: LiveProviderTarget;
  reason: unknown;
}

async function runTextProviderTargets(
  targets: LiveProviderTarget[],
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
  prompt: string,
  signal?: AbortSignal,
): Promise<ProviderResponse> {
  if (targets.length === 1) {
    const response = await runTextProviderResponse(targets[0], prompt, signal);
    return {
      ...response,
      providerRuns: [providerRunForTarget(targets[0], "completed")],
    };
  }

  const started = performance.now();
  const settled = await Promise.allSettled(targets.map((target) => runTextProviderResponse(target, prompt, signal)));
  const successes: ProviderCandidateResponse[] = [];
  const failures: ProviderFailure[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successes.push({ target: targets[index], response: result.value });
    } else {
      failures.push({ target: targets[index], reason: result.reason });
    }
  });

  if (!successes.length) {
    const abort = failures.map((failure) => failure.reason).find(isAbortError);
    if (abort) throw abort;
    throw new Error(`All routed providers failed: ${failures.map((failure) => errorMessage(failure.reason)).join(" | ")}`);
  }

  const diagnostics = buildPartialProviderDiagnostics(parsed, successes, failures, targets.length);
  const providerRuns = buildGroupedProviderRuns(targets, settled);
  const latencyMs = Math.max(1, Math.round(performance.now() - started));

  if (parsed.routing?.mode === "best" || parsed.routing?.method === "best") {
    const selected = await selectBestProviderResponse(successes, settings, prompt, signal);
    return {
      output: selected.response.output,
      latencyMs,
      diagnostics,
      providerRuns,
    };
  }

  if (parsed.routing?.mode === "synthesis" || parsed.routing?.method === "ensemble") {
    const synthesized = await synthesizeProviderResponses(successes, failures, settings, prompt, signal);
    return {
      output: synthesized.output,
      latencyMs,
      diagnostics: [...diagnostics, ...(synthesized.diagnostics ?? [])],
      providerRuns,
    };
  }

  return {
    output: joinProviderResponses(successes),
    latencyMs,
    diagnostics,
    providerRuns,
  };
}

function buildPartialProviderDiagnostics(
  parsed: ParsedDsl,
  successes: ProviderCandidateResponse[],
  failures: ProviderFailure[],
  requestedCount: number,
): Diagnostic[] {
  if (!failures.length) return [];

  const routeName =
    parsed.routing?.mode === "synthesis" || parsed.routing?.method === "ensemble"
      ? "Ensemble"
      : parsed.routing?.mode === "best" || parsed.routing?.method === "best"
        ? "Best routing"
        : "Grouped routing";
  const failedLabels = failures.map((failure) => providerRunLabel(failure.target)).join(", ");

  return [
    {
      level: "warning",
      code: "partial_provider_failure",
      message: `${routeName} completed with ${successes.length} of ${requestedCount} provider candidates. Failed providers: ${failedLabels}.`,
    },
    ...failures.map((failure) => ({
      level: "warning" as const,
      code: "partial_provider_failure",
      message: `Provider warning (${providerRunLabel(failure.target)}): ${errorMessage(failure.reason)}`,
    })),
  ];
}

function buildGroupedProviderRuns(
  targets: LiveProviderTarget[],
  settled: PromiseSettledResult<ProviderResponse>[],
): ProviderRunRecord[] {
  return targets.map((target, index) =>
    providerRunForTarget(
      target,
      settled[index]?.status === "fulfilled" ? "completed" : providerFailureStatus(settled[index]),
    ),
  );
}

function providerFailureStatus(result: PromiseSettledResult<ProviderResponse> | undefined): CellStatus {
  if (result?.status === "rejected" && isAbortError(result.reason)) return "timeout";
  return "failed";
}

function providerRunForTarget(target: LiveProviderTarget, status: CellStatus): ProviderRunRecord {
  const configuredLabel = target.selection.alias ?? target.configured.alias ?? target.configured.label;
  return {
    provider: target.transportProvider
      ? `${configuredLabel} via ${target.transportProvider.alias || target.transportProvider.label}`
      : configuredLabel,
    model: target.model,
    status,
  };
}

async function runTextProviderResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  try {
    switch (target.executor) {
      case "openai":
        return await runOpenAiResponse(target, prompt, signal);
      case "openrouter":
        return await runOpenRouterResponse(target, prompt, signal);
      case "anthropic":
        return await runAnthropicResponse(target, prompt, signal);
      case "gemini":
        return await runGeminiResponse(target, prompt, signal);
      case "xai":
        return await runXAiResponse(target, prompt, signal);
      case "deepseek":
        return await runDeepSeekResponse(target, prompt, signal);
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(providerExecutionErrorMessage(target, error));
  }
}

async function selectBestProviderResponse(
  candidates: ProviderCandidateResponse[],
  settings: WorkspaceSettings,
  prompt: string,
  signal?: AbortSignal,
): Promise<ProviderCandidateResponse> {
  if (candidates.length === 1) return candidates[0];

  const selector = resolveOrchestrationTarget(settings, settings.orchestration.selectorModel);
  if (!("error" in selector)) {
    try {
      const response = await runTextProviderResponse(selector, buildSelectorPrompt(prompt, candidates), signal);
      const selectedIndex = parseWinnerIndex(response.output, candidates.length);
      if (selectedIndex !== undefined) return candidates[selectedIndex];
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }

  return candidates
    .slice()
    .sort((left, right) => right.response.output.trim().length - left.response.output.trim().length)[0];
}

async function synthesizeProviderResponses(
  candidates: ProviderCandidateResponse[],
  failures: ProviderFailure[],
  settings: WorkspaceSettings,
  prompt: string,
  signal?: AbortSignal,
): Promise<Pick<ProviderResponse, "output" | "diagnostics">> {
  if (candidates.length === 1) return { output: candidates[0].response.output };

  const synthesizer = resolveOrchestrationTarget(settings, settings.orchestration.synthesisModel);
  if (!("error" in synthesizer)) {
    try {
      const response = await runTextProviderResponse(synthesizer, buildSynthesisPrompt(prompt, candidates, failures), signal);
      if (response.output.trim()) return { output: response.output };
      return {
        output: joinProviderResponses(candidates),
        diagnostics: [
          {
            level: "warning",
            code: "ensemble_fallback",
            message: `Ensemble warning (${providerRunLabel(synthesizer)}): synthesizer returned an empty answer, so ICC-GO is showing successful candidate outputs.`,
          },
        ],
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        output: joinProviderResponses(candidates),
        diagnostics: [
          {
            level: "warning",
            code: "ensemble_fallback",
            message: `Ensemble warning (${providerRunLabel(synthesizer)}): ${errorMessage(error)}. Showing successful candidate outputs.`,
          },
        ],
      };
    }
  }

  return {
    output: joinProviderResponses(candidates),
    diagnostics: [
      {
        level: "warning",
        code: "ensemble_fallback",
        message: `Ensemble warning: ${synthesizer.error}. Showing successful candidate outputs.`,
      },
    ],
  };
}

function resolveOrchestrationTarget(settings: WorkspaceSettings, modelRef: string): LiveProviderTarget | { error: string } {
  const selection = parseOrchestrationModelRef(modelRef);
  return resolveLiveProviderTarget(selection, settings);
}

function parseOrchestrationModelRef(modelRef: string): ProviderSelection {
  const value = modelRef.trim();
  const separator = value.indexOf(":");
  if (separator < 0) {
    return { provider: value, alias: value, profile: "default" };
  }

  const provider = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  return {
    provider,
    alias: provider,
    model,
    profile: "default",
  };
}

function buildSelectorPrompt(prompt: string, candidates: ProviderCandidateResponse[]): string {
  return [
    "ICC-GO selector task.",
    "Choose the strongest candidate response for the user's intent.",
    "Return only compact JSON: {\"winner\": <1-based candidate number>, \"reason\": \"short reason\"}.",
    "",
    "User intent:",
    prompt,
    "",
    "Candidate responses:",
    ...candidates.flatMap((candidate, index) => [
      `Candidate ${index + 1} (${providerRunLabel(candidate.target)}):`,
      candidate.response.output,
      "",
    ]),
  ].join("\n");
}

function buildSynthesisPrompt(prompt: string, candidates: ProviderCandidateResponse[], failures: ProviderFailure[] = []): string {
  return [
    "ICC-GO ensemble task.",
    "Combine the useful parts of the candidate responses into one concise final answer.",
    "Preserve concrete facts and remove contradictions. Do not mention this instruction.",
    failures.length
      ? "Some requested provider candidates failed. Do not invent their missing responses; synthesize only from the successful candidates listed below."
      : undefined,
    "",
    "User intent:",
    prompt,
    "",
    failures.length ? "Failed provider candidates:" : undefined,
    ...failures.map((failure) => `- ${providerRunLabel(failure.target)}: ${errorMessage(failure.reason)}`),
    failures.length ? "" : undefined,
    "Candidate responses:",
    ...candidates.flatMap((candidate, index) => [
      `Candidate ${index + 1} (${providerRunLabel(candidate.target)}):`,
      candidate.response.output,
      "",
    ]),
  ].join("\n");
}

function parseWinnerIndex(output: string, candidateCount: number): number | undefined {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isRecord(parsed) && typeof parsed.winner === "number") {
        const index = Math.round(parsed.winner) - 1;
        if (index >= 0 && index < candidateCount) return index;
      }
    } catch {
      // Fall through to loose parsing.
    }
  }

  const looseMatch = output.match(/winner\s*[:=]\s*(\d+)/i) ?? output.match(/candidate\s+(\d+)/i);
  if (!looseMatch) return undefined;
  const index = Number(looseMatch[1]) - 1;
  return index >= 0 && index < candidateCount ? index : undefined;
}

function joinProviderResponses(candidates: ProviderCandidateResponse[]): string {
  return candidates
    .map((candidate) => [resultSectionDivider(providerRunLabel(candidate.target)), candidate.response.output.trim()].join("\n"))
    .join("\n\n");
}

async function runOpenAiResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  const started = performance.now();
  const response = await fetch(openAiResponsesUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: directModelNameForProvider(target.configured.provider, target.model),
      input: prompt,
      store: false,
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `OpenAI request failed with HTTP ${response.status}.`));
  }
  const output = extractOpenAiText(payload);
  if (!output) {
    throw new Error(providerErrorMessage(payload, "OpenAI returned a response without text output."));
  }

  return {
    output,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

async function runOpenRouterResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  const started = performance.now();
  const response = await fetch(openRouterChatUrl, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "HTTP-Referer": "https://icc-go.com",
      "X-OpenRouter-Title": "ICC-GO",
    },
    body: JSON.stringify({
      model: target.model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `OpenRouter request failed with HTTP ${response.status}.`));
  }
  const output = extractOpenRouterText(payload);
  if (!output) {
    throw new Error(providerErrorMessage(payload, "OpenRouter returned a response without text output."));
  }

  return {
    output,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

async function runAnthropicResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  const started = performance.now();
  const response = await fetch(anthropicMessagesUrl, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": target.key,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: directModelNameForProvider(target.configured.provider, target.model),
      max_tokens: defaultTextMaxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `Anthropic request failed with HTTP ${response.status}.`));
  }
  const output = extractAnthropicText(payload);
  if (!output) {
    throw new Error(providerErrorMessage(payload, "Anthropic returned a response without text output."));
  }

  return {
    output,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

async function runGeminiResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  const started = performance.now();
  const response = await fetch(geminiGenerateContentUrl(target), {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: defaultGeminiTextMaxTokens,
      },
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `Gemini request failed with HTTP ${response.status}.`));
  }
  const output = extractGeminiText(payload);
  if (!output) {
    throw new Error(geminiEmptyTextMessage(payload));
  }

  return {
    output,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

async function runXAiResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  return runChatCompletionResponse(target, xAiChatUrl, prompt, signal);
}

async function runDeepSeekResponse(target: LiveProviderTarget, prompt: string, signal?: AbortSignal): Promise<ProviderResponse> {
  return runChatCompletionResponse(target, deepSeekChatUrl, prompt, signal);
}

async function runChatCompletionResponse(
  target: LiveProviderTarget,
  url: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<ProviderResponse> {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${target.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: directModelNameForProvider(target.configured.provider, target.model),
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  const payload = await readJson(response);
  if (!response.ok || isProviderErrorPayload(payload)) {
    throw new Error(providerErrorMessage(payload, `${target.configured.label} request failed with HTTP ${response.status}.`));
  }
  const output = extractOpenRouterText(payload);
  if (!output) {
    throw new Error(providerErrorMessage(payload, `${target.configured.label} returned a response without text output.`));
  }

  return {
    output,
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

function geminiGenerateContentUrl(target: LiveProviderTarget): string {
  const model = directModelNameForProvider(target.configured.provider, target.model);
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  return `${geminiGenerateContentBaseUrl}/${modelPath}:generateContent?key=${encodeURIComponent(target.key)}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}

function extractOpenAiText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") return payload.output_text.trim();

  const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];

  output.forEach((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return;
    item.content.forEach((content) => {
      if (!isRecord(content)) return;
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    });
  });

  return parts.join("\n").trim() || JSON.stringify(payload, null, 2);
}

function extractOpenRouterText(payload: unknown): string {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices.find(isRecord);
  const message = first && isRecord(first.message) ? first.message : undefined;
  const content = message?.content;

  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return JSON.stringify(payload, null, 2);
}

function extractAnthropicText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean);

  if (parts.length) return parts.join("\n").trim();
  return typeof payload.completion === "string" ? payload.completion.trim() : "";
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates.find(isRecord);
  const content = first && isRecord(first.content) ? first.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  return parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function directModelNameForProvider(provider: ProviderSettings["provider"], model: string): string {
  const normalized = model.trim();
  const providerPrefixes: Partial<Record<ProviderSettings["provider"], string[]>> = {
    openai: ["openai/"],
    anthropic: ["anthropic/"],
    gemini: ["google/"],
    xai: ["x-ai/"],
    deepseek: ["deepseek/"],
  };
  const prefix = (providerPrefixes[provider] ?? []).find((candidate) => normalized.toLowerCase().startsWith(candidate));
  return prefix ? normalized.slice(prefix.length) : normalized;
}

function openRouterModelForProvider(provider: ProviderSettings["provider"], model: string): string {
  const normalized = model.trim();
  if (!normalized) return normalized;

  const bridgeModel = openRouterCanonicalModelForProvider(provider, normalized);
  if (bridgeModel) return bridgeModel;

  if (normalized.includes("/")) return normalizeKnownModelAlias(normalized);

  const prefix = openRouterModelPrefixForProvider(provider);
  return prefix ? `${prefix}${normalizeKnownModelAlias(normalized)}` : normalizeKnownModelAlias(normalized);
}

function openRouterModelPrefixForProvider(provider: ProviderSettings["provider"]): string | undefined {
  const providerPrefixes: Partial<Record<ProviderSettings["provider"], string>> = {
    openai: "openai/",
    anthropic: "anthropic/",
    gemini: "google/",
    xai: "x-ai/",
    deepseek: "deepseek/",
    mistral: "mistralai/",
  };
  return providerPrefixes[provider];
}

function openRouterCanonicalModelForProvider(provider: ProviderSettings["provider"], model: string): string | undefined {
  const normalized = normalizeKnownModelAlias(model).toLowerCase();
  if (provider === "anthropic") {
    const strongest = "~anthropic/claude-opus-latest";
    const sonnet = "~anthropic/claude-sonnet-latest";
    const fast = "~anthropic/claude-haiku-latest";
    const anthropicBridge: Record<string, string> = {
      "claude-sonnet-latest": sonnet,
      "claude-3-5-sonnet-latest": sonnet,
      "claude-sonnet-5": sonnet,
      "claude-sonnet-4-6": sonnet,
      "claude-sonnet-4-5-20250929": sonnet,
      "claude-opus-latest": strongest,
      "claude-opus-4-8": strongest,
      "claude-opus-4-7": strongest,
      "claude-opus-4-6": strongest,
      "claude-fable-5": sonnet,
      "claude-haiku-latest": fast,
      "claude-3-5-haiku-latest": fast,
      "claude-haiku-4-5-20251001": fast,
      "anthropic/claude-sonnet-latest": sonnet,
      "~anthropic/claude-sonnet-latest": sonnet,
      "anthropic/claude-3-5-sonnet-latest": sonnet,
      "anthropic/claude-3.5-sonnet": sonnet,
      "anthropic/claude-sonnet-5": sonnet,
      "anthropic/claude-sonnet-4.6": sonnet,
      "anthropic/claude-opus-latest": strongest,
      "~anthropic/claude-opus-latest": strongest,
      "anthropic/claude-opus-4.8": strongest,
      "anthropic/claude-opus-4.7": strongest,
      "anthropic/claude-opus-4.6": strongest,
      "anthropic/claude-fable-5": sonnet,
      "anthropic/claude-haiku-latest": fast,
      "~anthropic/claude-haiku-latest": fast,
      "anthropic/claude-3-5-haiku-latest": fast,
      "anthropic/claude-3-haiku": fast,
      "anthropic/claude-haiku-4-5-20251001": fast,
    };
    return anthropicBridge[normalized];
  }
  return undefined;
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error) && typeof error.message === "string") return error.message;
    if (typeof error === "string") return error;
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) return JSON.stringify(payload.detail);
    if (typeof payload.message === "string") return payload.message;
  }

  return fallback;
}

function providerExecutionErrorMessage(target: LiveProviderTarget, error: unknown): string {
  if (isBrowserFetchTransportError(error)) {
    if (target.executor === "anthropic") {
      return [
        "Browser request failed before an HTTP response.",
        "Anthropic rejected the direct browser-origin request for this API.",
        "For GO-ONLINE, route Claude through OpenRouter or enable the hosted provider proxy.",
      ].join(" ");
    }

    return [
      "Browser request failed before an HTTP response.",
      "Check provider CORS support, network availability, browser extensions, or use a backend provider proxy.",
    ].join(" ");
  }

  return errorMessage(error);
}

function isBrowserFetchTransportError(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch/i.test(error.message);
}

function geminiEmptyTextMessage(payload: unknown): string {
  if (!isRecord(payload)) return "Gemini returned a response without text output.";

  const promptFeedback = isRecord(payload.promptFeedback) ? payload.promptFeedback : undefined;
  const blockReason = typeof promptFeedback?.blockReason === "string" ? promptFeedback.blockReason : "";
  if (blockReason) {
    return `Gemini returned no text because the prompt was blocked (${blockReason}).`;
  }

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates.find(isRecord);
  const finishReason = typeof first?.finishReason === "string" ? first.finishReason : "";
  const safetyRatings = Array.isArray(first?.safetyRatings)
    ? first.safetyRatings
        .map((rating) => {
          if (!isRecord(rating)) return "";
          const category = typeof rating.category === "string" ? rating.category : "";
          const probability = typeof rating.probability === "string" ? rating.probability : "";
          return category && probability ? `${category}: ${probability}` : "";
        })
        .filter(Boolean)
    : [];

  if (finishReason === "MAX_TOKENS") {
    return "Gemini returned no text because its output token budget was exhausted before a visible answer. Try a shorter prompt, a larger output budget, or another Gemini model.";
  }

  if (finishReason) {
    const safety = safetyRatings.length ? ` Safety ratings: ${safetyRatings.join(", ")}.` : "";
    return `Gemini returned no text (finishReason: ${finishReason}).${safety}`;
  }

  if (!candidates.length) {
    return "Gemini returned no candidates. Check the model id, prompt safety filters, and provider status.";
  }

  return providerErrorMessage(payload, "Gemini returned a response without text output.");
}

function isProviderErrorPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (payload.error) return true;
  if ("detail" in payload && !("output" in payload) && !("choices" in payload)) return true;
  return false;
}

function describeTextResolution(resolution: LiveProviderResolution | { error: string } | undefined): string {
  if (!resolution) return "workspace fallback";
  if ("error" in resolution) return "unresolved route";
  return resolution.targets.map(providerRunLabel).join(", ");
}

function providerRunLabel(target: LiveProviderTarget): string {
  const configuredLabel = target.configured.alias || target.configured.label;
  if (target.transportProvider) {
    return `${configuredLabel} via ${target.transportProvider.alias || target.transportProvider.label} / ${target.model}`;
  }
  return `${configuredLabel} / ${target.model}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function buildTimeoutMessage(kind: "provider" | "image provider", limit: number): string {
  const formattedLimit = formatSeconds(limit);
  return [
    `timeout: ${kind} did not respond within ${formattedLimit}.`,
    "",
    "The latency constraint is a hard execution deadline, not a style instruction for the model.",
    "To get a response, raise the limit such as `< latency <= 3m`, remove the latency line to use the workspace default, choose a faster model/profile, or reduce prompt/file context.",
  ].join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isBlockingDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.level === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

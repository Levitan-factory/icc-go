import type {
  Artifact,
  CellStatus,
  DecisionResult,
  Diagnostic,
  FileOutputDirective,
  ImageOutputDirective,
  NotebookCell,
  ParsedDsl,
  ParsedVars,
  ProviderSelection,
  RunRecord,
  WorkspaceSettings,
} from "./types";
import { createId, nowIso } from "../lib/id";
import { fallbackProvider, providerModelForProfile } from "./providerAliases";
import {
  BINARY_FILE_EXTENSIONS,
  getFileFormatByExtension,
  getFileFormatById,
  getImageFormatById,
  type FormatRegistryEntry,
} from "../language/latest";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".diff": "text/x-diff",
  ".patch": "text/x-diff",
  ".py": "text/x-python",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".sql": "application/sql",
  ".xml": "application/xml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".env": "text/plain",
  ".svg": "image/svg+xml",
  ".mmd": "text/plain",
  ".go": "text/x-go",
  ".rs": "text/rust",
  ".java": "text/x-java-source",
  ".kt": "text/x-kotlin",
  ".swift": "text/x-swift",
  ".m": "text/x-objective-c",
  ".h": "text/x-csrc",
  ".cpp": "text/x-c++src",
  ".hpp": "text/x-c++src",
  ".sh": "text/x-shellscript",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const SIMULATED_RUN_NOTICE =
  "Simulated provider run. ICC-GO compiled the prompt locally; no external provider was called in this build.";

export interface CellRunResult {
  output: string;
  status: CellStatus;
  run: RunRecord;
  artifacts: Artifact[];
  vars: ParsedVars;
  decision?: DecisionResult;
  errors: Diagnostic[];
}

export interface RunContext {
  resolvedPromptBody?: string;
  inputResolved?: string;
  referenceErrors?: Diagnostic[];
}

interface CellRunResultOptions {
  errors?: Diagnostic[];
  notice?: string;
  noticeKind?: "runtime" | "simulation";
  latencyMs?: number;
  artifactContentByName?: Record<string, ArtifactContentOverride>;
  providerRuns?: RunRecord["providerRuns"];
}

export interface ArtifactContentOverride {
  content: string;
  sizeBytes?: number;
  mimeType?: string;
}

interface RuntimeCapabilities {
  imageGenerationEnabled?: boolean;
}

export function simulateCellRun(
  cell: NotebookCell,
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
  context: RunContext = {},
): CellRunResult {
  const outputErrors = validateOutputCapabilities(parsed, buildPromptIntentText(cell, context));
  if (outputErrors.length) {
    return createCellRunResult(cell, parsed, settings, context, "", {
      errors: outputErrors,
      notice: SIMULATED_RUN_NOTICE,
      noticeKind: "simulation",
    });
  }

  return createCellRunResult(cell, parsed, settings, context, buildModelOutput(cell, parsed, context.resolvedPromptBody), {
    notice: SIMULATED_RUN_NOTICE,
    noticeKind: "simulation",
  });
}

export function buildProviderPrompt(prompt: string, parsed: ParsedDsl): string {
  const textLimit = parsed.outputs.text?.limitChars;
  const artifactDirectives = [...parsed.outputs.files, ...parsed.outputs.images];
  const promptWithSenderNotes = buildPromptWithSenderNotes(prompt, parsed);
  if (!textLimit && artifactDirectives.length === 0) return promptWithSenderNotes;

  return [
    "ICC-GO output contract:",
    textLimit ? `- Keep the visible text answer within ${textLimit} characters.` : undefined,
    ...artifactOutputContractLines(artifactDirectives),
    "- Do not mention this instruction unless directly asked.",
    "",
    promptWithSenderNotes,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildPromptWithSenderNotes(prompt: string, parsed: ParsedDsl): string {
  const senderNotes = parsed.senderNotes?.map((note) => note.trim()).filter(Boolean) ?? [];
  if (!senderNotes.length || !parsed.bodySegments?.length) return prompt;

  const sourceText = parsed.bodySegments
    .filter((segment) => segment.type === "source_text")
    .map((segment) => segment.text)
    .join("")
    .trim();

  return [
    "ICC-GO sender notes are user comments, not source text. Use them as guidance, but do not quote them as original source material.",
    "",
    "Source text:",
    sourceText || "(empty)",
    "",
    "Sender notes:",
    ...senderNotes.map((note, index) => `${index + 1}. ${note}`),
  ].join("\n");
}

export function validateOutputCapabilities(
  parsed: ParsedDsl,
  promptIntent = "",
  capabilities: RuntimeCapabilities = {},
): Diagnostic[] {
  const errors: Diagnostic[] = [];

  parsed.outputs.files.forEach((directive) => {
    const binaryIntent = directive.formatId === "auto" ? binaryExtensionRequestedByPrompt(promptIntent) : undefined;
    if (binaryIntent) {
      errors.push({
        level: "error",
        line: directive.line,
        code: "binary_format_not_directly_generatable",
        message: `binary_format_not_directly_generatable: \`${binaryIntent}\` cannot be generated directly by an LLM.`,
      });
      return;
    }

    const format =
      directive.formatId === "auto"
        ? inferFileFormatFromText(promptIntent)
        : directive.formatId
          ? getFileFormatById(directive.formatId)
          : undefined;
    if (!format) return;
    if (format.generatorKind === "renderer") {
      errors.push({
        level: "error",
        line: directive.line,
        code: "missing_renderer",
        message: `${format.label} output requires a configured ${format.formatId.toUpperCase()} renderer.`,
      });
    }
  });

  if (parsed.outputs.images.length > 0 && !capabilities.imageGenerationEnabled) {
    const firstImageOutput = parsed.outputs.images[0];
    errors.push({
      level: "error",
      line: firstImageOutput.line,
      code: "missing_image_executor",
      message:
        parsed.outputs.images.length === 1
          ? "Image output is declared correctly, but image generation is not enabled in this build yet."
          : `Image output is declared correctly, but image generation is not enabled in this build yet. Requested ${parsed.outputs.images.length} image artifacts.`,
    });
  }

  return errors;
}

function buildPromptIntentText(cell: NotebookCell, context: RunContext): string {
  return `${cell.title} ${context.resolvedPromptBody ?? cell.promptBody}`;
}

export function createCellRunResult(
  cell: NotebookCell,
  parsed: ParsedDsl,
  settings: WorkspaceSettings,
  context: RunContext = {},
  rawOutput: string,
  options: CellRunResultOptions = {},
): CellRunResult {
  const runId = createId("run");
  const started = nowIso();
  const promptSize = cell.promptBody.length + cell.controlHeader.length;
  const latencyMs = options.latencyMs ?? 620 + Math.round(promptSize * 2.7) + parsed.chips.length * 130;
  const tokensIn = Math.max(64, Math.round(promptSize / 3.8));
  const tokensOut = Math.max(120, Math.round(rawOutput.length / 3.9));
  const costUsd = Number(((tokensIn + tokensOut) / 1000 * 0.012).toFixed(4));
  const vars = extractOutputVars(rawOutput);
  const decision = evaluateDecision(parsed, vars, cell.alias);
  const initialErrors = [...(context.referenceErrors ?? []), ...(options.errors ?? [])];
  const artifacts = initialErrors.length ? [] : createArtifacts(cell, parsed, runId, rawOutput, options.artifactContentByName);
  const errors = [...initialErrors, ...buildRunErrors(decision, artifacts)];
  const status = resolveStatus(decision, artifacts, errors);
  const providerRuns = options.providerRuns ?? buildProviderRuns(parsed, settings, status);
  const visibleOutput = buildVisibleOutput(rawOutput, parsed, artifacts, status, errors);
  const output = decorateOutput(visibleOutput, status, errors, providerRuns, settings, options.notice, options.noticeKind);
  const executionPlan = buildExecutionPlan(parsed, settings);

  return {
    output,
    status,
    artifacts,
    vars,
    decision,
    errors,
    run: {
      id: runId,
      startedAt: started,
      finishedAt: nowIso(),
      status,
      costUsd,
      latencyMs,
      tokensIn,
      tokensOut,
      summary: summarizeRun(status, parsed, artifacts, decision),
      providerRuns,
      inputResolved: context.inputResolved ?? parsed.references.map((reference) => reference.raw).join(", "),
      textOutputRaw: rawOutput,
      textOutputVisible: output,
      vars,
      decision,
      artifacts,
      executionPlan,
      errors,
    },
  };
}

export function extractOutputVars(output: string): ParsedVars {
  const trimmed = output.trim();
  const json = parseJsonObject(trimmed);
  if (json) return json;

  const vars: ParsedVars = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (!match) continue;
    vars[match[1]] = parseValue(match[2].trim());
  }

  return vars;
}

function evaluateDecision(parsed: ParsedDsl, vars: ParsedVars, sourceAlias: string): DecisionResult | undefined {
  if (parsed.flow.type !== "if") return undefined;

  const expression = parsed.flow.expression;
  if (!expression) {
    return {
      conditionRaw: parsed.flow.condition,
      variable: parsed.flow.condition,
      skippedTargets: [],
      error: `Cannot parse condition \`${parsed.flow.condition}\`.`,
    };
  }

  const actual = vars[expression.variable];
  if (actual === undefined) {
    return {
      conditionRaw: expression.raw,
      variable: expression.variable,
      operator: expression.operator,
      expected: expression.value,
      skippedTargets: [],
      error: `Variable \`${expression.variable}\` was not found in cell output. Expected JSON with key \`${expression.variable}\` or a parseable line like \`${expression.variable}=42\`.`,
    };
  }

  const result = expression.operator
    ? compareValues(actual, expression.operator, expression.value)
    : Boolean(actual);

  if (result === undefined) {
    return {
      conditionRaw: expression.raw,
      variable: expression.variable,
      operator: expression.operator,
      expected: expression.value,
      actual,
      skippedTargets: [],
      error: `Cannot evaluate \`${expression.raw}\` with value \`${String(actual)}\`.`,
    };
  }

  const routeTarget = result ? parsed.flow.target : parsed.flow.elseTarget;
  const skippedTargets = [result ? parsed.flow.elseTarget : parsed.flow.target]
    .filter((target): target is string => Boolean(target && target !== "stop" && target !== "done"));

  return {
    conditionRaw: expression.raw,
    variable: expression.variable,
    operator: expression.operator,
    expected: expression.value,
    actual,
    result,
    routeTarget,
    skippedTargets,
  };
}

function buildModelOutput(cell: NotebookCell, parsed: ParsedDsl, resolvedPromptBody = cell.promptBody): string {
  const text = `${cell.title}\n${resolvedPromptBody}`.toLowerCase();

  if (parsed.flow.type === "if" || text.includes("pnl")) {
    return ["pnl = -15.2", "reason = expected fee leakage exceeds alpha"].join("\n");
  }

  if (parsed.outputs.files.some((file) => file.name) || parsed.outputs.images.some((image) => image.name)) {
    return buildNamedArtifactPlaceholderOutput(cell, parsed);
  }

  if (parsed.outputs.files.some((file) => file.formatId === "json" || (file.extension ?? "").includes("json")) || text.includes("json config")) {
    return JSON.stringify(
      {
        strategy: "latency_sensitive_mean_reversion",
        risk_limit: 0.02,
        enabled: true,
      },
      null,
      2,
    );
  }

  if (parsed.outputs.files.length || parsed.outputs.images.length) {
    return [
      `# ${cell.title}`,
      "",
      "This generated artifact captures the requested notebook output in a reusable file.",
      "",
      "The content is intentionally stored as an immutable generated artifact for this run.",
    ].join("\n");
  }

  const routing =
    parsed.routing?.mode === "best"
      ? " The max selector would keep provider alternatives in run history."
      : parsed.routing?.mode === "synthesis"
        ? " The ensemble step would merge provider alternatives into one answer."
        : "";

  return [
    `Compiled prompt for ${cell.alias || "cell"}.`,
    "Provider execution is pending; this build returns a deterministic placeholder until provider adapters are enabled.",
    parsed.routing?.raw ? `Route: ${parsed.routing.raw}.${routing}` : `Route: workspace default.${routing}`,
  ].join("\n");
}

function buildNamedArtifactPlaceholderOutput(cell: NotebookCell, parsed: ParsedDsl): string {
  return [...parsed.outputs.files, ...parsed.outputs.images]
    .map((directive) => {
      const extension = defaultExtensionForDirective(directive);
      const displayName = directive.name ?? `${slugify(cell.title || cell.alias)}${extension}`;
      return [`--- file: ${displayName} ---`, placeholderArtifactBody(cell, directive)].join("\n");
    })
    .join("\n\n");
}

function placeholderArtifactBody(cell: NotebookCell, directive: FileOutputDirective | ImageOutputDirective): string {
  if (directive.channel === "image") {
    return "placeholder_image_data";
  }
  if (directive.formatId === "json" || directive.extension === ".json") {
    return JSON.stringify(
      {
        strategy: "latency_sensitive_mean_reversion",
        risk_limit: 0.02,
        enabled: true,
      },
      null,
      2,
    );
  }
  return [
    `# ${cell.title}`,
    "",
    "This generated artifact captures the requested notebook output in a reusable file.",
    "",
    "The content is intentionally stored as an immutable generated artifact for this run.",
  ].join("\n");
}

function decorateOutput(
  output: string,
  status: CellStatus,
  errors: Diagnostic[],
  providerRuns: RunRecord["providerRuns"],
  settings: WorkspaceSettings,
  notice?: string,
  noticeKind: CellRunResultOptions["noticeKind"] = "runtime",
): string {
  if (errors.length || status !== "completed") return output;
  if (!notice) return output;

  const decoratedNotice =
    noticeKind === "simulation" ? buildSimulationNotice(notice, providerRuns, settings) : notice;
  return `${decoratedNotice}\n\n${output}`;
}

function buildSimulationNotice(notice: string, providerRuns: RunRecord["providerRuns"], settings: WorkspaceSettings): string {
  const linkedRoute = providerRuns.some((run) =>
    settings.providers.some((provider) => provider.enabled && provider.apiKeyMasked && matchesProviderRun(run.provider, provider)),
  );
  const routeSummary = providerRuns.length
    ? `Resolved route: ${providerRuns.map((run) => `${run.provider} / ${run.model}`).join(", ")}.`
    : "";
  const linkedKeyNote = linkedRoute
    ? "Linked key detected for this route, but the current build keeps only masked key references and provider execution adapters are not enabled yet."
    : "";

  return [notice, linkedKeyNote, routeSummary].filter(Boolean).join("\n");
}

function matchesProviderRun(runProvider: string, provider: WorkspaceSettings["providers"][number]): boolean {
  const normalizedRunProvider = normalizeRunProvider(runProvider);
  return [provider.alias, provider.label, provider.provider, provider.id].some(
    (value) => normalizeRunProvider(value) === normalizedRunProvider,
  );
}

function normalizeRunProvider(value: string): string {
  return value.trim().toLowerCase();
}

function createArtifacts(
  cell: NotebookCell,
  parsed: ParsedDsl,
  runId: string,
  rawOutput: string,
  artifactContentByName: Record<string, ArtifactContentOverride> = {},
): Artifact[] {
  return [...parsed.outputs.files, ...parsed.outputs.images].map((directive) => {
    const provisionalName = directive.name ?? `${slugify(cell.title || cell.alias)}${defaultExtensionForDirective(directive)}`;
    const provisionalOverride = artifactContentByName[provisionalName];
    const resolved = resolveArtifactDirective(cell, directive, rawOutput, Boolean(provisionalOverride));
    const displayName = resolved.displayName;
    const resolvedOverride = provisionalOverride ?? artifactContentByName[displayName];
    const version = nextArtifactVersion(cell.artifacts ?? [], displayName);
    const formattedContent = resolved.error || resolvedOverride
      ? { content: "" }
      : formatArtifactContent(resolved.format, rawOutput, displayName, Boolean(directive.name));
    const content = resolvedOverride?.content ?? formattedContent.content;
    const createdAt = nowIso();
    const error = resolved.error ?? formattedContent.error ?? validateArtifact(resolved.format, content);
    const id = createId("art");
    const sizeBytes = resolvedOverride?.sizeBytes ?? new Blob([content]).size;

    return {
      id,
      cellId: cell.id,
      cellAlias: cell.alias,
      runId,
      displayName,
      extension: resolved.extension,
      mimeType: resolvedOverride?.mimeType ?? resolved.format.mimeType ?? MIME_BY_EXTENSION[resolved.extension] ?? "text/plain",
      version,
      storageKey: `cells/${cell.alias}/runs/${runId}/${id}${resolved.extension}`,
      sizeBytes,
      content,
      status: error ? "failed" : "created",
      error,
      createdAt,
      metadata: {
        autoNamed: directive.autoName || Boolean(directive.autoSelected),
        channel: directive.channel ?? "file",
        formatId: resolved.format.formatId,
        generatorKind: resolved.format.generatorKind,
        viewer: resolved.format.viewer,
        source: "llm_output",
      },
    };
  });
}

function defaultExtensionForDirective(directive: FileOutputDirective | ImageOutputDirective): string {
  if (directive.extension) return directive.extension;
  if (directive.channel === "image") {
    const format = directive.formatId === "auto" ? getImageFormatById("png") : getImageFormatById(directive.formatId);
    return format?.defaultExtension ?? ".png";
  }
  const format = directive.formatId === "auto" ? getFileFormatById("markdown") : directive.formatId ? getFileFormatById(directive.formatId) : undefined;
  return format?.defaultExtension ?? ".md";
}

function resolveArtifactDirective(
  cell: NotebookCell,
  directive: FileOutputDirective | ImageOutputDirective,
  rawOutput: string,
  hasExternalContent = false,
): {
  format: FormatRegistryEntry;
  displayName: string;
  extension: string;
  error?: string;
} {
  if (directive.channel === "image") {
    const format = directive.formatId === "auto" ? getImageFormatById("png")! : getImageFormatById(directive.formatId);
    if (!format) {
      return fallbackArtifactResolution(cell, directive, ".png", "unsupported_format");
    }
    return {
      format,
      extension: directive.extension ?? format.defaultExtension,
      displayName: directive.name ?? `${slugify(cell.title || cell.alias)}${format.defaultExtension}`,
      error: hasExternalContent ? undefined : "missing_image_executor: Image generation is not enabled in this build yet.",
    };
  }

  const resolvedFormat =
    directive.formatId === "auto"
      ? inferFileFormat(cell, rawOutput)
      : directive.formatId
        ? getFileFormatById(directive.formatId)
        : directive.extension
          ? getFileFormatByExtension(directive.extension)
          : getFileFormatById("markdown");
  if (!resolvedFormat) {
    return fallbackArtifactResolution(cell, directive, directive.extension ?? ".md", "unsupported_format");
  }

  const extension = directive.formatId === "auto" ? resolvedFormat.defaultExtension : directive.extension ?? resolvedFormat.defaultExtension;
  const requestedBinary = BINARY_FILE_EXTENSIONS.has(extension);
  const rendererMissing = resolvedFormat.generatorKind === "renderer";
  const displayName = directive.name ?? `${slugify(cell.title || cell.alias)}${extension}`;

  return {
    format: resolvedFormat,
    extension,
    displayName,
    error: requestedBinary
      ? `binary_format_not_directly_generatable: \`${extension}\` cannot be generated directly by an LLM.`
      : rendererMissing
        ? `missing_renderer: ${resolvedFormat.label} output requires a configured ${resolvedFormat.formatId.toUpperCase()} renderer.`
        : undefined,
  };
}

function fallbackArtifactResolution(
  cell: NotebookCell,
  directive: FileOutputDirective | ImageOutputDirective,
  extension: string,
  error: string,
): {
  format: FormatRegistryEntry;
  displayName: string;
  extension: string;
  error: string;
} {
  const format =
    directive.channel === "image"
      ? getImageFormatById("png")!
      : getFileFormatById("markdown")!;
  return {
    format,
    displayName: directive.name ?? `${slugify(cell.title || cell.alias)}${extension}`,
    extension,
    error,
  };
}

function buildVisibleOutput(
  rawOutput: string,
  parsed: ParsedDsl,
  artifacts: Artifact[],
  status: CellStatus,
  errors: Diagnostic[],
): string {
  if (errors.length && status !== "artifact_error" && status !== "partial_failed") {
    return errors.map((error) => error.message).join("\n");
  }

  const createdArtifacts = artifacts.filter((artifact) => artifact.status === "created");
  const failedArtifacts = artifacts.filter((artifact) => artifact.status === "failed");
  const hasArtifactDirective = parsed.outputs.files.length > 0 || parsed.outputs.images.length > 0;
  const textDirective = parsed.outputs.text;
  const artifactLines = formatArtifactSummary(createdArtifacts, failedArtifacts);

  if (hasArtifactDirective && !textDirective) {
    return artifactLines || "No artifacts created.";
  }

  if (textDirective?.limitChars && artifactLines) {
    return `${rawOutput}\n\n${artifactLines}`;
  }

  if (artifactLines) {
    return `${rawOutput}\n\n${artifactLines}`;
  }

  return rawOutput;
}

function buildRunErrors(decision: DecisionResult | undefined, artifacts: Artifact[]): Diagnostic[] {
  const errors: Diagnostic[] = [];

  if (decision?.error) {
    errors.push({ level: "error", message: `Decision error: ${decision.error}` });
  }

  artifacts
    .filter((artifact) => artifact.status === "failed")
    .forEach((artifact) => {
      errors.push({
        level: "error",
        message: `Artifact error: failed to create ${artifact.displayName}. ${artifact.error}`,
      });
    });

  return errors;
}

function resolveStatus(
  decision: DecisionResult | undefined,
  artifacts: Artifact[],
  errors: Diagnostic[],
): CellStatus {
  if (errors.some((error) => error.message.startsWith("Reference error:"))) return "reference_error";
  if (errors.some((error) => error.code === "timeout")) return "timeout";
  if (errors.some((error) => error.code === "cancelled")) return "cancelled";
  if (
    errors.some(
      (error) =>
        error.message.startsWith("Configuration error:") ||
        error.code === "missing_renderer" ||
        error.code === "missing_image_executor" ||
        error.code === "capability_mismatch" ||
        error.code === "unsupported_format" ||
        error.code === "unknown_extension" ||
        error.code === "format_extension_mismatch" ||
        error.code === "binary_format_not_directly_generatable" ||
        error.code === "image_format_requires_image_channel",
    )
  ) {
    return "config_error";
  }
  if (decision?.error) return "decision_error";
  if (artifacts.some((artifact) => artifact.status === "failed") && artifacts.some((artifact) => artifact.status === "created")) {
    return "partial_failed";
  }
  if (artifacts.some((artifact) => artifact.status === "failed")) return "artifact_error";
  if (errors.length) return "failed";
  return "completed";
}

function buildExecutionPlan(parsed: ParsedDsl, settings: WorkspaceSettings): string[] {
  const fallback = fallbackProvider(settings);
  const selectorLine =
    parsed.routing?.mode === "best"
      ? [`selector: ${settings.orchestration.selectorModel}`]
      : parsed.routing?.mode === "synthesis"
        ? [`ensemble: ${settings.orchestration.synthesisModel}`]
        : [];
  const fallbackLine = `fallback order: ${settings.providers
    .filter((provider) => provider.enabled)
    .map((provider) => provider.alias)
    .join(" > ") || fallback?.alias || "none"}`;

  return [
    `routing: ${parsed.routing?.raw ?? fallback?.alias ?? settings.orchestration.fallbackProvider}`,
    `mode: ${parsed.routing?.mode ?? "single"}`,
    ...selectorLine,
    `constraints: ${describeConstraints(parsed)}`,
    `flow: ${describeFlow(parsed)}`,
    `outputs: ${describeOutputs(parsed)}`,
    fallbackLine,
  ];
}

function buildProviderRuns(parsed: ParsedDsl, settings: WorkspaceSettings, status: CellStatus): RunRecord["providerRuns"] {
  const fallback = fallbackProvider(settings);
  const providers: ProviderSelection[] = parsed.routing?.providers.length
    ? parsed.routing.providers
    : fallback
      ? [{ provider: fallback.id, alias: fallback.alias, label: fallback.label, model: fallback.defaultModel }]
      : [{ provider: settings.orchestration.fallbackProvider, model: "workspace default" }];

  return providers.map((provider) => {
    const configured = settings.providers.find(
      (candidate) =>
        candidate.id === provider.provider ||
        candidate.provider === provider.provider ||
        candidate.alias.toLowerCase() === (provider.alias ?? "").toLowerCase(),
    );

    return {
      provider: provider.alias ?? configured?.alias ?? provider.provider,
      model: providerModelForProfile(configured, provider.profile, provider.model),
      status,
    };
  });
}

function summarizeRun(
  status: CellStatus,
  parsed: ParsedDsl,
  artifacts: Artifact[],
  decision: DecisionResult | undefined,
): string {
  if (decision?.error) return "Decision could not be evaluated.";
  if (status === "timeout") return "Provider latency limit exceeded.";
  if (artifacts.some((artifact) => artifact.status === "failed")) return "Completed with artifact errors.";
  if (decision?.routeTarget) return `Decision routed to ${decision.routeTarget}.`;
  if (artifacts.length) return `Created ${artifacts.length} artifact(s).`;
  return `Completed with ${parsed.chips.join(", ") || "default routing"}.`;
}

function compareValues(
  actual: string | number | boolean,
  operator: string,
  expected: string | number | boolean | undefined,
): boolean | undefined {
  if (expected === undefined) return undefined;

  if (typeof actual === "number" && typeof expected === "number") {
    if (operator === ">") return actual > expected;
    if (operator === ">=") return actual >= expected;
    if (operator === "<") return actual < expected;
    if (operator === "<=") return actual <= expected;
    if (operator === "==") return actual === expected;
    if (operator === "!=") return actual !== expected;
  }

  if (operator === "==") return actual === expected;
  if (operator === "!=") return actual !== expected;
  return undefined;
}

function parseJsonObject(text: string): ParsedVars | undefined {
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) =>
        ["string", "number", "boolean"].includes(typeof value),
      ),
    ) as ParsedVars;
  } catch {
    return undefined;
  }
}

function parseValue(value: string): string | number | boolean {
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/^["']|["']$/g, "");
}

function describeConstraints(parsed: ParsedDsl): string {
  const parts = [
    parsed.constraints.costMaxUsd ? `$${parsed.constraints.costMaxUsd}` : undefined,
    parsed.constraints.latencyMaxSec ? `${parsed.constraints.latencyMaxSec}s` : undefined,
    parsed.constraints.tokensMax ? `${parsed.constraints.tokensMax} tokens` : undefined,
    parsed.constraints.iterationsMax ? `${parsed.constraints.iterationsMax} iterations` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "none";
}

function describeFlow(parsed: ParsedDsl): string {
  const flow = parsed.flow;

  if (flow.type === "forward") return `${flow.autorun ? "autorun forward" : "forward"} to ${flow.target}`;
  if (flow.type === "chain") return `${flow.loop ? "loop chain" : "chain"} ${flow.nodes.join(" > ")}`;
  if (flow.type === "if") return `if ${flow.condition} -> ${flow.target}`;
  if (flow.type === "input") return "flow input placeholder";
  return "none";
}

function describeOutputs(parsed: ParsedDsl): string {
  const parts = [
    parsed.outputs.text ? `text${parsed.outputs.text.limitChars ? ` <${parsed.outputs.text.limitChars}` : ""}` : undefined,
    parsed.outputs.files.length ? `${parsed.outputs.files.length} file(s)` : undefined,
    parsed.outputs.images.length ? `${parsed.outputs.images.length} image(s)` : undefined,
    parsed.outputs.uses.length ? `${parsed.outputs.uses.length} artifact input(s)` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "text";
}

function inferFileFormat(cell: NotebookCell, rawOutput: string): FormatRegistryEntry {
  const inferred = inferFileFormatFromText(`${cell.title} ${cell.promptBody} ${rawOutput}`);
  if (inferred) return inferred;
  return getFileFormatById("markdown")!;
}

function inferFileFormatFromText(value: string): FormatRegistryEntry | undefined {
  const text = value.toLowerCase();
  if (text.includes("pdf")) return getFileFormatById("pdf")!;
  if (/\bdocx\b/.test(text) || text.includes("word document")) return getFileFormatById("docx")!;
  if (/\bxlsx\b/.test(text) || text.includes("spreadsheet") || text.includes("excel")) return getFileFormatById("xlsx")!;
  if (text.includes("json")) return getFileFormatById("json")!;
  if (text.includes("csv") || text.includes("table") || text.includes("таблиц")) return getFileFormatById("csv")!;
  if (text.includes("html")) return getFileFormatById("html")!;
  if (text.includes("svg")) return getFileFormatById("svg")!;
  if (text.includes("mermaid") || text.includes("diagram") || text.includes("диаграм")) return getFileFormatById("mermaid")!;
  if (text.includes("patch") || text.includes("diff")) return getFileFormatById("diff")!;
  if (text.includes("typescript")) return getFileFormatById("typescript")!;
  if (text.includes("javascript")) return getFileFormatById("javascript")!;
  if (text.includes("python") || text.includes("питон")) return getFileFormatById("python")!;
  if (text.includes("sql")) return getFileFormatById("sql")!;
  if (text.includes("markdown") || text.includes("readme") || text.includes("тз") || text.includes("отчет")) {
    return getFileFormatById("markdown")!;
  }
  return undefined;
}

function binaryExtensionRequestedByPrompt(value: string): string | undefined {
  const text = value.toLowerCase();
  return Array.from(BINARY_FILE_EXTENSIONS).find((extension) => {
    const bare = extension.slice(1);
    return text.includes(extension) || new RegExp(`\\b${bare}\\b`).test(text);
  }) ?? (/\barchive\b/.test(text) ? ".zip" : undefined);
}

function formatArtifactContent(
  format: FormatRegistryEntry,
  rawOutput: string,
  displayName: string,
  requireNamedSection = false,
): { content: string; error?: string } {
  const extractedSection = extractArtifactSection(rawOutput, displayName);
  if (requireNamedSection && extractedSection === undefined) {
    return {
      content: "",
      error: `missing_artifact_section: expected a \`--- file: ${displayName} ---\` section in provider output.`,
    };
  }
  const source = extractedSection ?? rawOutput;
  const extension = format.defaultExtension;

  if (extension === ".json") {
    const parsed = parseJsonObject(source);
    return { content: JSON.stringify(parsed ?? { title: displayName, content: source }, null, 2) };
  }

  if (extension === ".csv") {
    return { content: "field,value\nsummary," + JSON.stringify(source.split(/\r?\n/)[0] ?? displayName) };
  }

  if (extension === ".html") {
    return { content: `<!doctype html><html><body><pre>${escapeHtml(source)}</pre></body></html>` };
  }

  if (extension === ".xml") {
    return { content: `<?xml version="1.0" encoding="UTF-8"?>\n<document><content>${escapeHtml(source)}</content></document>\n` };
  }

  return { content: source };
}

function artifactOutputContractLines(directives: Array<FileOutputDirective | ImageOutputDirective>): string[] {
  const namedDirectives = directives.filter((directive) => directive.name);
  if (!namedDirectives.length) return [];

  return [
    "- Produce the requested artifacts as separate sections.",
    "- Start each artifact section with a line exactly like `--- file: <filename> ---`.",
    "- Do not merge multiple named artifacts into one section.",
    ...namedDirectives.map((directive) => `- Required artifact: ${directive.name}`),
  ];
}

function extractArtifactSection(rawOutput: string, displayName: string): string | undefined {
  const lines = rawOutput.split(/\r?\n/);
  const start = lines.findIndex((line) => artifactMarkerName(line) === displayName);
  if (start === -1) return undefined;

  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (artifactMarkerName(lines[index])) break;
    body.push(lines[index]);
  }

  return body.join("\n").trim();
}

function artifactMarkerName(line: string): string | undefined {
  const match = line.trim().match(/^---\s*(?:file|artifact):\s*(.+?)\s*---$/i);
  return match?.[1].trim();
}

function validateArtifact(format: FormatRegistryEntry, content: string): string | undefined {
  const extension = format.defaultExtension;
  if (format.channel === "image") {
    if (!content.trim()) return "invalid_generated_image: missing image data";
    return undefined;
  }

  if (extension === ".json") {
    try {
      JSON.parse(content);
    } catch {
      return "invalid_generated_json: invalid JSON";
    }
  }

  if (extension === ".csv" && !content.includes(",")) return "invalid_generated_csv: CSV malformed";
  if (extension === ".svg" && /<script\b/i.test(content)) return "unsafe_svg: SVG contains a script tag";
  return undefined;
}

function nextArtifactVersion(existing: Artifact[], displayName: string): number {
  const versions = existing
    .filter((artifact) => artifact.displayName === displayName)
    .map((artifact) => artifact.version);

  return versions.length ? Math.max(...versions) + 1 : 1;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "artifact";
}

function formatArtifactLine(artifact: Artifact): string {
  return `${artifactIcon(artifact.extension)} ${artifact.displayName}${artifact.version > 1 ? ` v${artifact.version}` : ""}`;
}

function formatArtifactSummary(createdArtifacts: Artifact[], failedArtifacts: Artifact[]): string {
  const sections: string[] = [];
  if (createdArtifacts.length) {
    sections.push(`Created:\n${createdArtifacts.map(formatArtifactLine).join("\n")}`);
  }
  if (failedArtifacts.length) {
    sections.push(
      `Failed:\n${failedArtifacts
        .map((artifact) => `${formatArtifactLine(artifact)} - ${artifact.error ?? "artifact_generation_failed"}`)
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export function artifactIcon(extension: string): string {
  if ([".json", ".yaml", ".yml"].includes(extension)) return "[json]";
  if ([".csv", ".xlsx"].includes(extension)) return "[table]";
  if (extension === ".pdf") return "[pdf]";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "[image]";
  if (extension === ".html") return "[html]";
  if (extension === ".svg") return "[svg]";
  if ([".mmd", ".mermaid"].includes(extension)) return "[diagram]";
  if ([".diff", ".patch"].includes(extension)) return "[diff]";
  if (extension === ".zip") return "[zip]";
  if ([".py", ".ts", ".tsx", ".js", ".jsx", ".sql"].includes(extension)) return "{}";
  return "[file]";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

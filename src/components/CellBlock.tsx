import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  FileText,
  GripVertical,
  Maximize2,
  Minimize2,
  Paperclip,
  Play,
  Plus,
  Square,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { attachmentToBlob, fileKindLabel, formatBytes } from "../domain/attachments";
import {
  combineCellSource,
  getLeadingHeaderEndLine,
  serviceLineClass,
  splitUnifiedCellSource,
} from "../domain/cellSource";
import { modelChoicesForProviderSettings } from "../domain/modelCatalog";
import { getSupportedFileFormats, getSupportedImageFormats, parseCellDsl } from "../language/latest";
import { hasLegacyIccSyntax, migrateLegacyIccSyntax } from "../language/latest";
import { providerAliasOptions } from "../domain/providerAliases";
import { artifactIcon } from "../domain/runtime";
import type { Artifact, CellAttachment, Diagnostic, NotebookCell, ParsedDsl, ProviderSelection, WorkspaceSettings } from "../domain/types";

interface CellBlockProps {
  cell: NotebookCell;
  cells: NotebookCell[];
  knownAliases: string[];
  settings: WorkspaceSettings;
  selected: boolean;
  running: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<NotebookCell>) => void;
  onAddAfter: () => void;
  onAddTextAfter: () => void;
  onRun: () => void;
  onRunFromHere: () => void;
  onStop: () => void;
  onAttachFiles: (files: File[] | FileList) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  onOpenArtifact: (artifactId: string) => void;
}

export function CellBlock({
  cell,
  cells,
  knownAliases,
  settings,
  selected,
  running,
  isFirst,
  isLast,
  onSelect,
  onUpdate,
  onAddAfter,
  onAddTextAfter,
  onRun,
  onRunFromHere,
  onStop,
  onAttachFiles,
  onRemoveAttachment,
  onDuplicate,
  onDelete,
  onMove,
  onOpenArtifact,
}: CellBlockProps) {
  const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
    knownAliases,
    providerAliases: providerAliasOptions(settings),
    defaultLoopIterations: settings.orchestration.defaultLoopIterations,
    maxLoopIterations: settings.orchestration.maxLoopIterations,
    cells: cells.filter((candidate) => candidate.kind !== "text"),
  });
  const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.level === "error");
  const flowReferenceWarnings = buildForwardReferenceWarnings(cell, cells, knownAliases, settings, parsed);
  const hasLegacySyntax = hasLegacyIccSyntax(`${cell.controlHeader}\n${cell.promptBody}`);
  const [editorFocused, setEditorFocused] = useState(false);
  const [activeEditorLine, setActiveEditorLine] = useState(1);
  const [committedEditorLines, setCommittedEditorLines] = useState<Set<number>>(() => new Set());
  const [forceDiagnostics, setForceDiagnostics] = useState(false);
  const revealAllDiagnostics =
    forceDiagnostics ||
    !editorFocused ||
    cell.status === "parse_error" ||
    cell.status === "reference_error" ||
    cell.status === "config_error" ||
    cell.status === "timeout";
  const visibleDiagnostics = diagnosticsForEditorState([...parsed.diagnostics, ...flowReferenceWarnings], {
    activeLine: activeEditorLine,
    committedLines: committedEditorLines,
    revealAll: revealAllDiagnostics,
  });
  const hasVisibleErrors = visibleDiagnostics.some((diagnostic) => diagnostic.level === "error");
  const visibleChips = chipsForDisplay(parsed, visibleDiagnostics.length > 0);
  const statusClass = running ? "running" : cell.status;
  const createdArtifacts = cell.artifacts.filter((artifact) => artifact.status === "created");
  const compact = cell.viewMode === "compact";
  const shouldShowResult = hasRenderableResult(cell, running);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    setCommittedEditorLines(new Set());
    setForceDiagnostics(false);
    setActiveEditorLine(1);
  }, [cell.id]);

  useEffect(() => {
    if (!hasErrors) setForceDiagnostics(false);
  }, [hasErrors]);

  async function copyOutput() {
    await navigator.clipboard?.writeText(cell.output);
  }

  async function copyReference() {
    await navigator.clipboard?.writeText(`%from ${cell.alias}`);
  }

  function migrateLegacySyntax() {
    const legacySources = findLegacyInputSources(cells, cell.alias, knownAliases, settings);
    const inputSourceAlias = legacySources.length === 1 ? legacySources[0] : undefined;
    if (`${cell.controlHeader}\n${cell.promptBody}`.match(/(^|[^%])%input\b|(^|\s)@input(?=\s|$)/i) && !inputSourceAlias) {
      window.alert(
        "Cannot migrate %input automatically: source is ambiguous. Choose a source cell and replace it with %from cN.",
      );
    }

    onUpdate({
      controlHeader: migrateLegacyIccSyntax(cell.controlHeader, { inputSourceAlias }),
      promptBody: migrateLegacyIccSyntax(cell.promptBody, { inputSourceAlias }),
    });
  }

  function updateEditorSource(patch: Partial<NotebookCell>) {
    setForceDiagnostics(false);
    onUpdate(patch);
  }

  function handleRunClick() {
    setForceDiagnostics(true);
    setCommittedEditorLines(allSourceLines(cell));
    onRun();
  }

  function handleRunFromHereClick() {
    setForceDiagnostics(true);
    setCommittedEditorLines(allSourceLines(cell));
    onRunFromHere();
  }

  function openFilePicker() {
    attachmentInputRef.current?.click();
  }

  function attachSelectedFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files?.length) onAttachFiles(files);
    event.currentTarget.value = "";
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropActive(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (event.dataTransfer.files.length) onAttachFiles(event.dataTransfer.files);
  }

  return (
    <article
      id={`cell-${cell.alias}`}
      className={`cell-block ${compact ? "is-compact" : ""} ${selected ? "is-selected" : ""} ${hasVisibleErrors ? "has-errors" : ""} ${dropActive ? "is-drop-target" : ""}`}
      onClick={onSelect}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={attachmentInputRef}
        className="visually-hidden"
        type="file"
        multiple
        onChange={attachSelectedFiles}
        aria-label={`Attach files to ${cell.alias}`}
      />
      {dropActive && (
        <div className="cell-drop-overlay">
          <Upload size={18} />
          Drop files into {cell.alias}
        </div>
      )}
      <div className="cell-topbar">
        <div className="cell-title-group">
          <GripVertical className="drag-handle" size={16} />
          <span className={`status-dot ${statusClass}`} title={cell.status} />
          <span className="cell-alias">{cell.alias}</span>
          <input
            className="cell-title-input"
            value={cell.title}
            onChange={(event) => onUpdate({ title: event.target.value })}
            onClick={(event) => event.stopPropagation()}
            aria-label={`${cell.alias} title`}
          />
        </div>
        <div className="cell-actions">
          <button
            type="button"
            onClick={() => onUpdate({ viewMode: compact ? "expanded" : "compact" })}
            title={compact ? "Expand cell" : "Collapse cell"}
          >
            {compact ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openFilePicker();
            }}
            title="Attach files"
          >
            <Paperclip size={15} />
          </button>
          {running ? (
            <button type="button" onClick={onStop} title="Stop">
              <Square size={15} />
            </button>
          ) : (
            <button type="button" onClick={handleRunClick} title="Run cell">
              <Play size={15} />
            </button>
          )}
          <button type="button" onClick={onDuplicate} title="Duplicate">
            <Copy size={15} />
          </button>
          <button type="button" onClick={() => onMove("up")} disabled={isFirst} title="Move up">
            <ArrowUp size={15} />
          </button>
          <button type="button" onClick={() => onMove("down")} disabled={isLast} title="Move down">
            <ArrowDown size={15} />
          </button>
          <button type="button" onClick={copyReference} title="Copy cell reference">
            <Clipboard size={15} />
          </button>
          <button type="button" onClick={onDelete} title="Delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="chip-row">
        <ProviderRouteChips parsed={parsed} settings={settings} />
        {visibleChips.map((chip, index) => (
          <span className={`chip ${chipClass(chip)}`} key={`${chip}-${index}`}>
            {chip}
          </span>
        ))}
        {createdArtifacts.slice(0, 3).map((artifact) => (
          <button
            className="artifact-chip"
            key={artifact.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenArtifact(artifact.id);
            }}
            title={`Open ${artifact.displayName}`}
          >
            {artifactIcon(artifact.extension)} {artifact.displayName}
            {artifact.version > 1 ? ` v${artifact.version}` : ""}
          </button>
        ))}
        {createdArtifacts.length > 3 && <span className="chip neutral">+{createdArtifacts.length - 3}</span>}
      </div>

      {compact ? (
        <CompactBody cell={cell} controlSummary={summarizeControl(parsed)} running={running} />
      ) : (
        <>
          {visibleDiagnostics.length > 0 && (
            <div className="diagnostic-strip">
              {visibleDiagnostics.map((diagnostic, index) => (
                <p key={`${diagnostic.message}-${index}`} className={diagnostic.level}>
                  {diagnostic.line ? `Line ${diagnostic.line}: ` : ""}
                  {diagnostic.message}
                </p>
              ))}
              {hasLegacySyntax && (
                <button type="button" className="diagnostic-action" onClick={migrateLegacySyntax}>
                  Convert to current ICC syntax
                </button>
              )}
            </div>
          )}

          {cell.staleReason && <p className="stale-note">{cell.staleReason}</p>}

          <div className="cell-editor-grid">
            <div className="section-toggle">
              <button
                type="button"
                onClick={() => onUpdate({ collapsedPrompt: !cell.collapsedPrompt })}
                title={cell.collapsedPrompt ? "Expand prompt" : "Collapse prompt"}
              >
                {cell.collapsedPrompt ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                Prompt / code
              </button>
            </div>

            {!cell.collapsedPrompt && (
              <UnifiedCellEditor
        cell={cell}
        cells={cells}
        knownAliases={knownAliases}
        hasErrors={hasVisibleErrors}
                settings={settings}
                onUpdate={updateEditorSource}
                onFocusChange={setEditorFocused}
                onActiveLineChange={setActiveEditorLine}
                onLineCommit={(line) => setCommittedEditorLines((current) => new Set(current).add(line))}
                onCommitAll={() => setCommittedEditorLines(allSourceLines(cell))}
              />
            )}
            {!cell.collapsedPrompt && (
              <AttachmentTray
                attachments={cell.attachments}
                onAttachClick={openFilePicker}
                onRemoveAttachment={onRemoveAttachment}
              />
            )}

            {shouldShowResult && (
              <>
                <div className="section-toggle">
                  <button
                    type="button"
                    onClick={() => onUpdate({ collapsedOutput: !cell.collapsedOutput })}
                    title={cell.collapsedOutput ? "Expand result" : "Collapse result"}
                  >
                    {cell.collapsedOutput ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    Result
                  </button>
                  <button type="button" onClick={copyOutput} title="Copy output" disabled={!cell.output}>
                    <Clipboard size={15} />
                  </button>
                </div>

                {!cell.collapsedOutput && <ResultBlock cell={cell} running={running} />}
              </>
            )}

            {createdArtifacts.length > 0 && (
              <section className="artifact-section">
                <div className="artifact-section-heading">
                  <span>Generated files</span>
                  {!cell.output.trim() && <small>Text output cleared; files retained.</small>}
                </div>
                <div className="artifact-list">
                  {createdArtifacts.map((artifact) => (
                    <ArtifactRow
                      key={artifact.id}
                      artifact={artifact}
                      onOpenArtifact={onOpenArtifact}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <div className="insert-cell-controls" aria-label={`Insert after ${cell.alias}`}>
        <button type="button" onClick={onAddAfter} aria-label={`Add intent cell after ${cell.alias}`} title="Add intent cell">
          <Plus size={14} />
        </button>
        <button type="button" onClick={onAddTextAfter} aria-label={`Add text block after ${cell.alias}`} title="Add text block">
          <Type size={14} />
        </button>
      </div>
    </article>
  );
}

function ProviderRouteChips({ parsed, settings }: { parsed: ParsedDsl; settings: WorkspaceSettings }) {
  const routing = parsed.routing;
  if (!routing) return null;

  if (routing.providers.length === 0) {
    return (
      <span className="provider-chip provider-chip-auto">
        <span>{titleCase(routing.mode)}</span>
      </span>
    );
  }

  const routingBadge =
    routing.mode === "best" || routing.mode === "synthesis"
      ? routing.method ?? (routing.mode === "synthesis" ? "ensemble" : routing.mode)
      : routing.mode === "parallel"
        ? "multi"
        : undefined;

  return (
    <>
      {routing.providers.map((provider, index) => {
        const microBadges = providerMicroBadges(provider, routingBadge);
        return (
          <span
            className={`provider-chip ${microBadges.length ? "has-microbadges" : ""}`}
            key={`${provider.provider}-${provider.alias ?? provider.model ?? index}`}
            title={providerTooltip(provider, settings)}
          >
            <span className="provider-chip-label">{providerDisplayName(provider, settings)}</span>
            {microBadges.length > 0 && (
              <span className="provider-chip-microbadges" aria-label={microBadges.join(", ")}>
                {microBadges.map((badge) => (
                  <span className={`provider-chip-micro ${microBadgeClass(badge)}`} key={badge}>
                    {badge}
                  </span>
                ))}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

function chipsForDisplay(parsed: ParsedDsl, showHeaderErrors: boolean): string[] {
  const base = parsed.routing ? parsed.chips.slice(1) : parsed.chips;
  return base
    .filter((chip) => !["best", "max", "ensemble", "multi"].includes(chip))
    .filter((chip) => showHeaderErrors || chip !== "header error");
}

interface EditorStateForDiagnostics {
  activeLine: number;
  committedLines: Set<number>;
  revealAll: boolean;
}

function diagnosticsForEditorState(diagnostics: Diagnostic[], state: EditorStateForDiagnostics): Diagnostic[] {
  if (state.revealAll) return diagnostics;
  return diagnostics.filter((diagnostic) => {
    if (!diagnostic.line) return false;
    if (diagnostic.line === state.activeLine) return false;
    return state.committedLines.has(diagnostic.line);
  });
}

function allSourceLines(cell: NotebookCell): Set<number> {
  const lineCount = combineCellSource(cell.controlHeader, cell.promptBody).split(/\r?\n/).length;
  return new Set(Array.from({ length: lineCount }, (_value, index) => index + 1));
}

function providerMicroBadges(provider: ProviderSelection, routingBadge?: string): string[] {
  const badges = [
    provider.profile && provider.profile !== "default" ? provider.profile : undefined,
    provider.model ? modelBadgeLabel(provider.model) : undefined,
    routingBadge,
  ].filter(Boolean) as string[];

  return [...new Set(badges)];
}

function modelBadgeLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";

  const segment = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  const [name, variant] = segment.split(":");

  if (name === "auto" || name === "fusion") return name;
  if (variant === "free") return `${name}:free`;
  return name;
}

function microBadgeClass(badge: string): string {
  if (badge === "best" || badge === "ensemble" || badge === "multi") return "routing";
  if (badge === "max" || badge === "cheap" || badge === "fast" || badge === "code" || badge === "reasoning") return "profile";
  return "model";
}

function providerDisplayName(provider: ProviderSelection, settings: WorkspaceSettings): string {
  const configured = settings.providers.find(
    (candidate) =>
      candidate.id === provider.provider ||
      candidate.provider === provider.provider ||
      normalizeProviderKey(candidate.alias) === normalizeProviderKey(provider.alias ?? "") ||
      normalizeProviderKey(candidate.id) === normalizeProviderKey(provider.alias ?? ""),
  );

  return provider.alias ?? configured?.alias ?? provider.label ?? configured?.label ?? titleCase(String(provider.provider));
}

function providerTooltip(provider: ProviderSelection, settings: WorkspaceSettings): string {
  const configured = settings.providers.find(
    (candidate) =>
      candidate.id === provider.provider ||
      candidate.provider === provider.provider ||
      normalizeProviderKey(candidate.alias) === normalizeProviderKey(provider.alias ?? ""),
  );
  const pieces = [
    providerDisplayName(provider, settings),
    provider.profile && provider.profile !== "default" ? `profile: ${provider.profile}` : undefined,
    provider.model ? `model: ${provider.model}` : undefined,
    configured ? `provider: ${configured.label}` : undefined,
  ].filter(Boolean);

  return pieces.join(" · ");
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

function titleCase(value: string): string {
  return value
    .replace(/(^|[-_\s])(\w)/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`)
    .trim();
}

function UnifiedCellEditor({
  cell,
  cells,
  knownAliases,
  hasErrors,
  settings,
  onUpdate,
  onFocusChange,
  onActiveLineChange,
  onLineCommit,
  onCommitAll,
}: {
  cell: NotebookCell;
  cells: NotebookCell[];
  knownAliases: string[];
  hasErrors: boolean;
  settings: WorkspaceSettings;
  onUpdate: (patch: Partial<NotebookCell>) => void;
  onFocusChange: (focused: boolean) => void;
  onActiveLineChange: (line: number) => void;
  onLineCommit: (line: number) => void;
  onCommitAll: () => void;
}) {
  const minEditorHeight = 224;
  const maxEditorHeight = 720;
  const externalSource = useMemo(
    () => combineCellSource(cell.controlHeader, cell.promptBody),
    [cell.controlHeader, cell.promptBody],
  );
  const [source, setSource] = useState(externalSource);
  const [editorHeight, setEditorHeight] = useState(minEditorHeight);
  const [scrollOffset, setScrollOffset] = useState({ left: 0, top: 0 });
  const [selectionStart, setSelectionStart] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [acceptedCompletion, setAcceptedCompletion] = useState<AcceptedCompletion | undefined>();
  const [dismissedSuggestion, setDismissedSuggestion] = useState<AcceptedCompletion | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const activeLineRef = useRef(1);

  useEffect(() => {
    if (!focused.current) {
      setSource(externalSource);
      setAcceptedCompletion(undefined);
      setDismissedSuggestion(undefined);
    }
  }, [externalSource]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minEditorHeight), maxEditorHeight);
    textarea.style.height = `${nextHeight}px`;
    setEditorHeight(nextHeight);
    setScrollOffset({
      left: textarea.scrollLeft,
      top: textarea.scrollTop,
    });
  }, [source]);

  const headerEndLine = useMemo(() => getLeadingHeaderEndLine(source), [source]);
  const routingSuggestions = useMemo(() => createRoutingSuggestions(settings), [settings]);
  const constraintSuggestions = useMemo(() => createConstraintSuggestions(), []);
  const directiveSuggestions = useMemo(() => createDirectiveSuggestions(), []);
  const fileFormatSuggestions = useMemo(
    () => [
      ...createFormatSuggestions(getSupportedFileFormats(), { directive: "@file", priority: 10 }),
      ...createFormatSuggestions(getSupportedImageFormats(), {
        directive: "@image",
        detailPrefix: "Switch to @image; ",
        keywords: ["image", "picture", "transparent", "raster"],
        priority: 20,
        requiresQuery: true,
      }),
    ],
    [],
  );
  const imageFormatSuggestions = useMemo(() => createFormatSuggestions(getSupportedImageFormats(), { directive: "@image" }), []);
  const referenceSuggestions = useMemo(() => createReferenceSuggestions(cells, cell.alias), [cell.alias, cells]);
  const forwardSuggestions = useMemo(() => createForwardSuggestions(knownAliases, cell.alias), [cell.alias, knownAliases]);
  const lineState = useMemo(() => getLineState(source, selectionStart), [selectionStart, source]);
  const suggestionContext = editorSuggestionContext(lineState.line, lineState.lineNumber <= headerEndLine);
  const visibleSuggestions = useMemo(
    () => {
      if (!isFocused || !suggestionContext) return [];
      if (isAcceptedCompletionSuppressed(acceptedCompletion, suggestionContext, lineState)) return [];
      if (isAcceptedCompletionSuppressed(dismissedSuggestion, suggestionContext, lineState)) return [];
      if (suggestionContext.kind === "routing") return routingEditorSuggestions(routingSuggestions, suggestionContext.query);
      if (suggestionContext.kind === "constraint") return constraintEditorSuggestions(constraintSuggestions, suggestionContext.query);
      if (suggestionContext.kind === "directive") return directiveEditorSuggestions(directiveSuggestions, suggestionContext.query);
      if (suggestionContext.kind === "forward") return forwardEditorSuggestions(forwardSuggestions, suggestionContext.query);
      if (suggestionContext.kind === "file-format") return formatEditorSuggestions(fileFormatSuggestions, suggestionContext.query);
      if (suggestionContext.kind === "image-format") return formatEditorSuggestions(imageFormatSuggestions, suggestionContext.query);
      return filterEditorSuggestions(referenceSuggestions, suggestionContext.query, { hideExactMatch: true });
    },
    [
      acceptedCompletion,
      constraintSuggestions,
      dismissedSuggestion,
      directiveSuggestions,
      fileFormatSuggestions,
      forwardSuggestions,
      imageFormatSuggestions,
      isFocused,
      lineState,
      referenceSuggestions,
      routingSuggestions,
      suggestionContext,
    ],
  );

  function updateSource(nextSource: string) {
    setAcceptedCompletion(undefined);
    setDismissedSuggestion(undefined);
    setSource(nextSource);
    onUpdate(splitUnifiedCellSource(nextSource));
  }

  function updateCaretState(textarea: HTMLTextAreaElement) {
    const nextLine = getLineState(textarea.value, textarea.selectionStart).lineNumber;
    setSelectionStart(textarea.selectionStart);

    if (nextLine !== activeLineRef.current) {
      onLineCommit(activeLineRef.current);
      activeLineRef.current = nextLine;
      onActiveLineChange(nextLine);
    }
  }

  function applyEditorSuggestion(suggestion: EditorSuggestion) {
    if (!suggestionContext) return;

    const caret = textareaRef.current?.selectionStart ?? selectionStart;
    const currentLine = getLineState(source, caret);
    const prefix = suggestion.directive
      ? editorSuggestionDirectivePrefix(currentLine.line, suggestion.directive)
      : editorSuggestionLinePrefix(currentLine.line, suggestionContext.kind);
    const suffix = normalizeSuggestionSuffix(suggestionContext.suffix ?? "", suggestion);
    const separator = suffix && !suggestion.insertText.endsWith(" ") ? " " : "";
    const nextLine = `${prefix}${suggestion.insertText}${separator}${suffix}`;
    const nextSource = `${source.slice(0, currentLine.start)}${nextLine}${source.slice(currentLine.end)}`;
    const nextSuggestionContext = editorSuggestionContext(nextLine, currentLine.lineNumber <= headerEndLine) ?? suggestionContext;
    const shouldSuppressCompletion = !(suggestionContext.kind === "directive" && nextSuggestionContext.kind !== suggestionContext.kind);

    updateSource(nextSource);
    if (shouldSuppressCompletion) {
      setAcceptedCompletion({ kind: nextSuggestionContext.kind, lineNumber: currentLine.lineNumber, line: nextLine });
    }
    const nextCaret = currentLine.start + nextLine.length;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      if (textareaRef.current) updateCaretState(textareaRef.current);
    });
  }

  function dismissEditorSuggestions() {
    if (!suggestionContext) return;

    setDismissedSuggestion({
      kind: suggestionContext.kind,
      lineNumber: lineState.lineNumber,
      line: lineState.line,
    });
  }

  return (
    <div className={`unified-editor ${hasErrors ? "has-inline-error" : ""}`}>
      <pre
        className="unified-editor-highlight"
        style={{
          height: editorHeight,
          transform: `translate(${-scrollOffset.left}px, ${-scrollOffset.top}px)`,
        }}
        aria-hidden="true"
      >
        {renderHighlightedSource(source, headerEndLine)}
      </pre>
      <textarea
        ref={textareaRef}
        spellCheck={false}
        className="unified-editor-input"
        style={{ height: editorHeight }}
        value={source}
        onChange={(event) => {
          updateSource(event.target.value);
          updateCaretState(event.currentTarget);
        }}
        onClick={(event) => {
          event.stopPropagation();
          updateCaretState(event.currentTarget);
        }}
        onKeyUp={(event) => updateCaretState(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && visibleSuggestions.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            dismissEditorSuggestions();
          }
        }}
        onSelect={(event) => updateCaretState(event.currentTarget)}
        onScroll={(event) => {
          setScrollOffset({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          });
        }}
        onFocus={(event) => {
          focused.current = true;
          setIsFocused(true);
          onFocusChange(true);
          updateCaretState(event.currentTarget);
        }}
        onBlur={() => {
          focused.current = false;
          setIsFocused(false);
          onFocusChange(false);
          onCommitAll();
          const normalized = splitUnifiedCellSource(source);
          setSource(combineCellSource(normalized.controlHeader, normalized.promptBody));
        }}
        aria-label={`${cell.alias} prompt and control header`}
        placeholder={"> openai\n< cost <= $3\n@text <300\n\nWrite prompt text, code, markdown, or %from c1 references here."}
      />
      {visibleSuggestions.length > 0 && (
        <div className="routing-suggestion-menu" role="listbox" aria-label="Routing suggestions">
          <button
            className="routing-suggestion-close"
            type="button"
            aria-label="Close suggestions"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              dismissEditorSuggestions();
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          >
            <X size={13} />
          </button>
          {visibleSuggestions.map((suggestion) => (
            <button
              className="routing-suggestion-option"
              type="button"
              role="option"
              key={`${suggestion.insertText}-${suggestion.detail}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                applyEditorSuggestion(suggestion);
              }}
            >
              <span>{suggestion.label}</span>
              <small>{suggestion.detail}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface EditorSuggestion {
  label: string;
  insertText: string;
  detail: string;
  directive?: "@file" | "@image";
  defaultExtension?: string;
  allowedExtensions?: string[];
  keywords?: string[];
  priority?: number;
  requiresQuery?: boolean;
}

type SuggestionKind = "routing" | "constraint" | "directive" | "reference" | "forward" | "file-format" | "image-format";

interface SuggestionContext {
  kind: SuggestionKind;
  query: string;
  suffix?: string;
}

interface LineState {
  line: string;
  lineNumber: number;
  start: number;
  end: number;
}

interface AcceptedCompletion {
  kind: SuggestionKind;
  lineNumber: number;
  line: string;
}

function getLineState(source: string, caret: number): LineState {
  const safeCaret = Math.max(0, Math.min(caret, source.length));
  const start = source.lastIndexOf("\n", safeCaret - 1) + 1;
  const nextBreak = source.indexOf("\n", safeCaret);
  const end = nextBreak === -1 ? source.length : nextBreak;
  const lineNumber = source.slice(0, start).split("\n").length;

  return {
    line: source.slice(start, end),
    lineNumber,
    start,
    end,
  };
}

function editorSuggestionContext(line: string, inHeader: boolean): SuggestionContext | undefined {
  const match = line.match(/^\s*>\s*([a-zA-Z0-9_.:/-]*)$/);
  if (match && inHeader) return { kind: "routing", query: match[1] };

  const constraintMatch = line.match(/^\s*<\s*([a-zA-Z0-9_$.\s<=>-]*)$/);
  if (constraintMatch && inHeader) return { kind: "constraint", query: constraintMatch[1] };

  const fileFormatMatch = formatDirectiveDraft(line, "@file");
  if (fileFormatMatch && inHeader) return { kind: "file-format", query: fileFormatMatch.query, suffix: fileFormatMatch.suffix };

  const imageFormatMatch = formatDirectiveDraft(line, "@image");
  if (imageFormatMatch && inHeader) return { kind: "image-format", query: imageFormatMatch.query, suffix: imageFormatMatch.suffix };

  const forwardMatch = line.match(/^\s*@forward\s*([cC]?[0-9]*)$/);
  if (forwardMatch && inHeader) return { kind: "forward", query: forwardMatch[1] };

  const directiveMatch = line.match(/^\s*@([a-zA-Z!]*)$/);
  if (directiveMatch && inHeader) return { kind: "directive", query: directiveMatch[1] };

  const referenceMatch = line.match(/^\s*(%(?:from\s+)?[a-zA-Z0-9_.-]*)$/);
  if (referenceMatch) return { kind: "reference", query: referenceMatch[1] };

  return undefined;
}

function editorSuggestionLinePrefix(line: string, kind: SuggestionKind): string {
  if (kind === "routing") {
    const match = line.match(/^(\s*>)\s*/);
    return match ? `${match[1]} ` : "> ";
  }

  if (kind === "file-format") {
    const match = line.match(/^(\s*@file)\s+/);
    return match ? `${match[1]} ` : "@file ";
  }

  if (kind === "image-format") {
    const match = line.match(/^(\s*@image)\s+/);
    return match ? `${match[1]} ` : "@image ";
  }

  if (kind === "constraint") {
    const match = line.match(/^(\s*<)\s*/);
    return match ? `${match[1]} ` : "< ";
  }

  return line.match(/^(\s*)/)?.[1] ?? "";
}

function editorSuggestionDirectivePrefix(line: string, directive: "@file" | "@image"): string {
  const indent = line.match(/^(\s*)/)?.[1] ?? "";
  return `${indent}${directive} `;
}

function normalizeSuggestionSuffix(suffix: string, suggestion: EditorSuggestion): string {
  if (!suffix || !suggestion.defaultExtension) return suffix;

  const trimmed = suffix.trimStart();
  const whitespaceIndex = trimmed.search(/\s/);
  const filename = whitespaceIndex === -1 ? trimmed : trimmed.slice(0, whitespaceIndex);
  const tail = whitespaceIndex === -1 ? "" : trimmed.slice(whitespaceIndex);
  if (!filename) return suffix;

  const extensionMatch = filename.match(/(\.[a-zA-Z0-9_+-]+)$/);
  if (!extensionMatch) return `${filename}${suggestion.defaultExtension}${tail}`;

  const extension = extensionMatch[1].toLowerCase();
  const allowed = suggestion.allowedExtensions?.map((value) => value.toLowerCase()) ?? [];
  if (allowed.includes(extension)) return trimmed;

  return `${filename.slice(0, -extensionMatch[1].length)}${suggestion.defaultExtension}${tail}`;
}

function formatDirectiveDraft(line: string, directive: "@file" | "@image"): { query: string; suffix: string } | undefined {
  const escapedDirective = directive.replace("@", "\\@");
  const match = line.match(new RegExp(`^\\s*${escapedDirective}\\s+(-[a-zA-Z0-9_]*)(?:\\s+(.*))?$`));
  if (!match) return undefined;

  return {
    query: match[1].slice(1),
    suffix: match[2]?.trimStart() ?? "",
  };
}

function isAcceptedCompletionSuppressed(
  acceptedCompletion: AcceptedCompletion | undefined,
  suggestionContext: SuggestionContext,
  lineState: LineState,
): boolean {
  return Boolean(
    acceptedCompletion &&
      acceptedCompletion.kind === suggestionContext.kind &&
      acceptedCompletion.lineNumber === lineState.lineNumber &&
      acceptedCompletion.line === lineState.line,
  );
}

export function createRoutingSuggestions(settings: WorkspaceSettings): EditorSuggestion[] {
  const aliases = preferredRoutingAliases(settings);
  const suggestions: EditorSuggestion[] = [];
  const seen = new Set<string>();

  function push(suggestion: EditorSuggestion) {
    const key = suggestion.insertText.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  }

  aliases.forEach((alias) => {
    push({ label: alias, insertText: alias, detail: "provider alias" });
    push({ label: `${alias}.max`, insertText: `${alias}.max`, detail: "strongest profile" });
  });

  settings.providers.filter((provider) => provider.enabled).forEach((provider) => {
    const providerAliases = preferredAliasesForProvider(provider.provider, provider.alias);
    const modelChoices = modelChoicesForProviderSettings(provider);

    providerAliases.forEach((alias) => {
      modelChoices.forEach((choice) => {
        push({
          label: `${alias}:${choice.value}`,
          insertText: `${alias}:${choice.value}`,
          detail: provider.provider === "openrouter" ? "OpenRouter model" : "explicit model",
        });
      });
    });
  });

  if (aliases.length >= 2) {
    push({
      label: `(${aliases[0]} + ${aliases[1]}).best`,
      insertText: `(${aliases[0]} + ${aliases[1]}).best`,
      detail: "best-of-group route",
    });
    push({
      label: `(${aliases[0]} + ${aliases[1]}).ensemble`,
      insertText: `(${aliases[0]} + ${aliases[1]}).ensemble`,
      detail: "ensemble route",
    });
  }

  push({ label: "auto", insertText: "auto", detail: "workspace route" });

  return suggestions;
}

export function createForwardSuggestions(knownAliases: string[], currentAlias: string): EditorSuggestion[] {
  return knownAliases
    .filter((alias) => alias !== currentAlias)
    .map((alias) => ({
      label: `@forward ${alias}`,
      insertText: `@forward ${alias}`,
      detail: "run target after success",
    }));
}

export function createConstraintSuggestions(): EditorSuggestion[] {
  return [
    { label: "cost <= $3.33", insertText: "cost <= $3.33", detail: "maximum run cost" },
    { label: "latency <= 3m", insertText: "latency <= 3m", detail: "maximum wall-clock latency" },
    { label: "tokens <= 50000", insertText: "tokens <= 50000", detail: "maximum token budget" },
    { label: "iterations <= 3", insertText: "iterations <= 3", detail: "maximum loop iterations" },
  ];
}

export function createDirectiveSuggestions(): EditorSuggestion[] {
  return [
    { label: "@file", insertText: "@file ", detail: "write a generated file" },
    { label: "@image", insertText: "@image ", detail: "write a generated image" },
    { label: "@text", insertText: "@text ", detail: "set text output length" },
    { label: "@forward", insertText: "@forward ", detail: "run another cell after success" },
    { label: "@if", insertText: "@if ", detail: "conditional branch" },
    { label: "@else", insertText: "@else ", detail: "alternate branch" },
    { label: "@chain", insertText: "@chain ", detail: "chain execution" },
  ];
}

function createFormatSuggestions(
  formats: Array<{ formatId: string; label: string; defaultExtension: string; allowedExtensions: string[] }>,
  options: {
    directive?: "@file" | "@image";
    detailPrefix?: string;
    keywords?: string[];
    priority?: number;
    requiresQuery?: boolean;
  } = {},
): EditorSuggestion[] {
  return formats.map((format) => ({
    label: `-${format.formatId}`,
    insertText: `-${format.formatId} `,
    detail: `${options.detailPrefix ?? ""}${format.label} ${format.allowedExtensions.join(" / ") || format.defaultExtension}`,
    directive: options.directive,
    defaultExtension: format.defaultExtension,
    allowedExtensions: format.allowedExtensions,
    keywords: options.keywords,
    priority: options.priority,
    requiresQuery: options.requiresQuery,
  }));
}

function createReferenceSuggestions(cells: NotebookCell[], currentAlias: string): EditorSuggestion[] {
  const suggestions: EditorSuggestion[] = [];
  const seen = new Set<string>();

  function push(insertText: string, detail: string) {
    const key = insertText.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ label: insertText, insertText, detail });
  }

  cells
    .filter((cell) => cell.kind !== "text" && cell.alias !== currentAlias)
    .forEach((sourceCell) => {
      push(`%from ${sourceCell.alias}`, "cell output");
      Object.keys(sourceCell.vars).forEach((field) => push(`%from ${sourceCell.alias}.${field}`, "output field"));
      push(`%error.${sourceCell.alias}`, "cell error");
      push(`%error.${sourceCell.alias}.message`, "error message");
    });

  return suggestions;
}

function formatEditorSuggestions(suggestions: EditorSuggestion[], query: string): EditorSuggestion[] {
  const normalized = query.trim().toLowerCase();
  const filtered = suggestions.filter((suggestion) => {
    if (!normalized && suggestion.requiresQuery) return false;
    if (!normalized) return true;
    return formatSuggestionMatches(suggestion, normalized);
  });

  if (!normalized) return filtered.slice(0, 8);

  return filtered
    .sort((a, b) => {
      const score = formatSuggestionScore(a, normalized) - formatSuggestionScore(b, normalized);
      if (score !== 0) return score;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })
    .slice(0, 8);
}

function formatSuggestionMatches(suggestion: EditorSuggestion, normalized: string): boolean {
  const formatId = suggestion.insertText.trim().slice(1).toLowerCase();
  const label = suggestion.label.toLowerCase();
  const detail = suggestion.detail.toLowerCase();
  const keywords = suggestion.keywords ?? [];
  return (
    formatId.startsWith(normalized) ||
    label.includes(normalized) ||
    detail.includes(normalized) ||
    keywords.some((keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return normalizedKeyword.startsWith(normalized) || normalizedKeyword.includes(normalized);
    })
  );
}

function formatSuggestionScore(suggestion: EditorSuggestion, normalized: string): number {
  const formatId = suggestion.insertText.trim().slice(1).toLowerCase();
  if (formatId === normalized) return 0;
  if (formatId.startsWith(normalized)) return 1;
  if ((suggestion.keywords ?? []).some((keyword) => keyword.toLowerCase().startsWith(normalized))) return 2;
  if (suggestion.label.toLowerCase().includes(normalized)) return 3;
  return 4;
}

function preferredRoutingAliases(settings: WorkspaceSettings): string[] {
  const aliases: string[] = [];

  settings.providers.forEach((provider) => {
    if (provider.provider !== "custom" && provider.provider !== "local") aliases.push(provider.provider);
    aliases.push(provider.alias);
  });

  const seen = new Set<string>();

  return aliases
    .map((alias) => alias.trim())
    .filter((alias) => alias && !/^provider[_-]/i.test(alias))
    .filter((alias) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function preferredAliasesForProvider(providerKind: string, alias: string): string[] {
  const aliases = [providerKind !== "custom" && providerKind !== "local" ? providerKind : "", alias]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !/^provider[_-]/i.test(value));
  const seen = new Set<string>();

  return aliases.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterEditorSuggestions(
  suggestions: EditorSuggestion[],
  query: string,
  options: { hideExactMatch?: boolean } = {},
): EditorSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (options.hideExactMatch && normalized && suggestions.some((suggestion) => suggestion.insertText.toLowerCase() === normalized)) {
    return [];
  }
  const filtered = normalized
    ? suggestions.filter((suggestion) => suggestion.insertText.toLowerCase().includes(normalized))
    : suggestions;

  return filtered.slice(0, 8);
}

export function routingEditorSuggestions(suggestions: EditorSuggestion[], query: string): EditorSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return suggestions.slice(0, 8);

  const exactMatch = suggestions.some((suggestion) => suggestion.insertText.toLowerCase() === normalized);
  if (exactMatch) return [];

  return filterEditorSuggestions(suggestions, query);
}

export function constraintEditorSuggestions(suggestions: EditorSuggestion[], query: string): EditorSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return suggestions;

  const exactMatch = suggestions.some((suggestion) => suggestion.insertText.toLowerCase() === normalized);
  if (exactMatch) return [];

  return suggestions
    .filter((suggestion) => {
      const value = suggestion.insertText.toLowerCase();
      const label = suggestion.label.toLowerCase();
      return value.startsWith(normalized) || label.includes(normalized);
    })
    .slice(0, 8);
}

export function directiveEditorSuggestions(suggestions: EditorSuggestion[], query: string): EditorSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return suggestions.slice(0, 8);

  const filtered = suggestions.filter((suggestion) => suggestion.insertText.slice(1).toLowerCase().startsWith(normalized));
  const exactMatch = filtered.some((suggestion) => suggestion.insertText.trim().slice(1).toLowerCase() === normalized);
  if (exactMatch) return [];

  return filtered.slice(0, 8);
}

export function forwardEditorSuggestions(suggestions: EditorSuggestion[], query: string): EditorSuggestion[] {
  const normalizedTarget = normalizeCellAliasQuery(query);
  if (!normalizedTarget) return suggestions.slice(0, 8);

  const exactInsertText = `@forward ${normalizedTarget}`;
  const exactMatch = suggestions.some((suggestion) => suggestion.insertText.toLowerCase() === exactInsertText);
  if (!exactMatch) return filterEditorSuggestions(suggestions, query);

  return [];
}

function normalizeCellAliasQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "";
  return /^\d+$/.test(normalized) ? `c${normalized}` : normalized;
}

function renderHighlightedSource(source: string, headerEndLine: number) {
  const noteState: HighlightNoteState = {};

  return source.replace(/\r\n/g, "\n").split("\n").map((line, index) => (
    <span className={`unified-line ${index < headerEndLine ? serviceLineClass(line) : "body"}`} key={`${index}-${line}`}>
      {index < headerEndLine ? renderLineContent(line) : renderBodyLineContent(line, noteState, index)}
    </span>
  ));
}

function renderLineContent(line: string, keyPrefix = "line") {
  const parts = line.split(/(%(?:from\s+[cC][0-9]+(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*|input|output\.[cC][0-9]+(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)?|var\.[cC][0-9]+\.[a-zA-Z_][a-zA-Z0-9_.-]*|file\.[cC][0-9]+(?::[^\s%,.?!;:]+(?:\.[^\s%,.?!;:]+)*)?|files\.[cC][0-9]+|prompt\.[cC][0-9]+|header\.[cC][0-9]+|meta\.[cC][0-9]+\.[a-zA-Z_][a-zA-Z0-9_]*|error\.[cC][0-9]+(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*))/g);

  return parts.map((part, index) =>
    part.startsWith("%") ? (
      <span className="icc-reference-token" key={`${keyPrefix}-${part}-${index}`}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface HighlightNoteState {
  inNote?: boolean;
  inFence?: boolean;
  fenceMarker?: "`" | "~";
}

function renderBodyLineContent(line: string, state: HighlightNoteState, lineIndex: number) {
  const fence = line.trimStart().match(/^(```+|~~~+)/);
  if (!state.inNote && fence) {
    const marker = fence[1][0] as "`" | "~";
    if (state.inFence && marker === state.fenceMarker) {
      state.inFence = false;
      state.fenceMarker = undefined;
    } else if (!state.inFence) {
      state.inFence = true;
      state.fenceMarker = marker;
    }
    return renderLineContent(line, `body-${lineIndex}`);
  }

  if (state.inFence) return renderLineContent(line, `body-${lineIndex}`);

  const nodes: ReactNode[] = [];
  let cursor = 0;

  function pushSource(text: string) {
    if (!text) return;
    nodes.push(renderLineContent(text, `body-${lineIndex}-${cursor}`));
  }

  function pushNote(text: string) {
    if (!text) return;
    nodes.push(
      <span className="icc-sender-note-token" key={`note-${lineIndex}-${cursor}`}>
        {text}
      </span>,
    );
  }

  while (cursor < line.length) {
    if (!state.inNote && line.startsWith("\\/*", cursor)) {
      pushSource("\\/*");
      cursor += 3;
      continue;
    }

    if (state.inNote && line.startsWith("*\\/", cursor)) {
      pushNote("*\\/");
      cursor += 3;
      continue;
    }

    if (!state.inNote && line.startsWith("/*", cursor)) {
      state.inNote = true;
      pushNote("/*");
      cursor += 2;
      continue;
    }

    if (state.inNote && line.startsWith("*/", cursor)) {
      pushNote("*/");
      state.inNote = false;
      cursor += 2;
      continue;
    }

    if (state.inNote) {
      const nextClose = nextSenderNoteBoundary(line, cursor);
      pushNote(line.slice(cursor, nextClose));
      cursor = nextClose;
      continue;
    }

    const nextOpen = line.indexOf("/*", cursor);
    const nextEscapedOpen = line.indexOf("\\/*", cursor);
    const nextBoundary = [nextOpen, nextEscapedOpen].filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? line.length;
    pushSource(line.slice(cursor, nextBoundary));
    cursor = nextBoundary;
  }

  return nodes;
}

function nextSenderNoteBoundary(line: string, cursor: number): number {
  const boundaries = [line.indexOf("*/", cursor), line.indexOf("*\\/", cursor)]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  return boundaries[0] ?? line.length;
}

function CompactBody({ cell, controlSummary, running }: { cell: NotebookCell; controlSummary: string; running: boolean }) {
  const shouldShowResult = hasRenderableResult(cell, running);

  return (
    <div className="compact-body">
      <p className="compact-control">{controlSummary}</p>
      {cell.decision?.result !== undefined && (
        <p className="compact-decision">
          Decision: {cell.decision.conditionRaw} = {String(cell.decision.result)}
          {cell.decision.routeTarget ? ` -> ${cell.decision.routeTarget}` : ""}
        </p>
      )}
      {cell.status === "skipped" && <p className="compact-result">Status: skipped</p>}
      {cell.staleReason && <p className="compact-result stale">Stale: {cell.staleReason}</p>}
      {shouldShowResult && (
        <p className="compact-result">Result: {running ? "Running..." : cell.output ? preview(cell.output, 140) : resultStatusText(cell)}</p>
      )}
    </div>
  );
}

function AttachmentTray({
  attachments,
  onAttachClick,
  onRemoveAttachment,
}: {
  attachments: CellAttachment[];
  onAttachClick: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  return (
    <div className={`attachment-tray ${attachments.length ? "has-files" : ""}`}>
      <button
        className="attach-file-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAttachClick();
        }}
      >
        <Plus size={14} />
        Attach file
      </button>
      {attachments.map((attachment) => (
        <span className="attachment-pill" key={attachment.id} title={`${attachment.mimeType} · ${formatBytes(attachment.sizeBytes)}`}>
          <FileText size={14} />
          <span className="attachment-name">{attachment.displayName}</span>
          <span className="attachment-meta">{fileKindLabel(attachment)} · {formatBytes(attachment.sizeBytes)}</span>
          <a
            href={attachmentDownloadHref(attachment)}
            download={attachment.displayName}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Download ${attachment.displayName}`}
          >
            <Download size={13} />
          </a>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveAttachment(attachment.id);
            }}
            aria-label={`Remove ${attachment.displayName}`}
          >
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}

function ResultBlock({
  cell,
  running,
}: {
  cell: NotebookCell;
  running: boolean;
}) {
  if (running) {
    return (
      <div className="cell-output running-output" aria-live="polite">
        <span className="run-loader" aria-hidden="true" />
        <div>
          <strong>Running provider</strong>
          <p>Waiting for model response. Output will appear here when the run finishes.</p>
        </div>
      </div>
    );
  }
  if (cell.status === "decision_error" && cell.decision?.error) {
    return <pre className="cell-output error-output">Decision error:\n{cell.decision.error}</pre>;
  }
  if (cell.output) return <pre className="cell-output">{cell.output}</pre>;
  if (cell.status === "skipped") return <p className="inline-result">Skipped by flow decision.</p>;
  if (cell.status === "cancelled") return <p className="inline-result">Run cancelled.</p>;
  if (cell.status === "timeout") return <p className="inline-result">Provider latency limit exceeded.</p>;
  if (
    cell.status === "failed" ||
    cell.status === "partial_failed" ||
    cell.status === "artifact_error" ||
    cell.status === "decision_error" ||
    cell.status === "reference_error" ||
    cell.status === "config_error"
  ) {
    return <p className="inline-result error">{resultStatusText(cell)}</p>;
  }
  return null;
}

function hasRenderableResult(cell: NotebookCell, running: boolean): boolean {
  if (running) return true;
  if (cell.output.trim()) return true;
  return ["failed", "partial_failed", "skipped", "cancelled", "timeout", "decision_error", "reference_error", "config_error", "artifact_error"].includes(
    cell.status,
  );
}

function resultStatusText(cell: NotebookCell): string {
  if (cell.status === "skipped") return "Skipped by flow decision.";
  if (cell.status === "cancelled") return "Run cancelled.";
  if (cell.status === "timeout") return "Provider latency limit exceeded.";
  if (cell.status === "reference_error") return "Reference could not be resolved.";
  if (cell.status === "decision_error") return cell.decision?.error ?? "Decision could not be evaluated.";
  if (cell.status === "config_error") return "Configuration is incomplete for this run.";
  if (cell.status === "partial_failed") return "Some artifacts were created and some failed validation.";
  if (cell.status === "artifact_error") return "Artifact generation failed.";
  if (cell.status === "failed") return "Run failed.";
  return "";
}

function ArtifactRow({
  artifact,
  onOpenArtifact,
}: {
  artifact: Artifact;
  onOpenArtifact: (artifactId: string) => void;
}) {
  return (
    <div className="artifact-row">
      <span>
        <FileText size={15} />
        {artifactIcon(artifact.extension)} {artifact.displayName}
        {artifact.version > 1 ? ` v${artifact.version}` : ""}
      </span>
      <button type="button" onClick={() => onOpenArtifact(artifact.id)}>
        Open
      </button>
      <a download={artifact.displayName} href={downloadHref(artifact)}>
        Download
      </a>
    </div>
  );
}

function summarizeControl(parsed: ReturnType<typeof parseCellDsl>): string {
  if (parsed.flow.type === "if") {
    return `@if ${parsed.flow.condition} -> ${parsed.flow.target}${parsed.flow.elseTarget ? `, else -> ${parsed.flow.elseTarget}` : ""}`;
  }
  if (parsed.flow.type === "forward") return `@forward ${parsed.flow.target}`;
  if (parsed.flow.type === "chain") return `@chain ${parsed.flow.nodes.join(" > ")}`;
  return parsed.routing?.raw ? `> ${parsed.routing.raw}` : "> workspace default";
}

function chipClass(chip: string): string {
  if (chip.includes("error")) return "danger";
  if (chip.startsWith("<$") || chip.includes("tok") || chip.match(/^<[0-9]/)) return "budget";
  if (chip.startsWith("->") || chip.includes("chain")) return "flow";
  if (chip.includes("loop")) return "loop";
  if (chip === "if") return "if";
  if (chip.includes("best") || chip.includes("ensemble") || chip.includes("multi")) return "multi";
  if (chip.startsWith("file") || chip.startsWith("json") || chip.startsWith("{}")) return "artifact";
  if (chip.startsWith("from ")) return "artifact";
  return "neutral";
}

function preview(value: string, length: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length)}...` : singleLine;
}

function findLegacyInputSources(
  cells: NotebookCell[],
  targetAlias: string,
  knownAliases: string[],
  settings: WorkspaceSettings,
): string[] {
  return cells
    .filter((candidate) => candidate.kind !== "text" && candidate.alias !== targetAlias)
    .filter((candidate) => {
      const parsed = parseCellDsl(candidate.controlHeader, candidate.promptBody, {
        knownAliases,
        providerAliases: providerAliasOptions(settings),
        defaultLoopIterations: settings.orchestration.defaultLoopIterations,
        maxLoopIterations: settings.orchestration.maxLoopIterations,
        cells: cells.filter((cell) => cell.kind !== "text"),
      });

      return parsed.flow.type === "forward" && (parsed.flow.targets ?? [parsed.flow.target]).includes(targetAlias);
    })
    .map((candidate) => candidate.alias);
}

function buildForwardReferenceWarnings(
  cell: NotebookCell,
  cells: NotebookCell[],
  knownAliases: string[],
  settings: WorkspaceSettings,
  parsed: ParsedDsl,
): Diagnostic[] {
  if (parsed.flow.type !== "forward") return [];

  return (parsed.flow.targets ?? [parsed.flow.target]).flatMap((targetAlias) => {
    const target = cells.find((candidate) => candidate.kind !== "text" && candidate.alias === targetAlias);
    if (!target) return [];

    const targetParsed = parseCellDsl(target.controlHeader, target.promptBody, {
      knownAliases,
      providerAliases: providerAliasOptions(settings),
      defaultLoopIterations: settings.orchestration.defaultLoopIterations,
      maxLoopIterations: settings.orchestration.maxLoopIterations,
      cells: cells.filter((candidate) => candidate.kind !== "text"),
    });
    const targetReadsSource = targetParsed.references.some(
      (reference) => reference.kind === "from" && reference.alias === cell.alias,
    );

    return targetReadsSource
      ? []
      : [
          {
            level: "warning" as const,
            message: `@forward ${targetAlias} is active, but ${targetAlias} does not explicitly reference %from ${cell.alias}.`,
          },
        ];
  });
}

function downloadHref(artifact: Artifact): string {
  if (artifact.metadata.channel === "image" && artifact.mimeType.startsWith("image/")) {
    return `data:${artifact.mimeType};base64,${artifact.content}`;
  }
  return URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }));
}

function attachmentDownloadHref(attachment: CellAttachment): string {
  return URL.createObjectURL(attachmentToBlob(attachment));
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

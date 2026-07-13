import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  PanOnScrollMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  Bot,
  Braces,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  CopyPlus,
  Download,
  Eye,
  FileText,
  FilePenLine,
  FolderOpen,
  GitBranch,
  Link2,
  Layers3,
  ListOrdered,
  MoreHorizontal,
  Maximize2,
  Network,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Split,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./visual.css";
import { SettingsDrawer } from "../components/SettingsDrawer";
import { createInitialWorkspace } from "../domain/fixtures";
import { modelChoicesForProviderSettings } from "../domain/modelCatalog";
import { createProviderSettings, normalizeOrchestrationSettings, normalizeProviderSettings } from "../domain/providerAliases";
import { deleteProviderSecret, readProviderSecret } from "../domain/providerSecrets";
import type { OrchestrationSettings, ProviderKind, ProviderSettings, WorkspaceSettings } from "../domain/types";
import { connectStep, createStep, emptyFlow, nextAlias, parseIcc, serializeIcc, serializeStep, validateWorkflow } from "./icc";
import { findOpenNodePosition } from "./layout";
import { buildModelRoute, choiceDetail, choiceTitle, parseModelRoute, type RouteMember, type RouteStrategy } from "./modelRoutes";
import { executeVisualWorkflow, generateWorkflowWithAI, type VisualRunState, type WorkflowRunLimits } from "./runner";
import type { ConditionOperator, FlowKind, StepColor, ValidationIssue, WorkflowDocument, WorkflowFile, WorkflowStep } from "./types";

type StepNodeData = {
  step: WorkflowStep;
  issues: ValidationIssue[];
  isStart: boolean;
  isNew: boolean;
  isOutsidePath: boolean;
  order?: number;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onSetStart: (id: string) => void;
};
type StepNode = Node<StepNodeData, "step">;
type EdgeOcclusionRect = { x: number; y: number; width: number; height: number };
type MaskedDashedEdgeData = { occlusionRects: EdgeOcclusionRect[] };
type MaskedDashedEdgeType = Edge<MaskedDashedEdgeData, "masked-dashed">;

interface WorkflowProject {
  id: string;
  goal: string;
  document: WorkflowDocument;
  runLimits: WorkflowRunLimits;
}

interface WorkflowWorkspace {
  activeProjectId: string;
  projects: WorkflowProject[];
}

const STORAGE_KEY = "icc-go.visual.workspace.v1";
const LEGACY_STORAGE_KEYS = ["icc-flow.workspace.v5"];
const SETTINGS_STORAGE_KEY = "icc-go.visual.icc-settings.v1";
const LEGACY_SETTINGS_STORAGE_KEYS = ["icc-flow.icc-settings.v1"];
const nodeTypes = { step: StepCard };
const edgeTypes = { "masked-dashed": MaskedDashedEdge };
const stepColors: Array<{ id: StepColor; label: string; value: string }> = [
  { id: "ink", label: "Ink", value: "#201e1d" },
  { id: "red", label: "Signal red", value: "#ec3013" },
  { id: "green", label: "Forest green", value: "#087333" },
  { id: "blue", label: "Slate blue", value: "#315a7d" },
  { id: "ochre", label: "Warm ochre", value: "#a65f18" },
  { id: "purple", label: "Muted purple", value: "#6d4c7d" },
  { id: "gray", label: "Concrete gray", value: "#777872" },
];

const routeSuggestions = [
  "openai", "openai.max", "openai.fast", "openai.cheap", "openai.code", "openai.reasoning",
  "claude", "claude.max", "claude.code", "gemini.flash", "deepseek.reasoning",
  "openrouter:openrouter/auto", "auto", "fast", "cheap", "best",
  "(openai + claude).best", "(openai + claude).ensemble",
];

export function VisualEditor() {
  return (
    <div className="visual-editor-surface">
      <ReactFlowProvider>
        <Editor />
      </ReactFlowProvider>
    </div>
  );
}

function Editor() {
  const { setViewport } = useReactFlow<StepNode, Edge>();
  const [workspace, setWorkspace] = useState<WorkflowWorkspace>(loadWorkspace);
  const [iccSettings, setIccSettings] = useState<WorkspaceSettings>(loadIccSettings);
  const activeProject = workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? workspace.projects[0];
  const document = activeProject.document;
  const [selectedId, setSelectedId] = useState<string>(() => document.steps[0]?.id ?? "");
  const [dslOpen, setDslOpen] = useState(false);
  const [dslDraft, setDslDraft] = useState("");
  const [cellEditorId, setCellEditorId] = useState<string>();
  const [justAddedId, setJustAddedId] = useState<string>();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [routeOverflowing, setRouteOverflowing] = useState(false);
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runState, setRunState] = useState<VisualRunState>(() => emptyRunState());
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string>();
  const [showDataLinks, setShowDataLinks] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ file: WorkflowFile; source: "attachment" | "artifact" }>();
  const [toast, setToast] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const runAbortRef = useRef<AbortController | undefined>(undefined);
  const aiAbortRef = useRef<AbortController | undefined>(undefined);
  const issues = useMemo(() => validateWorkflow(document), [document]);
  const selected = document.steps.find((step) => step.id === selectedId) ?? document.steps[0];
  const execution = useMemo(() => buildExecutionModel(document), [document]);

  useEffect(() => {
    clearVisualExampleQuery();
  }, []);

  function setDocument(updater: WorkflowDocument | ((current: WorkflowDocument) => WorkflowDocument)) {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === current.activeProjectId
        ? { ...project, document: typeof updater === "function" ? updater(project.document) : updater }
        : project),
    }));
  }

  async function startRun() {
    if (issues.some((issue) => issue.level === "error")) {
      setToast("Fix workflow errors before running");
      return;
    }
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;
    setRunOpen(true);
    setRunState(emptyRunState(document));
    const finalState = await executeVisualWorkflow(document, activeProject.runLimits, controller.signal, setRunState, iccSettings);
    setDocument((current) => ({
      ...current,
      steps: current.steps.map((step) => {
        const generated = finalState.steps[step.alias]?.artifacts ?? [];
        if (!generated.length) return step;
        return {
          ...step,
          artifacts: generated.map((artifact) => ({
            id: artifact.id,
            name: artifact.name,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
            encoding: isTextArtifact(artifact.mimeType, artifact.name) ? "text" as const : "base64" as const,
            content: artifact.content,
            createdAt: new Date().toISOString(),
          })),
        };
      }),
    }));
    if (runAbortRef.current === controller) runAbortRef.current = undefined;
  }

  function stopRun() {
    runAbortRef.current?.abort();
  }

  function applyRunLimits(runLimits: WorkflowRunLimits) {
    setWorkspace((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== current.activeProjectId) return project;
        const perCellCap = runLimits.maxBudgetUsd / Math.max(1, runLimits.maxLoopPasses * project.document.steps.length);
        const steps = project.document.steps.map((step, index, all) => ({
          ...step,
          costUsd: perCellCap.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
          iterations: isLoopController(step, index, all) ? String(runLimits.maxLoopPasses) : step.iterations,
        }));
        return { ...project, runLimits, document: { ...project.document, steps } };
      }),
    }));
    setLimitsOpen(false);
    setToast("Run limits saved to the workflow");
  }

  function updateProvider(providerId: string, patch: Partial<ProviderSettings>) {
    setIccSettings((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === providerId ? normalizeProviderSettings({ ...provider, ...patch }) : provider),
    }));
  }

  function addProvider(provider: ProviderKind) {
    setIccSettings((current) => {
      const count = current.providers.filter((candidate) => candidate.provider === provider).length;
      return { ...current, providers: [...current.providers, createProviderSettings(provider, count + 1)] };
    });
  }

  function removeProvider(providerId: string) {
    deleteProviderSecret(providerId);
    setIccSettings((current) => {
      const providers = current.providers.filter((provider) => provider.id !== providerId);
      return { ...current, providers: providers.length ? providers : [createProviderSettings("openai")] };
    });
  }

  function moveProvider(providerId: string, direction: "up" | "down") {
    setIccSettings((current) => {
      const providers = [...current.providers];
      const index = providers.findIndex((provider) => provider.id === providerId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= providers.length) return current;
      [providers[index], providers[target]] = [providers[target], providers[index]];
      return { ...current, providers };
    });
  }

  function updateOrchestration(patch: Partial<OrchestrationSettings>) {
    setIccSettings((current) => ({
      ...current,
      orchestration: normalizeOrchestrationSettings({ ...current.orchestration, ...patch }),
    }));
  }

  function resetLocalWorkspace() {
    const project = createProjectRecord(createDemoDocument(), "Choose an apartment only after validating its price, resale value, mortgage, and renovation budget.");
    setWorkspace({ activeProjectId: project.id, projects: [project] });
    setIccSettings(cloneIccSettings(createInitialWorkspace().settings));
    setSelectedId(project.document.steps[0]?.id ?? "");
    setSettingsOpen(false);
    setToast("Local workspace reset");
  }

  async function buildWorkflowWithAI() {
    const request = aiPrompt.trim();
    if (!request || aiGenerating) return;
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiGenerating(true);
    setAiError(undefined);
    try {
      const source = await generateWorkflowWithAI(request, controller.signal, iccSettings);
      const generated = parseIcc(source);
      if (generated.steps.length < 2) throw new Error("The generated workflow needs at least two valid steps.");
      generated.title = titleFromRequest(request);
      generated.steps = generated.steps.map((step, index) => ({ ...step, color: stepColors[index % stepColors.length].id }));
      const project = createProjectRecord(generated, request);
      setWorkspace((current) => ({ ...current, activeProjectId: project.id, projects: [...current.projects, project] }));
      setSelectedId(project.document.steps[0]?.id ?? "");
      setAiPrompt("");
      setAiBuilderOpen(false);
      setToast(`AI created ${project.document.steps.length} connected steps`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow generation failed.";
      setAiError(message);
      if (/Link .*provider key|API key|OpenRouter/i.test(message)) setSettingsOpen(true);
    } finally {
      if (aiAbortRef.current === controller) aiAbortRef.current = undefined;
      setAiGenerating(false);
    }
  }

  async function attachFiles(stepId: string, files: File[]) {
    const step = document.steps.find((candidate) => candidate.id === stepId);
    if (!step || !files.length) return;
    const accepted = files.filter((file) => file.size <= 5 * 1024 * 1024);
    if (accepted.length !== files.length) setToast("Files larger than 5 MB were skipped");
    const remaining = 15 * 1024 * 1024 - step.attachments.reduce((sum, file) => sum + file.sizeBytes, 0);
    let used = 0;
    const withinLimit = accepted.filter((file) => { if (used + file.size > remaining) return false; used += file.size; return true; });
    const created = await Promise.all(withinLimit.map(readWorkflowFile));
    updateStep(stepId, (current) => ({ ...current, attachments: [...current.attachments, ...created] }));
    if (withinLimit.length !== accepted.length) setToast("This block can store up to 15 MB of attachments");
    else setToast(`${created.length} file${created.length === 1 ? "" : "s"} attached to ${step.alias}`);
  }

  function removeStepFile(stepId: string, fileId: string, source: "attachment" | "artifact") {
    updateStep(stepId, (step) => source === "attachment"
      ? { ...step, attachments: step.attachments.filter((file) => file.id !== fileId) }
      : { ...step, artifacts: step.artifacts.filter((file) => file.id !== fileId) });
  }

  const nodes = useMemo<StepNode[]>(() => document.steps.map((step) => ({
    id: step.id,
    type: "step",
    position: document.positions[step.id] ?? { x: 80, y: 80 },
    width: 280,
    height: 188,
    handles: [
      { type: "target", position: Position.Left, x: -4, y: 89, width: 10, height: 10 },
      { type: "source", position: Position.Right, x: 270, y: 85, width: 18, height: 18 },
    ],
    selected: step.id === selected?.id,
    data: {
      step,
      issues: issues.filter((issue) => issue.stepId === step.id),
      isStart: execution.entryStepId === step.id,
      isNew: justAddedId === step.id,
      isOutsidePath: !execution.orders.has(step.alias),
      order: execution.orders.get(step.alias),
      onEdit: openCellEditor,
      onDuplicate: duplicateStep,
      onCopy: copyStepDsl,
      onDelete: deleteStep,
      onSetStart: setStartStep,
    },
  })), [document.positions, document.steps, execution, issues, justAddedId, selected?.id]);
  const edges = useMemo(() => buildEdges(document.steps, document.positions, showDataLinks), [document.positions, document.steps, showDataLinks]);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)), 250);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(iccSettings)), 250);
    return () => window.clearTimeout(timer);
  }, [iccSettings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!shareMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target && !shareMenuRef.current?.contains(event.target as HTMLElement)) setShareMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShareMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [shareMenuOpen]);

  useEffect(() => {
    const route = routeRef.current;
    if (!route) return;
    const update = () => {
      const overflowing = route.scrollWidth > route.clientWidth + 1;
      setRouteOverflowing(overflowing);
      if (!overflowing) setRouteExpanded(false);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(route);
    return () => observer.disconnect();
  }, [execution.summary, leftCollapsed, rightCollapsed]);

  useEffect(() => {
    if (!routeExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRouteExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [routeExpanded]);

  useEffect(() => {
    if (!justAddedId) return;
    const timer = window.setTimeout(() => setJustAddedId(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [justAddedId]);

  function updateStep(id: string, updater: Partial<WorkflowStep> | ((step: WorkflowStep) => WorkflowStep)) {
    setDocument((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === id ? (typeof updater === "function" ? updater(step) : { ...step, ...updater }) : step),
    }));
  }

  function addStep(template: "ai" | "compare" | "decision" | "loop") {
    const alias = nextAlias(document.steps);
    const step = createStep(alias, template);
    const selectedPosition = selected ? document.positions[selected.id] : undefined;
    if (template === "loop" && selected) {
      step.flow.chain = [selected.alias, alias, selected.alias];
      step.prompt = `Review %from ${selected.alias} and improve it for the next bounded iteration.`;
    }
    const autoConnect = Boolean(selected && selected.flow.kind === "none" && template !== "loop");
    setDocument((current) => ({
      ...current,
      steps: [
        ...current.steps.map((candidate) => autoConnect && candidate.id === selected?.id
          ? { ...candidate, flow: { ...candidate.flow, kind: "forward" as const, targets: [alias] } }
          : candidate),
        step,
      ],
      positions: {
        ...current.positions,
        [step.id]: findOpenNodePosition(selectedPosition
          ? { x: selectedPosition.x + 380, y: selectedPosition.y + (template === "decision" ? 80 : 0) }
          : { x: 80 + current.steps.length * 360, y: 100 }, Object.values(current.positions)),
      },
      entryStepId: current.entryStepId ?? step.id,
    }));
    setSelectedId(step.id);
    setJustAddedId(step.id);
    setToast(autoConnect ? `Step ${alias} created and connected` : `Step ${alias} created — drag the red plus to the next step`);
  }

  function duplicateStep(id: string) {
    const source = document.steps.find((step) => step.id === id);
    if (!source) return;
    const alias = nextAlias(document.steps);
    const copy: WorkflowStep = {
      ...source,
      id: crypto.randomUUID(),
      alias,
      title: `${source.title} — copy`,
      flow: emptyFlow(),
    };
    const position = document.positions[id] ?? { x: 80, y: 80 };
    setDocument((current) => ({
      ...current,
      steps: [...current.steps, copy],
      positions: { ...current.positions, [copy.id]: findOpenNodePosition({ x: position.x, y: position.y + 240 }, Object.values(current.positions)) },
    }));
    setSelectedId(copy.id);
    setJustAddedId(copy.id);
    setToast(`Copy ${alias} created`);
  }

  async function copyStepDsl(id: string) {
    const step = document.steps.find((candidate) => candidate.id === id);
    if (!step) return;
    await navigator.clipboard.writeText(serializeStep(step));
    setToast(`Cell ${step.alias} copied`);
  }

  function openCellEditor(id: string) {
    setSelectedId(id);
    setCellEditorId(id);
  }

  function applyCellEdit(id: string, title: string, header: string, prompt: string) {
    const current = document.steps.find((step) => step.id === id);
    if (!current) return;
    const parsed = parseIcc(`# ${current.alias}\n${header.trim()}\n\n${prompt.trim()}`);
    const replacement = parsed.steps[0];
    if (!replacement) return;
    updateStep(id, { ...replacement, id, alias: current.alias, title, color: current.color, attachments: current.attachments, artifacts: current.artifacts });
    setCellEditorId(undefined);
    setToast(`Cell ${current.alias} updated`);
  }

  function deleteStep(id: string) {
    const target = document.steps.find((step) => step.id === id);
    if (!target) return;
    setDocument((current) => {
      const steps = current.steps.filter((step) => step.id !== id).map((step) => removeTarget(step, target.alias));
      return {
        ...current,
        steps,
        entryStepId: current.entryStepId === id ? steps[0]?.id : current.entryStepId,
        positions: Object.fromEntries(Object.entries(current.positions).filter(([key]) => key !== id)),
      };
    });
    setSelectedId(document.steps.find((step) => step.id !== id)?.id ?? "");
  }

  function setStartStep(id: string) {
    const step = document.steps.find((candidate) => candidate.id === id);
    if (!step) return;
    setDocument((current) => ({ ...current, entryStepId: id }));
    setSelectedId(id);
    setToast(`${step.alias} is now the first step`);
  }

  function handleNodesChange(changes: NodeChange<StepNode>[]) {
    setDocument((current) => {
      const positions = { ...current.positions };
      changes.forEach((change) => {
        if (change.type === "position" && change.position) positions[change.id] = change.position;
      });
      return { ...current, positions };
    });
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const target = document.steps.find((step) => step.id === connection.target);
    if (!target) return;
    updateStep(connection.source, (step) => connectStep(step, target.alias));
  }

  function fitCanvas(duration = 220) {
    const canvas = canvasRef.current;
    const positions = document.steps.map((step) => document.positions[step.id]).filter((position): position is { x: number; y: number } => Boolean(position));
    if (!canvas || !positions.length) return;
    const minX = Math.min(...positions.map((position) => position.x));
    const minY = Math.min(...positions.map((position) => position.y));
    const maxX = Math.max(...positions.map((position) => position.x + 280));
    const maxY = Math.max(...positions.map((position) => position.y + 188));
    const padding = 48;
    const availableWidth = Math.max(1, canvas.clientWidth - padding * 2);
    const availableHeight = Math.max(1, canvas.clientHeight - padding * 2);
    const zoom = Math.max(0.1, Math.min(1, availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)));
    const x = (canvas.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom;
    const y = (canvas.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom;
    void setViewport({ x, y, zoom }, { duration });
  }

  function selectProject(projectId: string) {
    const project = workspace.projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    setWorkspace((current) => ({ ...current, activeProjectId: projectId }));
    setSelectedId(project.document.steps[0]?.id ?? "");
    setCellEditorId(undefined);
    setDslOpen(false);
  }

  function createProject() {
    const project = createProjectRecord(createStarterDocument(), "Define the goal, then refine the three steps of the loop.");
    setWorkspace((current) => ({ ...current, activeProjectId: project.id, projects: [...current.projects, project] }));
    setSelectedId(project.document.steps[0]?.id ?? "");
    setToast("New project created from a simple loop");
  }

  function deleteProject(projectId: string) {
    if (workspace.projects.length === 1) {
      setToast("At least one project must remain");
      return;
    }
    const target = workspace.projects.find((project) => project.id === projectId);
    if (!target || !window.confirm(`Delete project “${target.document.title}”?`)) return;
    const projects = workspace.projects.filter((project) => project.id !== projectId);
    const nextActive = workspace.activeProjectId === projectId ? projects[0] : activeProject;
    setWorkspace({ activeProjectId: nextActive.id, projects });
    setSelectedId(nextActive.document.steps[0]?.id ?? "");
    setToast("Project deleted");
  }

  async function importFile(file: File) {
    const parsed = parseIcc(await file.text());
    parsed.title = file.name.replace(/\.icc$/i, "") || parsed.title;
    const project = createProjectRecord(parsed, "Imported ICC workflow");
    setWorkspace((current) => ({ ...current, activeProjectId: project.id, projects: [...current.projects, project] }));
    setSelectedId(parsed.steps[0]?.id ?? "");
    setToast(`ICC project created: ${parsed.steps.length} steps`);
  }

  function exportFile() {
    const blob = new Blob([serializeIcc(document)], { type: "text/plain;charset=utf-8" });
    const link = window.document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName(document.title)}.icc`;
    link.click();
    URL.revokeObjectURL(link.href);
    setToast("ICC file exported");
  }

  async function copyDsl() {
    await navigator.clipboard.writeText(serializeIcc(document));
    setToast("ICC DSL copied");
  }

  function openDsl() {
    setDslDraft(serializeIcc(document));
    setDslOpen(true);
  }

  function applyDsl() {
    const parsed = parseIcc(dslDraft);
    parsed.title = document.title;
    setDocument(parsed);
    setSelectedId(parsed.steps[0]?.id ?? "");
    setDslOpen(false);
    setToast("Workflow updated from DSL");
  }

  function resetDemo() {
    const next = createDemoDocument();
    setDocument(next);
    setSelectedId(next.steps[0].id);
    setToast("Example loop restored");
  }

  return (
    <div className="visual-app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Network size={19} /></div>
          <div><strong>ICC-GO</strong><span>Visual editor for AI loops</span></div>
        </div>
        <div className="document-title">
          <input value={document.title} onChange={(event) => setDocument((current) => ({ ...current, title: event.target.value }))} aria-label="Workflow name" />
          <span><Save size={12} /> Saved</span>
        </div>
        <div className="header-actions">
          <input ref={fileInputRef} hidden type="file" accept=".icc,text/plain" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} />
          <button className="run-limits-button" type="button" onClick={() => setLimitsOpen(true)} title="Run limits"><SlidersHorizontal size={15} /> ${activeProject.runLimits.maxBudgetUsd} · {formatCount(activeProject.runLimits.maxLoopPasses, "pass", "passes")}</button>
          {runState.status === "running"
            ? <button className="stop-button" type="button" onClick={stopRun}><Square size={14} /> Stop</button>
            : <button className="run-button" type="button" onClick={() => void startRun()}><Play size={15} fill="currentColor" /> Run</button>}
          <button type="button" onClick={() => fileInputRef.current?.click()}><Download size={15} /> Import</button>
          <div className="share-menu-wrap" ref={shareMenuRef}>
            <button className="primary share-trigger" type="button" onClick={() => setShareMenuOpen((current) => !current)} aria-haspopup="menu" aria-expanded={shareMenuOpen}><Upload size={15} /> Share <ChevronDown size={13} /></button>
            {shareMenuOpen && <div className="share-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { exportFile(); setShareMenuOpen(false); }}><Upload size={15} /><span><strong>Export as .icc</strong><small>Download the workflow file</small></span></button>
              <button type="button" role="menuitem" onClick={() => { void copyDsl(); setShareMenuOpen(false); }}><Clipboard size={15} /><span><strong>Copy ICC syntax</strong><small>Copy the workflow source</small></span></button>
            </div>}
          </div>
          <button className="settings-trigger" type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings"><Settings size={17} /></button>
        </div>
      </header>

      <div className={`workspace ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
        <aside className={`library-panel ${leftCollapsed ? "is-collapsed" : ""}`}>
          {leftCollapsed ? <button className="panel-rail-toggle" type="button" onClick={() => setLeftCollapsed(false)} aria-label="Open projects panel" title="Open projects panel"><PanelLeftOpen size={16} /></button> : <>
          <section className="projects-menu">
            <div className="projects-heading"><span>Projects</span><div className="projects-heading-actions"><button type="button" onClick={() => setLeftCollapsed(true)} aria-label="Collapse projects panel" title="Collapse projects panel"><PanelLeftClose size={14} /></button><button type="button" onClick={createProject} aria-label="New project" title="New project"><Plus size={14} /></button></div></div>
            <div className="project-list">
              {workspace.projects.map((project) => <div className={`project-row ${project.id === workspace.activeProjectId ? "active" : ""}`} key={project.id}>
                <button className="project-main" type="button" onClick={() => selectProject(project.id)}><FolderOpen size={16} /><span>{project.document.title}</span></button>
                <button className="project-delete" type="button" onClick={() => deleteProject(project.id)} aria-label={`Delete project ${project.document.title}`}><Trash2 size={13} /></button>
              </div>)}
            </div>
          </section>
          <section className="flow-add-section">
            <div className="flow-section-label">Workflow steps</div>
            <button className={`add-step-trigger ${addMenuOpen ? "active" : ""}`} type="button" onClick={() => setAddMenuOpen((current) => !current)} aria-label="Add step" title="Add step" aria-expanded={addMenuOpen}><Plus size={15} /><span><strong>Add step</strong><small>AI task, decision, or loop</small></span></button>
            {addMenuOpen && <div className="add-step-popover">
              <p>Select the previous block first to connect the new step automatically.</p>
              <LibraryButton icon={<Bot />} title="AI task" description="One model completes a task" onClick={() => { addStep("ai"); setAddMenuOpen(false); }} />
              <LibraryButton icon={<Layers3 />} title="Compare answers" description="Several models, best answer" onClick={() => { addStep("compare"); setAddMenuOpen(false); }} />
              <LibraryButton icon={<Split />} title="Choose a path" description="Continue with a yes / no rule" onClick={() => { addStep("decision"); setAddMenuOpen(false); }} />
              <LibraryButton icon={<RotateCcw />} title="Repeat and improve" description="A safe loop with a limit" onClick={() => { addStep("loop"); setAddMenuOpen(false); }} />
            </div>}
          </section>
          <div className="validation-card">
            <div><Check size={14} /><strong>ICC DSL v1.04</strong></div>
            <p>{issues.length ? `${formatCount(issues.filter((issue) => issue.level === "error").length, "error")} · ${formatCount(issues.filter((issue) => issue.level === "warning").length, "hint")}` : "Everything is ready. This workflow can be exported."}</p>
            <button type="button" onClick={openDsl}><Code2 size={14} /> Show ICC</button>
          </div>
          <button className="reset-demo" type="button" onClick={resetDemo}>Restore example project</button>
          </>}
        </aside>

        <main className="flow-stage">
          <div className="stage-toolbar">
            <div><strong title={activeProject.goal}>{document.title}</strong><span>{formatCount(document.steps.length, "step")} · {formatCount(execution.controlLinkCount, "link")}</span></div>
            <div className="stage-tools"><span className="stage-hint"><Zap size={13} /> Two fingers to move · pinch to zoom</span><button className={showDataLinks ? "active" : ""} type="button" onClick={() => setShowDataLinks((current) => !current)} aria-pressed={showDataLinks} title="Show where blocks reuse results from earlier steps"><Link2 size={12} /> {showDataLinks ? "Hide input links" : "Show input links"}</button></div>
            <div className="execution-guide">
              <ListOrdered size={14} />
              <span className="execution-route" ref={routeRef}>{execution.summary}</span>
              {execution.outsideAliases.length > 0 && <em>{execution.outsideAliases.join(", ")} outside the main path</em>}
              {routeOverflowing && <button className="route-more" type="button" onClick={() => setRouteExpanded((current) => !current)} aria-expanded={routeExpanded}>View all</button>}
            </div>
            {routeExpanded && <div className="route-popover" role="region" aria-label="Full execution order"><header><strong>Full order</strong><button type="button" onClick={() => setRouteExpanded(false)} aria-label="Close full order"><X size={14} /></button></header><p>{execution.summary}</p></div>}
          </div>
          <div className="flow-canvas" ref={canvasRef}>
            <ReactFlow<StepNode, Edge>
              key={`${activeProject.id}-${document.steps.length}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={handleNodesChange}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId("")}
              onConnect={handleConnect}
              panOnScroll
              panOnScrollMode={PanOnScrollMode.Free}
              panOnScrollSpeed={0.9}
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              panOnDrag
              selectionOnDrag={false}
              preventScrolling
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.1}
              maxZoom={2.2}
              snapToGrid
              snapGrid={[20, 20]}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Lines} gap={52} size={1} color="rgba(32,30,29,0.08)" />
              <Controls showInteractive={false} showFitView={false} position="bottom-left"><ControlButton onClick={() => fitCanvas()} title="Fit View" aria-label="Fit View"><Maximize2 size={15} /></ControlButton></Controls>
              <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={0} nodeColor={(node) => node.selected ? "#ec3013" : "#8b8888"} maskColor="rgba(243,242,242,0.84)" />
            </ReactFlow>
            <details className="canvas-legend">
              <summary>How to read the lines</summary>
              <div>
                <p><i className="line normal" /> next step</p>
                <p><i className="line true" /> condition passed</p>
                <p><i className="line false" /> condition failed</p>
                <p><i className="line loop" /> loop repeat</p>
                <p><i className="line data" /> reused result from another block</p>
              </div>
            </details>
            <section className={`ai-builder ${aiBuilderOpen ? "open" : ""}`}>
              {!aiBuilderOpen ? <button className="ai-builder-toggle" type="button" onClick={() => setAiBuilderOpen(true)}><Sparkles size={15} /><span><strong>Build a workflow with AI</strong><small>Describe the goal; AI creates a new project</small></span></button> : <>
                <header><div><Sparkles size={15} /><span><strong>Build a workflow with AI</strong><small>A new project will be created. The current graph stays safe.</small></span></div><button type="button" onClick={() => setAiBuilderOpen(false)} aria-label="Close AI builder"><X size={15} /></button></header>
                <div className="ai-builder-compose"><textarea autoFocus value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Example: Help me choose an apartment, compare mortgages, plan renovation, and loop back when the total deal is too risky." /><button type="button" disabled={!aiPrompt.trim() || aiGenerating} onClick={() => void buildWorkflowWithAI()}>{aiGenerating ? <Zap size={15} /> : <Send size={15} />} {aiGenerating ? "Designing…" : "Create project"}</button></div>
                {aiError && <p className="ai-builder-error">{aiError}</p>}
              </>}
            </section>
          </div>
        </main>

        <aside className={`inspector-panel ${rightCollapsed ? "is-collapsed" : ""}`}>
          {rightCollapsed ? <button className="panel-rail-toggle" type="button" onClick={() => setRightCollapsed(false)} aria-label="Open step settings" title="Open step settings"><PanelRightOpen size={16} /></button> : selected ? (
            <Inspector
              step={selected}
              steps={document.steps}
              settings={iccSettings}
              issues={issues.filter((issue) => issue.stepId === selected.id)}
              onCollapse={() => setRightCollapsed(true)}
              onChange={(patch) => updateStep(selected.id, patch)}
              onFlowChange={(patch) => updateStep(selected.id, (step) => ({ ...step, flow: { ...step.flow, ...patch } }))}
              onDelete={() => deleteStep(selected.id)}
              onOpenDsl={openDsl}
              onAttachFiles={(files) => void attachFiles(selected.id, files)}
              onPreviewFile={(file, source) => setPreviewFile({ file, source })}
              onRemoveFile={(fileId, source) => removeStepFile(selected.id, fileId, source)}
            />
          ) : (
            <div className="empty-inspector-shell"><div className="empty-inspector-heading"><strong>Step settings</strong><button type="button" onClick={() => setRightCollapsed(true)} aria-label="Collapse step settings" title="Collapse step settings"><PanelRightClose size={14} /></button></div><div className="empty-inspector"><GitBranch size={28} /><strong>Select a block</strong><p>Its task, model, and next-step choice will appear here.</p></div></div>
          )}
        </aside>
      </div>

      {dslOpen && (
        <div className="dsl-backdrop" role="dialog" aria-modal="true" aria-label="ICC DSL source editor">
          <section className="dsl-dialog">
            <header><div><Braces size={17} /><span><strong>ICC DSL source</strong><small>The visual workflow rebuilds automatically after saving</small></span></div><button type="button" onClick={() => setDslOpen(false)}><X size={17} /></button></header>
            <textarea value={dslDraft} onChange={(event) => setDslDraft(event.target.value)} spellCheck={false} />
            <footer><span>{dslDraft.split(/\r?\n/).length} lines · stable v1.04</span><button type="button" onClick={() => setDslOpen(false)}>Cancel</button><button className="primary" type="button" onClick={applyDsl}>Apply DSL</button></footer>
          </section>
        </div>
      )}
      {cellEditorId && document.steps.find((step) => step.id === cellEditorId) && (
        <CellEditorDialog
          step={document.steps.find((step) => step.id === cellEditorId)!}
          onClose={() => setCellEditorId(undefined)}
          onApply={applyCellEdit}
        />
      )}
      {limitsOpen && <RunLimitsDialog limits={activeProject.runLimits} stepCount={document.steps.length} onClose={() => setLimitsOpen(false)} onApply={applyRunLimits} />}
      {runOpen && <RunDialog state={runState} limits={activeProject.runLimits} onClose={() => { if (runState.status !== "running") setRunOpen(false); }} onStop={stopRun} onOpenProviders={() => { setRunOpen(false); setSettingsOpen(true); }} />}
      <SettingsDrawer open={settingsOpen} settings={iccSettings} onClose={() => setSettingsOpen(false)} onUpdateProvider={updateProvider} onAddProvider={addProvider} onDeleteProvider={removeProvider} onMoveProvider={moveProvider} onUpdateOrchestration={updateOrchestration} onResetWorkspace={resetLocalWorkspace} />
      {previewFile && <FilePreviewDialog file={previewFile.file} source={previewFile.source} onClose={() => setPreviewFile(undefined)} />}
      {toast && <div className="toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}

function StepCard({ data, selected }: NodeProps<StepNode>) {
  const { step, issues, isStart, isNew, isOutsidePath, order, onEdit, onDuplicate, onCopy, onDelete, onSetStart } = data;
  const [menuOpen, setMenuOpen] = useState(false);
  const errors = issues.filter((issue) => issue.level === "error").length;
  useEffect(() => {
    if (!selected) setMenuOpen(false);
  }, [selected]);
  return (
    <article style={{ "--node-accent": stepColorValue(step.color) } as CSSProperties} className={`step-card kind-${step.flow.kind} ${selected ? "selected" : ""} ${isNew ? "is-new" : ""} ${isOutsidePath ? "outside-path" : ""} ${errors ? "invalid" : ""}`}>
      <Handle type="target" position={Position.Left} className="flow-handle target" />
      <div className="step-card-top">
        <span className="step-alias">{step.alias}</span>
        <span className="step-kind">{nodeTypeLabel(step)}</span>
        {isStart ? <span className="start-badge">START · STEP 1</span> : order ? <span className="order-badge">STEP {order}</span> : <span className="outside-badge">OUTSIDE PATH</span>}
        {issues.length > 0 && <span className="issue-count"><AlertTriangle size={12} />{issues.length}</span>}
        <div className="node-menu-wrap nodrag nopan">
          <button className="node-menu-trigger" type="button" aria-label={`${step.alias} menu`} onClick={(event) => { event.stopPropagation(); setMenuOpen((current) => !current); }}><MoreHorizontal size={16} /></button>
          {menuOpen && <div className="node-menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => { setMenuOpen(false); onEdit(step.id); }}><FilePenLine size={14} /><span><strong>Edit cell</strong><small>Prompt and all settings</small></span></button>
            <button type="button" onClick={() => { setMenuOpen(false); onDuplicate(step.id); }}><CopyPlus size={14} /><span><strong>Duplicate</strong><small>No outgoing connections</small></span></button>
            {!isStart && <button type="button" onClick={() => { setMenuOpen(false); onSetStart(step.id); }}><ListOrdered size={14} /><span><strong>Make first step</strong><small>The run will start here</small></span></button>}
            <button type="button" onClick={() => { setMenuOpen(false); void onCopy(step.id); }}><Clipboard size={14} /><span><strong>Copy ICC</strong><small>Code for this cell</small></span></button>
            <button className="danger" type="button" onClick={() => { setMenuOpen(false); onDelete(step.id); }}><Trash2 size={14} /><span><strong>Delete</strong></span></button>
          </div>}
        </div>
      </div>
      <div className="step-card-main">
        <strong>{step.title}</strong>
        <span className="route-label">{friendlyRoute(step.route)}</span>
        <label>TASK</label>
        <p>{step.prompt || "Describe what should happen in plain language…"}</p>
      </div>
      <div className="step-card-footer">
        <span className={`flow-chip ${step.flow.kind}`}><GitBranch size={12} />{flowLabel(step)}</span>
        {step.attachments.length + step.artifacts.length > 0
          ? <span className="file-counts">{step.attachments.length > 0 && <span className="input-count">↓ {step.attachments.length} IN</span>}{step.artifacts.length > 0 && <span className="artifact-count">↑ {step.artifacts.length} OUT</span>}</span>
          : step.outputs.length > 0 && <span className="output-chip">OUTPUT</span>}
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle source"><Plus size={10} /></Handle>
    </article>
  );
}

function MaskedDashedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
  pathOptions,
  style,
  data,
}: EdgeProps<MaskedDashedEdgeType>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
    stepPosition: pathOptions?.stepPosition,
  });
  const maskId = `edge-occlusion-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return <>
    <defs>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" style={{ maskType: "luminance" }}>
        <rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff" />
        {data?.occlusionRects.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="#000" opacity={0.82} />)}
      </mask>
    </defs>
    <BaseEdge
      id={id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      style={{ ...style, mask: `url(#${maskId})` }}
    />
  </>;
}

function Inspector({ step, steps, settings, issues, onCollapse, onChange, onFlowChange, onDelete, onOpenDsl, onAttachFiles, onPreviewFile, onRemoveFile }: {
  step: WorkflowStep;
  steps: WorkflowStep[];
  settings: WorkspaceSettings;
  issues: ValidationIssue[];
  onCollapse: () => void;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onFlowChange: (patch: Partial<WorkflowStep["flow"]>) => void;
  onDelete: () => void;
  onOpenDsl: () => void;
  onAttachFiles: (files: File[]) => void;
  onPreviewFile: (file: WorkflowFile, source: "attachment" | "artifact") => void;
  onRemoveFile: (fileId: string, source: "attachment" | "artifact") => void;
}) {
  const targets = steps.filter((candidate) => candidate.id !== step.id);
  return (
    <div className="inspector-content">
      <div className="inspector-heading"><div className="alias-box">{step.alias}</div><div><strong>Step settings</strong><span>{issues.length ? formatCount(issues.length, "setup hint") : "Ready"}</span></div><div className="inspector-heading-actions"><button type="button" onClick={onCollapse} aria-label="Collapse step settings" title="Collapse step settings"><PanelRightClose size={14} /></button><button className="danger" type="button" onClick={onDelete} aria-label="Delete step" title="Delete step"><Trash2 size={14} /></button></div></div>

      <div className="friendly-section-title"><span>1</span><div><strong>What should happen?</strong><small>Name the step and explain the task in plain language</small></div></div>
      <Field label="Step name"><input value={step.title} onChange={(event) => onChange({ title: event.target.value })} /></Field>
      <div className="color-field"><span>Block color</span><div>{stepColors.map((color) => <button className={(step.color ?? "ink") === color.id ? "active" : ""} style={{ "--swatch": color.value } as CSSProperties} type="button" key={color.id} onClick={() => onChange({ color: color.id })} aria-label={`Use ${color.label}`} title={color.label} />)}</div></div>
      <Field label="Task for the model" help="Insert a previous result with %from c1."><textarea className="prompt-editor" value={step.prompt} onChange={(event) => onChange({ prompt: event.target.value })} /></Field>
      <StepFilesPanel step={step} onAttach={onAttachFiles} onPreview={onPreviewFile} onRemove={onRemoveFile} />

      <div className="friendly-section-title"><span>2</span><div><strong>Who should do it?</strong><small>Choose models and how their answers are combined</small></div></div>
      <ModelRouteBuilder route={step.route} settings={settings} onChange={(route) => onChange({ route })} />

      <div className="friendly-section-title"><span>3</span><div><strong>What happens next?</strong><small>Finish, move to the next step, or check a condition</small></div></div>
      <fieldset className="inspector-section friendly-flow"><legend className="visually-hidden">Transition</legend>
        <div className="flow-tabs">{(["none", "forward", "condition", "chain"] as FlowKind[]).map((kind) => <button className={step.flow.kind === kind ? "active" : ""} type="button" key={kind} onClick={() => onFlowChange({ kind })}>{kind === "none" ? "Finish" : kind === "forward" ? "Next" : kind === "condition" ? "If / else" : "Repeat"}</button>)}</div>
        {step.flow.kind === "forward" && <Field label="Which step should run?"><select value={step.flow.targets[0] ?? ""} onChange={(event) => onFlowChange({ targets: event.target.value ? [event.target.value] : [] })}><option value="">Choose a step</option>{targets.map((target) => <option key={target.id} value={target.alias}>{target.alias} — {target.title}</option>)}</select></Field>}
        {step.flow.kind === "condition" && <div className="condition-editor">
          <label className="plain-condition-label">If value</label>
          <div className="condition-expression"><input aria-label="Variable" value={step.flow.variable} onChange={(event) => onFlowChange({ variable: event.target.value })} /><select aria-label="Comparison" value={step.flow.operator} onChange={(event) => onFlowChange({ operator: event.target.value as ConditionOperator })}>{[">", ">=", "<", "<=", "==", "!="].map((operator) => <option key={operator}>{operator}</option>)}</select><input aria-label="Value" value={step.flow.value} onChange={(event) => onFlowChange({ value: event.target.value })} /></div>
          <div className="branch-grid"><TargetField label="YES →" value={step.flow.trueTarget} targets={targets} onChange={(trueTarget) => onFlowChange({ trueTarget })} /><TargetField label="NO →" value={step.flow.falseTarget} targets={targets} terminals onChange={(falseTarget) => onFlowChange({ falseTarget })} /></div>
          <small>Ask the model to return this value as “score = 8”.</small>
        </div>}
        {step.flow.kind === "chain" && <Field label="Repeat order" help="Repeat the first step at the end, for example: c1 > c2 > c1"><input value={step.flow.chain.join(" > ")} onChange={(event) => onFlowChange({ chain: event.target.value.split(">").map((value) => value.trim()).filter(Boolean) })} placeholder={`${step.alias} > c2 > ${step.alias}`} /></Field>}
        <div className="connect-explainer"><Link2 size={15} /><div><strong>Connect blocks on the canvas</strong><span>Drag the red plus on the right side of a block to another block.</span></div></div>
      </fieldset>

      <details className="advanced-settings">
        <summary><Braces size={14} /><span><strong>Advanced settings</strong><small>Limits, files, and ICC DSL</small></span><ChevronDown size={14} /></summary>
        <Field label="ICC model route" help="Generated by the model constructor above. Edit it directly only when needed."><input list="route-suggestions" value={step.route} onChange={(event) => onChange({ route: event.target.value })} /><datalist id="route-suggestions">{routeSuggestions.map((route) => <option key={route} value={route} />)}</datalist></Field>
        <fieldset className="inspector-section"><legend>Limits</legend><div className="limit-grid">
          <MiniField label="Cost, $" value={step.costUsd} placeholder="2.00" onChange={(costUsd) => onChange({ costUsd })} />
          <MiniField label="Time" value={step.latency} placeholder="3m" onChange={(latency) => onChange({ latency })} />
          <MiniField label="Tokens" value={step.tokens} placeholder="8000" onChange={(tokens) => onChange({ tokens })} />
          <MiniField label="Iterations" value={step.iterations} placeholder="3" onChange={(iterations) => onChange({ iterations })} />
        </div></fieldset>
        <Field label="Output format" help="@text, @file, or @image; one command per line."><textarea className="outputs-editor" value={step.outputs.join("\n")} onChange={(event) => onChange({ outputs: event.target.value.split(/\r?\n/).filter(Boolean) })} placeholder={"@text <800\n@file -markdown report.md"} /></Field>
        <button className="source-preview" type="button" onClick={onOpenDsl}><Braces size={14} /><span><strong>ICC code for {step.alias}</strong><code>{serializeStep(step).split("\n").slice(0, 3).join("  ")}</code></span><ChevronDown size={14} /></button>
      </details>
      {issues.length > 0 && <div className="issue-list">{issues.map((issue, index) => <p className={issue.level} key={`${issue.message}-${index}`}><AlertTriangle size={13} />{issue.message}</p>)}</div>}
    </div>
  );
}

function ModelRouteBuilder({ route, settings, onChange }: { route: string; settings: WorkspaceSettings; onChange: (route: string) => void }) {
  const parsed = parseModelRoute(route, settings.providers);
  const selectedIds = new Set(parsed.members.map((member) => member.providerId));
  const providers = settings.providers.filter((provider) => provider.enabled || selectedIds.has(provider.id));
  const available = providers.length ? providers : settings.providers;
  const strategyCopy = parsed.strategy === "single"
    ? "One model completes the task."
    : parsed.strategy === "best"
      ? "Every selected model answers; the selector keeps the strongest result."
      : "Every selected model answers; the synthesis model combines them into one result.";

  function changeStrategy(strategy: RouteStrategy) {
    if (!available.length) return;
    if (strategy === "single") {
      const member = parsed.members[0] ?? { providerId: available[0].id, choice: "profile:default" };
      onChange(buildModelRoute("single", [member], settings.providers));
      return;
    }
    const members = [...parsed.members];
    for (const provider of available) {
      if (members.length >= 2) break;
      if (!members.some((member) => member.providerId === provider.id)) members.push({ providerId: provider.id, choice: "profile:default" });
    }
    onChange(buildModelRoute(strategy, members, settings.providers));
  }

  function updateMember(index: number, patch: Partial<RouteMember>) {
    const members = parsed.members.map((member, memberIndex) => memberIndex === index ? { ...member, ...patch } : member);
    onChange(buildModelRoute(parsed.strategy, members, settings.providers));
  }

  function addMember() {
    if (!available.length) return;
    const nextProvider = available.find((provider) => !parsed.members.some((member) => member.providerId === provider.id)) ?? available[0];
    onChange(buildModelRoute(parsed.strategy, [...parsed.members, { providerId: nextProvider.id, choice: "profile:default" }], settings.providers));
  }

  function removeMember(index: number) {
    const members = parsed.members.filter((_, memberIndex) => memberIndex !== index);
    if (!members.length) return;
    onChange(buildModelRoute(parsed.strategy, members, settings.providers));
  }

  const singleMember = parsed.members[0] ?? (available[0] ? { providerId: available[0].id, choice: "profile:default" } : undefined);
  const singleProvider = available.find((provider) => provider.id === singleMember?.providerId) ?? available[0];

  return <section className="model-builder">
    <div className="model-strategy-tabs" role="group" aria-label="Answer strategy">
      {(["single", "best", "ensemble"] as RouteStrategy[]).map((strategy) => <button className={parsed.strategy === strategy ? "active" : ""} type="button" key={strategy} onClick={() => changeStrategy(strategy)}>{strategy === "single" ? "Single model" : strategy === "best" ? "Choose best" : "Ensemble"}</button>)}
    </div>
    <p className="model-strategy-help">{strategyCopy}</p>
    {parsed.strategy === "single" ? singleProvider && singleMember && <div className="single-model-builder">
      <label><span>Provider</span><select value={singleProvider.id} onChange={(event) => onChange(buildModelRoute("single", [{ providerId: event.target.value, choice: "profile:default" }], settings.providers))}>{available.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}{provider.apiKeyMasked ? " · linked" : ""}</option>)}</select></label>
      <ModelChoiceField provider={singleProvider} value={singleMember.choice} onChange={(choice) => onChange(buildModelRoute("single", [{ providerId: singleProvider.id, choice }], settings.providers))} />
      <div className="resolved-model"><Check size={13} /><span><strong>{choiceTitle(singleProvider, singleMember.choice)}</strong><small>{choiceDetail(singleProvider, singleMember.choice)}</small></span></div>
    </div> : <div className="multi-model-builder">
      <div className="model-member-list">{parsed.members.map((member, index) => {
        const provider = settings.providers.find((candidate) => candidate.id === member.providerId) ?? available[0];
        if (!provider) return null;
        return <div className="model-member selected" key={`${member.providerId}-${index}`}>
          <div className="model-member-heading"><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{choiceTitle(provider, member.choice)}</strong><small>{provider.label} · {provider.apiKeyMasked ? "key linked" : "key not linked"}</small></span><button type="button" onClick={() => removeMember(index)} disabled={parsed.members.length === 1} aria-label={`Remove model ${index + 1}`} title="Remove model"><Trash2 size={13} /></button></div>
          <label className="model-provider-choice"><span>Provider</span><select value={provider.id} onChange={(event) => updateMember(index, { providerId: event.target.value, choice: "profile:default" })}>{available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}{candidate.apiKeyMasked ? " · linked" : ""}</option>)}</select></label>
          <ModelChoiceField provider={provider} value={member.choice} onChange={(choice) => updateMember(index, { choice })} compact />
        </div>;
      })}</div>
      <button className="add-model-member" type="button" onClick={addMember}><Plus size={13} /> Add another model</button>
      <div className={`model-builder-summary ${parsed.members.length < 2 ? "warning" : ""}`}><Layers3 size={14} /><span><strong>{formatCount(parsed.members.length, "model")} selected</strong><small>{parsed.members.length < 2 ? "Select at least two models for this strategy." : parsed.strategy === "best" ? "The selector will return the best complete answer." : "The synthesis model will merge the answers."}</small></span></div>
    </div>}
  </section>;
}

function ModelChoiceField({ provider, value, onChange, compact = false }: { provider: ProviderSettings; value: string; onChange: (choice: string) => void; compact?: boolean }) {
  const models = modelChoicesForProviderSettings(provider);
  const standardChoices = new Set([
    "profile:default",
    ...(provider.maxModel ? ["profile:max"] : []),
    ...(provider.ensembleModel ? ["profile:ensemble"] : []),
    ...(provider.imageModel ? ["profile:image"] : []),
    ...(provider.fastModel ? ["profile:fast"] : []),
    ...(provider.cheapModel ? ["profile:cheap"] : []),
    ...(provider.codeModel ? ["profile:code"] : []),
    ...models.map((model) => `model:${model.value}`),
  ]);
  return <label className={compact ? "model-choice compact" : "model-choice"}><span>{compact ? "Variation" : "Variation or model"}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
    <optgroup label="Variations">
      <option value="profile:default">Auto · {provider.defaultModel}</option>
      {provider.maxModel && <option value="profile:max">Max · {provider.maxModel}</option>}
      {provider.ensembleModel && <option value="profile:ensemble">Ensemble · {provider.ensembleModel}</option>}
      {provider.imageModel && <option value="profile:image">Image · {provider.imageModel}</option>}
      {provider.fastModel && <option value="profile:fast">Fast · {provider.fastModel}</option>}
      {provider.cheapModel && <option value="profile:cheap">Cheap · {provider.cheapModel}</option>}
      {provider.codeModel && <option value="profile:code">Code · {provider.codeModel}</option>}
    </optgroup>
    <optgroup label="Available models">{models.map((model) => <option key={model.value} value={`model:${model.value}`}>{model.label}</option>)}</optgroup>
    {!standardChoices.has(value) && <optgroup label="Current ICC route"><option value={value}>{choiceTitle(provider, value)}</option></optgroup>}
  </select></label>;
}

function StepFilesPanel({ step, onAttach, onPreview, onRemove }: {
  step: WorkflowStep;
  onAttach: (files: File[]) => void;
  onPreview: (file: WorkflowFile, source: "attachment" | "artifact") => void;
  onRemove: (fileId: string, source: "attachment" | "artifact") => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <section className="step-files-panel">
    <input ref={inputRef} hidden multiple type="file" onChange={(event) => { onAttach(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <div className="file-zone input-zone">
      <div className="file-zone-heading"><div><Paperclip size={14} /><span><strong>Input files</strong><small>Files this step receives and reads</small></span><b>{step.attachments.length}</b></div><button type="button" onClick={() => inputRef.current?.click()}><Plus size={13} /> Attach</button></div>
      {step.attachments.length > 0 ? step.attachments.map((file) => <FileRow key={file.id} file={file} source="attachment" onPreview={onPreview} onRemove={onRemove} />) : <p className="empty-file-zone">No input files attached</p>}
    </div>
    <div className="file-zone artifact-zone">
      <div className="file-zone-heading"><div><Sparkles size={14} /><span><strong>Generated outputs</strong><small>Files created by this step after RUN</small></span><b>{step.artifacts.length}</b></div></div>
      {step.artifacts.length > 0 ? step.artifacts.map((file) => <FileRow key={file.id} file={file} source="artifact" onPreview={onPreview} onRemove={onRemove} />) : <p className="empty-file-zone">Generated files will appear here after RUN</p>}
    </div>
  </section>;
}

function FileRow({ file, source, onPreview, onRemove }: {
  file: WorkflowFile;
  source: "attachment" | "artifact";
  onPreview: (file: WorkflowFile, source: "attachment" | "artifact") => void;
  onRemove: (fileId: string, source: "attachment" | "artifact") => void;
}) {
  return <div className="file-row"><FileText size={14} /><button className="file-name" type="button" onClick={() => onPreview(file, source)}><strong>{file.name}</strong><small>{formatBytes(file.sizeBytes)}</small></button><button type="button" onClick={() => onPreview(file, source)} aria-label={`Preview ${file.name}`} title="Preview"><Eye size={13} /></button><button type="button" onClick={() => onRemove(file.id, source)} aria-label={`Remove ${file.name}`} title="Remove"><X size={13} /></button></div>;
}

function FilePreviewDialog({ file, source, onClose }: { file: WorkflowFile; source: "attachment" | "artifact"; onClose: () => void }) {
  const imageUrl = file.mimeType.startsWith("image/") ? workflowFileDataUrl(file) : undefined;
  return <div className="run-backdrop" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}><section className="file-preview-dialog">
    <header><div><FileText size={17} /><span><strong>{file.name}</strong><small>{source === "artifact" ? "Generated artifact" : "Input attachment"} · {formatBytes(file.sizeBytes)}</small></span></div><button type="button" onClick={onClose} aria-label="Close file preview"><X size={17} /></button></header>
    <div className="file-preview-body">{imageUrl ? <img src={imageUrl} alt={file.name} /> : file.encoding === "text" ? <pre>{file.content}</pre> : <div className="binary-preview"><FileText size={28} /><strong>Preview is not available for this file type</strong><span>{file.mimeType || "Binary file"}</span></div>}</div>
    <footer><span>{file.mimeType || "Unknown type"}</span><button type="button" onClick={() => downloadWorkflowFile(file)}><Download size={13} /> Download</button></footer>
  </section></div>;
}

function RunLimitsDialog({ limits, stepCount, onClose, onApply }: {
  limits: WorkflowRunLimits;
  stepCount: number;
  onClose: () => void;
  onApply: (limits: WorkflowRunLimits) => void;
}) {
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(String(limits.maxBudgetUsd));
  const [maxLoopPasses, setMaxLoopPasses] = useState(String(limits.maxLoopPasses));
  const budget = Math.max(0.01, Number(maxBudgetUsd) || limits.maxBudgetUsd);
  const passes = Math.max(1, Math.min(20, Math.round(Number(maxLoopPasses) || limits.maxLoopPasses)));
  const perCell = budget / Math.max(1, passes * stepCount);
  return (
    <div className="run-backdrop" role="dialog" aria-modal="true" aria-label="Run limits">
      <section className="limits-dialog">
        <header><div><SlidersHorizontal size={18} /><span><strong>Run limits</strong><small>Hard stops for the whole workflow</small></span></div><button type="button" onClick={onClose} aria-label="Close run limits"><X size={17} /></button></header>
        <div className="limits-body">
          <label><span>Total workflow budget</span><div className="money-input"><b>$</b><input type="number" min="0.01" step="0.5" value={maxBudgetUsd} onChange={(event) => setMaxBudgetUsd(event.target.value)} /></div><small>The runner stops before starting another step once this total is reached.</small></label>
          <label><span>Maximum full loop passes</span><input type="number" min="1" max="20" step="1" value={maxLoopPasses} onChange={(event) => setMaxLoopPasses(event.target.value)} /><small>Includes the first pass. A value of 3 allows at most three complete attempts.</small></label>
          <div className="limit-explanation"><strong>How this maps to ICC DSL</strong><p>The loop controller receives <code>&lt; iterations &lt;= {passes}</code>. The ${budget.toFixed(2)} total is also distributed conservatively as about <code>&lt; cost &lt;= ${perCell.toFixed(4)}</code> per cell call.</p><p>The visual runner additionally tracks actual accumulated run cost across the graph and stops the next loop when the total budget is reached.</p></div>
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="button" onClick={() => onApply({ maxBudgetUsd: budget, maxLoopPasses: passes })}>Save limits</button></footer>
      </section>
    </div>
  );
}

function RunDialog({ state, limits, onClose, onStop, onOpenProviders }: {
  state: VisualRunState;
  limits: WorkflowRunLimits;
  onClose: () => void;
  onStop: () => void;
  onOpenProviders: () => void;
}) {
  const running = state.status === "running";
  const statusLabel = state.status.replaceAll("_", " ");
  const runTitle = state.status === "running" ? "Running workflow"
    : state.status === "completed" ? "Workflow completed"
      : state.status === "budget_reached" ? "Budget limit reached"
        : state.status === "iteration_reached" ? "Loop limit reached"
          : state.status === "stopped" ? "Run stopped"
            : state.status === "failed" ? "Run failed"
              : "Workflow run";
  return (
    <div className="run-backdrop" role="dialog" aria-modal="true" aria-label="Workflow run">
      <section className="run-dialog">
        <header><div className={`run-status-mark ${state.status}`}>{running ? <Zap size={17} /> : state.status === "completed" ? <Check size={17} /> : <AlertTriangle size={17} />}</div><span><strong>{runTitle}</strong><small>{state.message}</small></span><button type="button" disabled={running} onClick={onClose} aria-label="Close run"><X size={17} /></button></header>
        <div className="run-metrics"><span><small>Status</small><strong>{statusLabel}</strong></span><span><small>Spent</small><strong>${state.totalCostUsd.toFixed(4)} / ${limits.maxBudgetUsd.toFixed(2)}</strong></span><span><small>Loop passes</small><strong>{Math.min(state.loopPasses + 1, limits.maxLoopPasses)} / {limits.maxLoopPasses}</strong></span></div>
        <div className="run-step-list">{Object.values(state.steps).map((step) => <details className={`run-step ${step.status}`} key={step.alias} open={step.status === "running" || step.status === "failed"}>
          <summary><span>{step.alias}</span><strong>{step.title}</strong><em>{step.status}</em><small>${step.costUsd.toFixed(4)} · {step.latencyMs}ms</small></summary>
          <div>{step.error && <p className="run-error">{step.error}</p>}<pre>{step.output || "Waiting to run…"}</pre>{step.artifacts.length > 0 && <div className="run-artifact-list"><strong>Generated files</strong>{step.artifacts.map((artifact) => <span key={artifact.id}><FileText size={12} />{artifact.name}<small>{formatBytes(artifact.sizeBytes)}</small></span>)}</div>}</div>
        </details>)}</div>
        <footer><span>ICC-GO v1.04 execution engine</span><div>{!running && state.status === "failed" && <button type="button" onClick={onOpenProviders}>Provider keys</button>}{running ? <button className="stop" type="button" onClick={onStop}><Square size={13} /> Stop run</button> : <button className="primary" type="button" onClick={onClose}>Close</button>}</div></footer>
      </section>
    </div>
  );
}

function CellEditorDialog({ step, onClose, onApply }: {
  step: WorkflowStep;
  onClose: () => void;
  onApply: (id: string, title: string, header: string, prompt: string) => void;
}) {
  const serialized = serializeStep(step).split(/\r?\n/).slice(1);
  const separator = serialized.findIndex((line) => line.trim() === "");
  const [title, setTitle] = useState(step.title);
  const [header, setHeader] = useState((separator >= 0 ? serialized.slice(0, separator) : serialized).join("\n"));
  const [prompt, setPrompt] = useState(step.prompt);

  return (
    <div className="cell-editor-backdrop" role="dialog" aria-modal="true" aria-label={`Cell editor ${step.alias}`}>
      <section className="cell-editor-dialog">
        <header>
          <div className="cell-editor-icon"><FilePenLine size={18} /></div>
          <div><strong>Cell {step.alias}</strong><span>Prompt, model, logic, and output in one place</span></div>
          <button type="button" onClick={onClose} aria-label="Close editor"><X size={18} /></button>
        </header>
        <div className="cell-editor-body">
          <label className="cell-title-field"><span>Name</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <div className="cell-sheet">
            <div className="cell-sheet-bar"><span>{step.alias}</span><strong>Execution settings</strong><small>ICC DSL lines</small></div>
            <textarea className="cell-header-editor" value={header} onChange={(event) => setHeader(event.target.value)} spellCheck={false} />
            <div className="cell-prompt-label"><Bot size={14} /><span><strong>What the model should do</strong><small>Write it like a clear task for a person</small></span></div>
            <textarea className="cell-prompt-editor" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="For example: review the previous result, find problems, and propose a better version…" />
          </div>
          <div className="cell-editor-help"><Link2 size={14} /><span>Insert another step’s result as <code>%from c1</code>. Choose <strong>Show input links</strong> above the canvas to display these dependencies as dashed lines.</span></div>
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="button" onClick={() => onApply(step.id, title, header, prompt)}>Save cell</button></footer>
      </section>
    </div>
  );
}

function LibraryButton({ icon, title, description, onClick }: { icon: React.ReactElement; title: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span>{icon}</span><div><strong>{title}</strong><small>{description}</small></div><Plus size={15} /></button>;
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

function MiniField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function TargetField({ label, value, targets, terminals = false, onChange }: { label: string; value: string; targets: WorkflowStep[]; terminals?: boolean; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose</option>{targets.map((target) => <option key={target.id} value={target.alias}>{target.alias} — {target.title}</option>)}{terminals && <option value="done">Finish</option>}{terminals && <option value="stop">Stop</option>}</select></label>;
}

function buildEdges(steps: WorkflowStep[], positions: WorkflowDocument["positions"], showDataLinks: boolean): Edge[] {
  const byAlias = new Map(steps.map((step) => [step.alias, step]));
  const stepIndex = new Map(steps.map((step, index) => [step.alias, index]));
  const edges = new Map<string, Edge>();
  const controlPairs = new Set<string>();
  const occlusionRects = steps.map((step) => {
    const position = positions[step.id] ?? { x: 80, y: 80 };
    return { x: position.x + 2, y: position.y + 2, width: 276, height: 184 };
  });
  type EdgeKind = "flow" | "true" | "false" | "loop" | "data";
  const add = (sourceAlias: string, targetAlias: string, kind: EdgeKind, label?: string) => {
    const source = byAlias.get(sourceAlias); const target = byAlias.get(targetAlias);
    if (!source || !target) return;
    const pair = `${sourceAlias}:${targetAlias}`;
    if (kind === "data" && controlPairs.has(pair)) return;
    if (kind !== "data" && controlPairs.has(pair)) return;
    const id = `${kind}:${sourceAlias}:${targetAlias}`;
    const color = kind === "true" ? "#ec3013" : kind === "false" || kind === "loop" ? "#201e1d" : kind === "data" ? "#aaa7a5" : "#777472";
    const labeled = Boolean(label);
    const data = kind === "data";
    edges.set(id, {
      id,
      source: source.id,
      target: target.id,
      label: label || undefined,
      type: kind === "loop" || data ? "masked-dashed" : "smoothstep",
      data: kind === "loop" || data ? { occlusionRects } : undefined,
      animated: false,
      zIndex: data ? 0 : 2,
      markerEnd: data ? undefined : { type: MarkerType.ArrowClosed, color, width: 10, height: 10 },
      pathOptions: {
        borderRadius: 0,
        offset: data ? 76 : kind === "loop" ? 58 : labeled ? 28 : 16,
        stepPosition: kind === "true" ? 0.42 : kind === "false" ? 0.58 : data ? 0.36 : 0.5,
      },
      style: {
        stroke: color,
        strokeWidth: data ? 1 : kind === "flow" ? 1.6 : 2,
        strokeDasharray: kind === "loop" ? "8 5" : data ? "3 6" : undefined,
        opacity: data ? 0.62 : 1,
      },
      labelStyle: { fill: labeled ? "#ffffff" : color, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em" },
      labelBgStyle: { fill: color, fillOpacity: labeled ? 1 : 0 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 0,
    } as Edge);
    if (kind !== "data") controlPairs.add(pair);
  };

  steps.forEach((step) => {
    if (step.flow.kind === "forward") step.flow.targets.forEach((target) => {
      const backward = (stepIndex.get(target) ?? Number.POSITIVE_INFINITY) <= (stepIndex.get(step.alias) ?? -1);
      add(step.alias, target, backward ? "loop" : "flow", backward ? "RETRY" : undefined);
    });
    if (step.flow.kind === "condition") {
      ([{ target: step.flow.trueTarget, kind: "true" as const, label: "YES" }, { target: step.flow.falseTarget, kind: "false" as const, label: "NO" }]).forEach(({ target, kind, label }) => {
        const backward = (stepIndex.get(target) ?? Number.POSITIVE_INFINITY) <= (stepIndex.get(step.alias) ?? -1);
        add(step.alias, target, backward ? "loop" : kind, backward ? `${label} · RETRY` : label);
      });
    }
  });
  steps.forEach((step) => {
    if (step.flow.kind === "chain") step.flow.chain.slice(0, -1).forEach((source, index) => {
      const target = step.flow.chain[index + 1];
      const backward = (stepIndex.get(target) ?? Number.POSITIVE_INFINITY) <= (stepIndex.get(source) ?? -1);
      add(source, target, backward ? "loop" : "flow", backward ? "RETRY" : undefined);
    });
  });
  if (showDataLinks) steps.forEach((step) => {
    for (const match of step.prompt.matchAll(/%from\s+(c[0-9]+)/gi)) add(match[1].toLowerCase(), step.alias, "data");
  });
  return [...edges.values()];
}

interface ExecutionModel {
  entryStepId?: string;
  orders: Map<string, number>;
  outsideAliases: string[];
  summary: string;
  controlLinkCount: number;
}

function buildExecutionModel(document: WorkflowDocument): ExecutionModel {
  const entry = document.steps.find((step) => step.id === document.entryStepId) ?? document.steps[0];
  if (!entry) return { orders: new Map(), outsideAliases: [], summary: "add the first step", controlLinkCount: 0 };
  const byAlias = new Map(document.steps.map((step) => [step.alias, step]));
  const orders = new Map<string, number>([[entry.alias, 1]]);
  const queue = [entry.alias];

  while (queue.length) {
    const alias = queue.shift()!;
    const step = byAlias.get(alias);
    if (!step) continue;
    const nextOrder = (orders.get(alias) ?? 0) + 1;
    executionTargets(step).forEach((target) => {
      if (!byAlias.has(target) || orders.has(target)) return;
      orders.set(target, nextOrder);
      queue.push(target);
    });
  }

  return {
    entryStepId: entry.id,
    orders,
    outsideAliases: document.steps.filter((step) => !orders.has(step.alias)).map((step) => step.alias),
    summary: describeExecution(entry, byAlias),
    controlLinkCount: countControlLinks(document.steps),
  };
}

function countControlLinks(steps: WorkflowStep[]): number {
  const pairs = new Set<string>();
  steps.forEach((step) => {
    if (step.flow.kind === "forward") step.flow.targets.forEach((target) => pairs.add(`${step.alias}:${target}`));
    if (step.flow.kind === "condition") [step.flow.trueTarget, step.flow.falseTarget].filter(Boolean).forEach((target) => pairs.add(`${step.alias}:${target}`));
  });
  steps.forEach((step) => {
    if (step.flow.kind !== "chain") return;
    step.flow.chain.slice(0, -1).forEach((source, index) => pairs.add(`${source}:${step.flow.chain[index + 1]}`));
  });
  return [...pairs].filter((pair) => !pair.endsWith(":done") && !pair.endsWith(":stop")).length;
}

function executionTargets(step: WorkflowStep): string[] {
  if (step.flow.kind === "forward") return step.flow.targets;
  if (step.flow.kind === "condition") return [step.flow.trueTarget, step.flow.falseTarget].filter((target) => target !== "done" && target !== "stop");
  if (step.flow.kind === "chain") return step.flow.chain;
  return [];
}

function describeExecution(entry: WorkflowStep, byAlias: Map<string, WorkflowStep>): string {
  const parts = [entry.title];
  const visited = new Set([entry.alias]);
  let current = entry;

  for (let depth = 0; depth < byAlias.size + 1; depth += 1) {
    if (current.flow.kind === "forward" && current.flow.targets[0]) {
      const target = current.flow.targets[0];
      const next = byAlias.get(target);
      parts.push("→", next?.title ?? target);
      if (!next || visited.has(target)) break;
      visited.add(target);
      current = next;
      continue;
    }
    if (current.flow.kind === "condition") {
      parts.push(`· GOOD RESULT → ${describeBranch(current.flow.trueTarget, byAlias)} · NEEDS WORK → ${describeBranch(current.flow.falseTarget, byAlias)}`);
      break;
    }
    if (current.flow.kind === "chain") {
      const loopTarget = current.flow.chain[0];
      parts.push(`· REPEAT FROM ${describeBranch(loopTarget, byAlias)}${current.iterations ? ` · UP TO ${current.iterations} PASSES` : ""}`);
      break;
    }
    parts.push("→ Finish");
    break;
  }
  return parts.join(" ");
}

function describeBranch(alias: string, byAlias: Map<string, WorkflowStep>): string {
  if (alias === "done") return "Finish";
  if (alias === "stop") return "Stop";
  const step = byAlias.get(alias);
  return step?.title ?? (alias || "Not selected");
}

function removeTarget(step: WorkflowStep, alias: string): WorkflowStep {
  const flow = { ...step.flow, targets: step.flow.targets.filter((target) => target !== alias), trueTarget: step.flow.trueTarget === alias ? "" : step.flow.trueTarget, falseTarget: step.flow.falseTarget === alias ? "done" : step.flow.falseTarget, chain: step.flow.chain.filter((target) => target !== alias) };
  return { ...step, flow };
}

function flowLabel(step: WorkflowStep): string {
  if (step.flow.kind === "forward") return step.flow.targets[0] ? `next: ${step.flow.targets[0]}` : "choose next step";
  if (step.flow.kind === "condition") return "yes / no";
  if (step.flow.kind === "chain") return "repeat";
  return "done";
}

function friendlyRoute(route: string): string {
  if (!route) return "Automatic model selection";
  if (route.includes(".best")) return `${route} · choose best answer`;
  if (route.includes(".ensemble")) return `${route} · combine answers`;
  return route;
}

function nodeTypeLabel(step: WorkflowStep): string {
  if (step.flow.kind === "condition") return "DECISION";
  if (step.flow.kind === "chain") return "LOOP";
  if (step.route.includes("+") || step.route.includes(".best") || step.route.includes(".ensemble")) return "COMPARISON";
  return "AI TASK";
}

function safeName(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "workflow"; }

function cloneIccSettings(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    providers: settings.providers.map((provider) => ({ ...provider, balance: { ...provider.balance }, modelCatalog: provider.modelCatalog?.map((model) => ({ ...model })) })),
    orchestration: { ...settings.orchestration },
  };
}

function readFirstStorageValue(primaryKey: string, legacyKeys: string[]): string | null {
  for (const key of [primaryKey, ...legacyKeys]) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
}

function loadIccSettings(): WorkspaceSettings {
  const fallback = cloneIccSettings(createInitialWorkspace().settings);
  try {
    const stored = readFirstStorageValue(SETTINGS_STORAGE_KEY, LEGACY_SETTINGS_STORAGE_KEYS);
    if (!stored) return syncLinkedProviderSecrets(fallback);
    const parsed = JSON.parse(stored) as Partial<WorkspaceSettings>;
    return syncLinkedProviderSecrets({
      providers: parsed.providers?.length ? parsed.providers.map(normalizeProviderSettings) : fallback.providers,
      orchestration: normalizeOrchestrationSettings({ ...fallback.orchestration, ...parsed.orchestration }),
    });
  } catch {
    return syncLinkedProviderSecrets(fallback);
  }
}

function syncLinkedProviderSecrets(settings: WorkspaceSettings): WorkspaceSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => {
      const secret = readProviderSecret(provider.id);
      if (!secret) return provider;
      return {
        ...provider,
        enabled: true,
        apiKeyMasked: provider.apiKeyMasked || maskProviderSecret(secret),
      };
    }),
  };
}

function maskProviderSecret(value: string): string {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function loadWorkspace(): WorkflowWorkspace {
  const requestedExample = readRequestedVisualExample();
  if (requestedExample) {
    const project = createProjectRecord(
      createVisualExampleDocument(requestedExample),
      "Review, critique, and export a product spec as a reproducible visual AI loop.",
    );
    return { activeProjectId: project.id, projects: [project] };
  }
  try {
    const stored = readFirstStorageValue(STORAGE_KEY, LEGACY_STORAGE_KEYS);
    if (stored) {
      const parsed = JSON.parse(stored) as WorkflowWorkspace;
      if (parsed.projects?.length && parsed.projects.some((project) => project.id === parsed.activeProjectId)) {
        return {
          ...parsed,
          projects: parsed.projects.map((project) => ({
            ...project,
            document: { ...project.document, steps: project.document.steps.map((step, index) => ({
              ...step,
              color: step.color ?? stepColors[index % stepColors.length].id,
              attachments: step.attachments ?? [],
              artifacts: project.document.title === "Choose the right apartment" && index === 1 && !(step.artifacts?.length) ? apartmentDemoArtifacts() : step.artifacts ?? [],
            })) },
          })),
        };
      }
    }
  } catch { /* use a fresh workspace */ }
  const project = createProjectRecord(createDemoDocument(), "Choose an apartment only after validating its price, resale value, mortgage, and renovation budget.");
  return { activeProjectId: project.id, projects: [project] };
}

function readRequestedVisualExample(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get("example") ?? undefined;
}

function clearVisualExampleQuery() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("example") && !params.has("view")) return;
  params.delete("example");
  params.delete("view");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

function createVisualExampleDocument(exampleId: string): WorkflowDocument {
  if (exampleId !== "product-spec") return createDemoDocument();
  const parsed = parseIcc(`# c1
> openai.max
@forward c2
@text <700

Draft a product spec for a lightweight issue triage assistant.
Include target users, core workflow, data boundaries, launch scope, and explicit non-goals.

# c2
> claude.max
@forward c3
@text <650

Critique %from c1 as a product, privacy, and engineering reviewer.
Find unclear requirements, missing edge cases, data-retention risks, and release blockers.

# c3
> auto
@file -markdown final_spec.md

Rewrite the final spec using %from c1 and %from c2.
Produce a concise Markdown file with assumptions, user flows, acceptance criteria, open questions, and a release checklist.`);
  parsed.title = "Product spec review";
  parsed.steps[0].title = "Draft spec";
  parsed.steps[1].title = "Critique";
  parsed.steps[2].title = "Export final";
  parsed.steps.forEach((step, index) => { step.color = stepColors[index % stepColors.length].id; });
  parsed.positions = {
    [parsed.steps[0].id]: { x: 60, y: 190 },
    [parsed.steps[1].id]: { x: 410, y: 190 },
    [parsed.steps[2].id]: { x: 760, y: 190 },
  };
  return parsed;
}

function createDemoDocument(): WorkflowDocument {
  const parsed = parseIcc(`# c1
> (openai + claude).best
@forward c2
@text <700

Compare three apartments in Valencia for a household with €80,000 available upfront and a maximum total housing payment of €2,200 per month. Option A: €320,000, 85 m², needs about €45,000 of renovation. Option B: €355,000, 78 m², recently renovated. Option C: €295,000, 92 m², needs about €70,000 of renovation. Estimate a fair purchase-price range from current comparable properties, flag legal and building risks, and state which facts require professional verification.

# c2
> openai.reasoning
@forward c3
@text <900

Using %from c1, estimate conservative, base, and optimistic resale values after 5 and 10 years. Include purchase taxes, selling costs, renovation, maintenance, and inflation assumptions. Explain which apartment preserves value best and why.

# c3
> openai.max
@forward c4
@text <900

Using the price analysis from %from c1 and resale scenarios from %from c2, compare currently available fixed and variable mortgage structures for an €80,000 upfront budget. Calculate APR, fees, monthly payment, total interest, and a stress case with rates 2 percentage points higher. Never invent an offer: identify every rate or condition that needs verification with a bank or broker.

# c4
> claude.max
< iterations <= 3
@if score >= 8 -> done
@else -> c1
@text <1000

Create a practical renovation concept for the leading apartment using %from c1, %from c2, and %from c3. Include room priorities, two design directions, a phased budget, a 15% contingency, and a simple timeline. Then audit the entire deal: purchase, financing, renovation, monthly affordability, and resale downside. Return score = <0..10> and a clear buy / renegotiate / reject recommendation. A score below 8 sends the workflow back to apartment selection.`);
  parsed.title = "Choose the right apartment";
  parsed.steps[0].title = "Price check";
  parsed.steps[1].title = "Resale value";
  parsed.steps[2].title = "Best mortgage";
  parsed.steps[3].title = "Renovation plan";
  parsed.steps.forEach((step, index) => { step.color = stepColors[index % stepColors.length].id; });
  parsed.steps[1].artifacts = apartmentDemoArtifacts();
  parsed.positions = {
    [parsed.steps[0].id]: { x: 20, y: 170 },
    [parsed.steps[1].id]: { x: 340, y: 170 },
    [parsed.steps[2].id]: { x: 660, y: 170 },
    [parsed.steps[3].id]: { x: 980, y: 170 },
  };
  return parsed;
}

function createStarterDocument(): WorkflowDocument {
  const parsed = parseIcc(`# c1
> auto
@forward c2

Describe the problem, constraints, and signs of a good result.

# c2
> openai.reasoning
@forward c3

Create a solution based on %from c1. If the loop repeats, incorporate feedback from %from c3.

# c3
> claude.max
< iterations <= 3
@if score >= 8 -> done
@else -> c2

Independently review %from c2. Return score = <0..10> and specific feedback for improvement.`);
  parsed.title = "New development loop";
  parsed.steps[0].title = "Understand the task";
  parsed.steps[1].title = "Create a solution";
  parsed.steps[2].title = "Review and improve";
  parsed.steps.forEach((step, index) => { step.color = stepColors[index % stepColors.length].id; });
  parsed.positions = {
    [parsed.steps[0].id]: { x: 40, y: 170 },
    [parsed.steps[1].id]: { x: 390, y: 170 },
    [parsed.steps[2].id]: { x: 740, y: 170 },
  };
  return parsed;
}

function createProjectRecord(document: WorkflowDocument, goal: string): WorkflowProject {
  const runLimits = { maxLoopPasses: 3, maxBudgetUsd: 5 };
  return { id: crypto.randomUUID(), goal, document: documentWithRunLimits(document, runLimits), runLimits };
}

function demoArtifact(name: string, mimeType: string, content: string): WorkflowFile {
  return { id: crypto.randomUUID(), name, mimeType, sizeBytes: new TextEncoder().encode(content).length, encoding: "text", content, createdAt: new Date().toISOString() };
}

function apartmentDemoArtifacts(): WorkflowFile[] {
  return [
    demoArtifact("resale-scenarios.md", "text/markdown", "# Resale scenarios\n\n- Conservative: validate local comparable sales and downside assumptions.\n- Base: include taxes, maintenance, renovation, and selling costs.\n- Optimistic: keep appreciation assumptions separate and explicit."),
    demoArtifact("apartment-comparison.csv", "text/csv", "option,purchase_price,renovation_budget,horizon\nA,320000,45000,5 years\nB,355000,0,5 years\nC,295000,70000,5 years\n"),
    demoArtifact("valuation-assumptions.json", "application/json", JSON.stringify({ inflation: "verify current rate", selling_costs: "estimate locally", scenarios: ["conservative", "base", "optimistic"] }, null, 2)),
  ];
}

function documentWithRunLimits(document: WorkflowDocument, limits: WorkflowRunLimits): WorkflowDocument {
  const perCellCap = limits.maxBudgetUsd / Math.max(1, limits.maxLoopPasses * document.steps.length);
  return {
    ...document,
    steps: document.steps.map((step, index, all) => ({
      ...step,
      costUsd: perCellCap.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
      iterations: isLoopController(step, index, all) ? String(limits.maxLoopPasses) : step.iterations,
    })),
  };
}

function isLoopController(step: WorkflowStep, index: number, steps: WorkflowStep[]): boolean {
  if (step.flow.kind === "chain") return new Set(step.flow.chain).size < step.flow.chain.length;
  const indices = new Map(steps.map((candidate, candidateIndex) => [candidate.alias, candidateIndex]));
  return executionTargets(step).some((target) => (indices.get(target) ?? Number.POSITIVE_INFINITY) <= index);
}

function emptyRunState(document?: WorkflowDocument): VisualRunState {
  return {
    status: "idle",
    totalCostUsd: 0,
    loopPasses: 0,
    message: "Ready to run.",
    steps: Object.fromEntries((document?.steps ?? []).map((step) => [step.alias, {
      alias: step.alias,
      title: step.title,
      status: "queued" as const,
      output: "",
      costUsd: 0,
      latencyMs: 0,
      artifacts: [],
    }])),
  };
}

function stepColorValue(color?: StepColor): string {
  return stepColors.find((candidate) => candidate.id === (color ?? "ink"))?.value ?? "#201e1d";
}

function titleFromRequest(request: string): string {
  const firstLine = request.split(/\r?\n/)[0].trim().replace(/[.!?]+$/, "");
  if (!firstLine) return "AI-generated workflow";
  return firstLine.length > 52 ? `${firstLine.slice(0, 49).trim()}…` : firstLine;
}

async function readWorkflowFile(file: File): Promise<WorkflowFile> {
  const text = isTextLikeFile(file);
  const content = text ? await file.text() : arrayBufferToBase64(await file.arrayBuffer());
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    encoding: text ? "text" : "base64",
    content,
    createdAt: new Date().toISOString(),
  };
}

function isTextLikeFile(file: File): boolean {
  return file.type.startsWith("text/") || /\.(md|txt|json|csv|tsv|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|sql|sh|go|rs)$/i.test(file.name);
}

function isTextArtifact(mimeType: string, name: string): boolean {
  return mimeType.startsWith("text/") || /(?:json|xml|yaml|csv|javascript|typescript|markdown)/i.test(mimeType) || /\.(md|txt|json|csv|tsv|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|sql|sh|go|rs)$/i.test(name);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function workflowFileDataUrl(file: WorkflowFile): string {
  return file.encoding === "base64"
    ? `data:${file.mimeType};base64,${file.content}`
    : `data:${file.mimeType};charset=utf-8,${encodeURIComponent(file.content)}`;
}

function downloadWorkflowFile(file: WorkflowFile) {
  const link = window.document.createElement("a");
  link.href = workflowFileDataUrl(file);
  link.download = file.name;
  link.click();
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

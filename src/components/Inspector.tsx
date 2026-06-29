import { AlertTriangle, CheckCircle2, Clock3, Cpu, Database, FileText, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { fileKindLabel, formatBytes } from "../domain/attachments";
import { artifactIcon } from "../domain/runtime";
import type { NotebookCell, ParsedDsl, WorkspaceSettings } from "../domain/types";

interface InspectorProps {
  cell?: NotebookCell;
  parsed?: ParsedDsl;
  settings: WorkspaceSettings;
}

export function Inspector({ cell, parsed, settings }: InspectorProps) {
  if (!cell || !parsed) {
    return (
      <div className="inspector-content">
        <p className="eyebrow">Inspector</p>
        <h2>No cell selected</h2>
      </div>
    );
  }

  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const runErrors = cell.lastRun?.errors ?? [];

  return (
    <div className="inspector-content">
      <p className="eyebrow">Cell Inspector</p>
      <div className="inspector-heading">
        <h2>{cell.alias}</h2>
        <span className={`status-pill ${cell.status}`}>{cell.status}</span>
      </div>

      <InspectorSection icon={<Database size={15} />} title="Cell">
        <dl className="metadata-grid">
          <dt>Title</dt>
          <dd>{cell.title}</dd>
          <dt>Created</dt>
          <dd>{formatDate(cell.createdAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatDate(cell.updatedAt)}</dd>
          <dt>Last run</dt>
          <dd>{cell.lastRun ? formatDate(cell.lastRun.startedAt) : "none"}</dd>
        </dl>
        {cell.staleReason && <p className="inspector-warning">{cell.staleReason}</p>}
      </InspectorSection>

      <InspectorSection icon={<Cpu size={15} />} title="Parsed Control Header">
        <dl className="metadata-grid">
          <dt>Provider</dt>
          <dd>
            {parsed.routing?.providers.map((provider) => provider.alias ?? provider.label ?? provider.provider).join(", ") ||
              settings.orchestration.fallbackProvider}
          </dd>
          <dt>Mode</dt>
          <dd>{parsed.routing?.mode ?? "single"}</dd>
          <dt>Constraints</dt>
          <dd>{describeConstraints(parsed, settings)}</dd>
          <dt>Flow</dt>
          <dd>{describeFlow(parsed)}</dd>
          <dt>Outputs</dt>
          <dd>{describeOutputs(parsed)}</dd>
          <dt>Sender notes</dt>
          <dd>{parsed.senderNotes?.length ?? 0}</dd>
        </dl>
        {errors.length ? <DiagnosticList diagnostics={errors} /> : <p className="quiet-text">Header parsed cleanly.</p>}
      </InspectorSection>

      <InspectorSection icon={<GitBranch size={15} />} title="Execution Plan">
        {cell.lastRun?.executionPlan.length ? (
          <ul className="plain-list">
            {cell.lastRun.executionPlan.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <ul className="plain-list">
            <li>routing: {parsed.routing?.raw ?? settings.orchestration.fallbackProvider}</li>
            <li>flow: {describeFlow(parsed)}</li>
            <li>outputs: {describeOutputs(parsed)}</li>
          </ul>
        )}
      </InspectorSection>

      <InspectorSection icon={<Database size={15} />} title="Data Flow">
        <dl className="metadata-grid">
          <dt>Forward targets</dt>
          <dd>{forwardTargets(parsed).join(", ") || "none"}</dd>
          <dt>Resolved values</dt>
          <dd>{cell.lastRun?.inputResolved || "not resolved"}</dd>
          <dt>Data dependencies</dt>
          <dd>{dataDependencies(parsed).join(", ") || "none"}</dd>
          <dt>All references</dt>
          <dd>{parsed.references.length ? parsed.references.map((reference) => reference.raw).join(", ") : "none"}</dd>
          <dt>Attachments</dt>
          <dd>{cell.attachments.length || "none"}</dd>
          <dt>Artifacts</dt>
          <dd>{parsed.outputs.uses.length ? parsed.outputs.uses.map((use) => `${use.alias}/${use.filename}`).join(", ") : "none"}</dd>
        </dl>
        {cell.attachments.length > 0 && (
          <div className="inspector-artifacts">
            {cell.attachments.map((attachment) => (
              <span key={attachment.id}>
                {fileKindLabel(attachment)} · {attachment.displayName} · {formatBytes(attachment.sizeBytes)}
              </span>
            ))}
          </div>
        )}
      </InspectorSection>

      <InspectorSection icon={<FileText size={15} />} title="Outputs">
        <dl className="metadata-grid">
          <dt>Text</dt>
          <dd>
            {parsed.outputs.text?.limitChars
              ? `preview <${parsed.outputs.text.limitChars}`
              : parsed.outputs.text
                ? "full"
                : parsed.outputs.files.length || parsed.outputs.images.length
                  ? "hidden by artifact mode"
                  : "full"}
          </dd>
          <dt>Vars</dt>
          <dd>{Object.keys(cell.vars).length ? JSON.stringify(cell.vars) : "none"}</dd>
          <dt>Decision</dt>
          <dd>{describeDecision(cell)}</dd>
          <dt>Artifacts</dt>
          <dd>{cell.artifacts.length || "none"}</dd>
        </dl>
        {cell.artifacts.length > 0 && (
          <div className="inspector-artifacts">
            {cell.artifacts.map((artifact) => (
              <span key={artifact.id} className={artifact.status === "failed" ? "failed" : ""}>
                {artifactIcon(artifact.extension)} {artifact.displayName}
                {artifact.version > 1 ? ` v${artifact.version}` : ""}
              </span>
            ))}
          </div>
        )}
      </InspectorSection>

      <InspectorSection icon={<Clock3 size={15} />} title="Run History">
        {cell.runHistory.length ? (
          <div className="run-list">
            {cell.runHistory.slice(0, 6).map((run) => (
              <div key={run.id}>
                <strong>{run.status}</strong>
                <span>{new Date(run.startedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-text">Runs will appear here.</p>
        )}
      </InspectorSection>

      <InspectorSection icon={<AlertTriangle size={15} />} title="Errors">
        {parsed.diagnostics.length || runErrors.length ? (
          <>
            <DiagnosticList diagnostics={parsed.diagnostics} />
            <DiagnosticList diagnostics={runErrors} />
          </>
        ) : (
          <p className="quiet-text">
            <CheckCircle2 size={14} />
            No errors.
          </p>
        )}
      </InspectorSection>

      <InspectorSection icon={<FileText size={15} />} title="Prompt Guidance">
        {parsed.flow.type === "if" && parsed.flow.expression ? (
          <p className="quiet-text">
            This condition requires `{parsed.flow.expression.variable}` in parsed output. Return JSON with that key,
            or a key=value line such as `{parsed.flow.expression.variable}=42`.
          </p>
        ) : (
          <p className="quiet-text">Add @file, @text, @if, or references to expose richer metadata here.</p>
        )}
      </InspectorSection>
    </div>
  );
}

function InspectorSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function DiagnosticList({ diagnostics }: { diagnostics: Array<{ level: string; message: string; line?: number }> }) {
  if (!diagnostics.length) return null;

  return (
    <div className="inspector-list">
      {diagnostics.map((diagnostic, index) => (
        <p className={diagnostic.level} key={`${diagnostic.message}-${index}`}>
          {diagnostic.line ? `Line ${diagnostic.line}: ` : ""}
          {diagnostic.message}
        </p>
      ))}
    </div>
  );
}

function describeConstraints(parsed: ParsedDsl, settings: WorkspaceSettings): string {
  const parts = [
    parsed.constraints.costMaxUsd ? `$${parsed.constraints.costMaxUsd}` : `$${settings.orchestration.defaultCostCapUsd} default`,
    parsed.constraints.latencyMaxSec ? `${parsed.constraints.latencyMaxSec}s` : `${settings.orchestration.defaultLatencyCapSec}s default`,
    parsed.constraints.tokensMax ? `${parsed.constraints.tokensMax} tokens` : undefined,
    parsed.constraints.iterationsMax ? `${parsed.constraints.iterationsMax} iterations` : undefined,
  ].filter(Boolean);

  return parts.join(", ");
}

function describeFlow(parsed: ParsedDsl): string {
  const flow = parsed.flow;

  if (flow.type === "forward") return `forward and run ${forwardTargets(parsed).join(", ")}`;
  if (flow.type === "chain") return `${flow.loop ? "loop" : "chain"} ${flow.nodes.join(" > ")}`;
  if (flow.type === "if") return `${flow.condition} -> ${flow.target}${flow.elseTarget ? `, else -> ${flow.elseTarget}` : ""}`;
  if (flow.type === "input") return "%input";
  return "none";
}

function forwardTargets(parsed: ParsedDsl): string[] {
  return parsed.flow.type === "forward" ? parsed.flow.targets ?? [parsed.flow.target] : [];
}

function dataDependencies(parsed: ParsedDsl): string[] {
  return [...new Set(parsed.references.filter((reference) => reference.kind === "from").map((reference) => reference.alias).filter(Boolean))] as string[];
}

function describeOutputs(parsed: ParsedDsl): string {
  const parts = [
    parsed.outputs.text ? (parsed.outputs.text.limitChars ? `text <${parsed.outputs.text.limitChars}` : "text full") : undefined,
    parsed.outputs.files.length ? `${parsed.outputs.files.length} file(s)` : undefined,
    parsed.outputs.images.length ? `${parsed.outputs.images.length} image(s)` : undefined,
    parsed.outputs.uses.length ? `${parsed.outputs.uses.length} artifact input(s)` : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "text full";
}

function describeDecision(cell: NotebookCell): string {
  if (!cell.decision) return "none";
  if (cell.decision.error) return cell.decision.error;
  return `${cell.decision.conditionRaw} = ${String(cell.decision.result)}${cell.decision.routeTarget ? ` -> ${cell.decision.routeTarget}` : ""}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

import type { ConditionOperator, StepColor, StepFlow, ValidationIssue, WorkflowDocument, WorkflowStep } from "./types";

const serviceLine = /^(?:>|<|@|%)/;
const flowLine = /^@(forward!?|chain|if|else)\b/i;
const outputLine = /^@(text|file|image)\b/i;

export function parseIcc(source: string): WorkflowDocument {
  const matches = [...source.matchAll(/^#\s+(c[0-9]+)\s*$/gim)];
  const steps = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    return parseCell(match[1].toLowerCase(), source.slice(start, end), index);
  });

  return {
    title: "Imported ICC workflow",
    dslVersion: "1.04",
    steps,
    positions: autoLayout(steps),
    entryStepId: steps[0]?.id,
  };
}

export function serializeIcc(document: WorkflowDocument): string {
  return document.steps.map((step) => serializeStep(step)).join("\n\n").trimEnd() + "\n";
}

export function serializeStep(step: WorkflowStep): string {
  const lines = [`# ${step.alias}`];
  if (step.route.trim()) lines.push(`> ${step.route.trim()}`);
  if (validNumber(step.costUsd)) lines.push(`< cost <= $${step.costUsd.trim()}`);
  if (/^[0-9]+(?:ms|s|m|h)$/i.test(step.latency.trim())) lines.push(`< latency <= ${step.latency.trim()}`);
  if (/^[1-9][0-9]*$/.test(step.tokens.trim())) lines.push(`< tokens <= ${step.tokens.trim()}`);
  if (/^[1-9][0-9]*$/.test(step.iterations.trim())) lines.push(`< iterations <= ${step.iterations.trim()}`);

  if (step.flow.kind === "forward") {
    step.flow.targets.forEach((target) => lines.push(`@forward ${target}`));
  } else if (step.flow.kind === "condition" && step.flow.trueTarget) {
    lines.push(`@if ${step.flow.variable || "result"} ${step.flow.operator} ${step.flow.value || "true"} -> ${step.flow.trueTarget}`);
    if (step.flow.falseTarget) lines.push(`@else -> ${step.flow.falseTarget}`);
  } else if (step.flow.kind === "chain" && step.flow.chain.length) {
    lines.push(`@chain ${step.flow.chain.join(" > ")}`);
  }

  step.outputs.filter((line) => outputLine.test(line.trim())).forEach((line) => lines.push(line.trim()));
  step.passthrough.filter(Boolean).forEach((line) => lines.push(line));
  if (step.prompt.trim()) lines.push("", step.prompt.trim());
  return lines.join("\n");
}

export function validateWorkflow(document: WorkflowDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const aliases = new Set<string>();
  document.steps.forEach((step) => {
    if (aliases.has(step.alias)) issues.push({ stepId: step.id, level: "error", message: `Duplicate alias ${step.alias}.` });
    aliases.add(step.alias);
  });

  document.steps.forEach((step) => {
    if (!step.route.trim()) issues.push({ stepId: step.id, level: "warning", message: "No explicit model route; runtime fallback will be used." });
    if (!step.prompt.trim()) issues.push({ stepId: step.id, level: "warning", message: "Prompt is empty." });
    if (step.latency && !/^[0-9]+(?:ms|s|m|h)$/i.test(step.latency)) issues.push({ stepId: step.id, level: "error", message: "Latency must look like 500ms, 30s, 3m, or 1h." });
    if (step.flow.kind === "condition") {
      if (!step.flow.trueTarget) issues.push({ stepId: step.id, level: "error", message: "Conditional flow needs a true target." });
      if (/\s/.test(step.flow.value.trim())) issues.push({ stepId: step.id, level: "error", message: "ICC v1.04 condition values cannot contain spaces." });
    }
    flowTargets(step.flow).forEach((target) => {
      if (target !== "done" && target !== "stop" && !aliases.has(target)) issues.push({ stepId: step.id, level: "error", message: `Unknown flow target ${target}.` });
    });
    if (step.flow.kind === "chain" && hasRepeatedAlias(step.flow.chain) && !step.iterations) {
      issues.push({ stepId: step.id, level: "warning", message: "Cycle has no explicit iteration cap; ICC-GO will use its workspace default." });
    }
    for (const reference of step.prompt.matchAll(/%from\s+(c[0-9]+)/gi)) {
      if (!aliases.has(reference[1].toLowerCase())) issues.push({ stepId: step.id, level: "error", message: `Unknown reference ${reference[0]}.` });
    }
  });

  const entry = document.steps.find((step) => step.id === document.entryStepId) ?? document.steps[0];
  if (entry) {
    const reachable = reachableAliases(entry.alias, document.steps);
    document.steps.forEach((step) => {
      if (!reachable.has(step.alias)) {
        issues.push({
          stepId: step.id,
          level: "warning",
          message: `This step is outside the main path from ${entry.alias}. Connect it or make it the new start.`,
        });
      }
    });
  }
  return issues;
}

export function createStep(alias: string, template: "ai" | "compare" | "decision" | "loop" = "ai"): WorkflowStep {
  const base: WorkflowStep = {
    id: crypto.randomUUID(), alias, title: "New AI task", color: colorForAlias(alias), route: "openai", prompt: "",
    costUsd: "", latency: "", tokens: "", iterations: "", outputs: ["@text"], passthrough: [], attachments: [], artifacts: [],
    flow: emptyFlow(),
  };
  if (template === "compare") return { ...base, title: "Compare model answers", route: "(openai + claude).best", prompt: "Compare several model answers and return the strongest result." };
  if (template === "decision") return { ...base, title: "Review and choose a path", route: "openai.fast", prompt: "Review the previous result. Return score = <number> and reason = <short explanation>.", flow: { ...emptyFlow(), kind: "condition", variable: "score", operator: ">=", value: "8" } };
  if (template === "loop") return { ...base, title: "Review and improve", route: "claude.max", prompt: "Review the current result and improve it for the next iteration.", iterations: "3", flow: { ...emptyFlow(), kind: "chain", chain: [alias] } };
  return base;
}

export function emptyFlow(): StepFlow {
  return { kind: "none", targets: [], variable: "result", operator: "==", value: "true", trueTarget: "", falseTarget: "done", chain: [] };
}

export function nextAlias(steps: WorkflowStep[]): string {
  const max = steps.reduce((value, step) => Math.max(value, Number(step.alias.slice(1)) || 0), 0);
  return `c${max + 1}`;
}

export function connectStep(step: WorkflowStep, targetAlias: string): WorkflowStep {
  if (!targetAlias || targetAlias === step.alias) return step;
  if (step.flow.kind === "condition") {
    return {
      ...step,
      flow: step.flow.trueTarget
        ? { ...step.flow, falseTarget: targetAlias }
        : { ...step.flow, trueTarget: targetAlias },
    };
  }
  return {
    ...step,
    flow: { ...step.flow, kind: "forward", targets: [...new Set([...step.flow.targets, targetAlias])] },
  };
}

function parseCell(alias: string, block: string, index: number): WorkflowStep {
  const lines = block.replace(/^\s*\n/, "").split(/\r?\n/);
  const header: string[] = [];
  let promptStart = 0;
  let headerStarted = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line && !headerStarted) continue;
    if (serviceLine.test(line)) { header.push(line); headerStarted = true; promptStart = i + 1; continue; }
    if (!line && headerStarted) { promptStart = i + 1; break; }
    promptStart = i; break;
  }

  const route = header.find((line) => line.startsWith(">"))?.slice(1).trim() ?? "";
  const costUsd = matchValue(header, /^<\s*(?:cost\s*<=\s*)?\$([0-9]+(?:\.[0-9]+)?)/i);
  const latency = matchValue(header, /^<\s*(?:latency\s*<=\s*)?([0-9]+\s*(?:ms|s|m|h))/i).replace(/\s/g, "");
  const tokens = matchValue(header, /^<\s*(?:tokens\s*<=\s*)?([0-9]+)\s*(?:tok(?:ens)?)?/i);
  const iterations = matchValue(header, /^<\s*iterations\s*<=\s*([0-9]+)/i);
  const forward = header.map((line) => line.match(/^@forward!?(?:\s+)(c[0-9]+)/i)?.[1].toLowerCase()).filter(Boolean) as string[];
  const condition = header.map((line) => line.match(/^@if\s+(\S+)\s*(>=|<=|==|!=|>|<)\s*(\S+)\s*->\s*(c[0-9]+|done|stop)/i)).find(Boolean);
  const elseTarget = header.map((line) => line.match(/^@else\s*->\s*(c[0-9]+|done|stop)/i)?.[1].toLowerCase()).find(Boolean) ?? "done";
  const chain = header.map((line) => line.match(/^@chain\s+(.+)/i)?.[1]).find(Boolean)?.split(">").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
  const flow = emptyFlow();
  if (condition) Object.assign(flow, { kind: "condition", variable: condition[1], operator: condition[2] as ConditionOperator, value: condition[3], trueTarget: condition[4].toLowerCase(), falseTarget: elseTarget });
  else if (chain.length) Object.assign(flow, { kind: "chain", chain });
  else if (forward.length) Object.assign(flow, { kind: "forward", targets: forward });

  return {
    id: `imported-${alias}-${index}`, alias, title: humanizeAlias(alias), route,
    prompt: lines.slice(promptStart).join("\n").trim(), costUsd, latency, tokens, iterations, flow,
    outputs: header.filter((line) => outputLine.test(line)),
    passthrough: header.filter((line) => !line.startsWith(">") && !line.startsWith("<") && !flowLine.test(line) && !outputLine.test(line)),
    attachments: [],
    artifacts: [],
  };
}

function flowTargets(flow: StepFlow): string[] {
  if (flow.kind === "forward") return flow.targets;
  if (flow.kind === "condition") return [flow.trueTarget, flow.falseTarget].filter(Boolean);
  if (flow.kind === "chain") return flow.chain;
  return [];
}

function reachableAliases(entryAlias: string, steps: WorkflowStep[]): Set<string> {
  const byAlias = new Map(steps.map((step) => [step.alias, step]));
  const reachable = new Set<string>();
  const queue = [entryAlias];
  while (queue.length) {
    const alias = queue.shift()!;
    if (reachable.has(alias)) continue;
    reachable.add(alias);
    const step = byAlias.get(alias);
    if (!step) continue;
    flowTargets(step.flow).forEach((target) => {
      if (target !== "done" && target !== "stop" && byAlias.has(target) && !reachable.has(target)) queue.push(target);
    });
  }
  return reachable;
}

function autoLayout(steps: WorkflowStep[]): WorkflowDocument["positions"] {
  return Object.fromEntries(steps.map((step, index) => [step.id, { x: 80 + (index % 3) * 350, y: 90 + Math.floor(index / 3) * 240 }]));
}

function matchValue(lines: string[], pattern: RegExp): string {
  return lines.map((line) => line.match(pattern)?.[1]).find((value) => value !== undefined) ?? "";
}

function validNumber(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
}

function hasRepeatedAlias(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function humanizeAlias(alias: string): string {
  return `AI step ${alias.slice(1)}`;
}

function colorForAlias(alias: string): StepColor {
  const palette: StepColor[] = ["red", "ochre", "blue", "green", "purple", "gray"];
  return palette[(Number(alias.slice(1)) - 1) % palette.length] ?? "ink";
}

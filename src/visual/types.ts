export type FlowKind = "none" | "forward" | "condition" | "chain";
export type ConditionOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";
export type StepColor = "ink" | "red" | "green" | "blue" | "ochre" | "purple" | "gray";

export interface WorkflowFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  encoding: "text" | "base64";
  content: string;
  createdAt: string;
}

export interface StepFlow {
  kind: FlowKind;
  targets: string[];
  variable: string;
  operator: ConditionOperator;
  value: string;
  trueTarget: string;
  falseTarget: string;
  chain: string[];
}

export interface WorkflowStep {
  id: string;
  alias: string;
  title: string;
  color?: StepColor;
  route: string;
  prompt: string;
  costUsd: string;
  latency: string;
  tokens: string;
  iterations: string;
  flow: StepFlow;
  outputs: string[];
  passthrough: string[];
  attachments: WorkflowFile[];
  artifacts: WorkflowFile[];
}

export interface WorkflowDocument {
  title: string;
  dslVersion: "1.04";
  steps: WorkflowStep[];
  positions: Record<string, { x: number; y: number }>;
  entryStepId?: string;
}

export interface ValidationIssue {
  stepId?: string;
  level: "error" | "warning";
  message: string;
}

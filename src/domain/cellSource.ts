export interface SplitCellSource {
  controlHeader: string;
  promptBody: string;
}

export type ServiceLineClass = "route" | "constraint" | "directive" | "escaped" | "body";

export function combineCellSource(controlHeader: string, promptBody: string): string {
  const header = controlHeader.trimEnd();
  if (!header) return promptBody;
  if (!promptBody) return header;
  return `${header}\n${promptBody}`;
}

export function splitUnifiedCellSource(source: string): SplitCellSource {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const headerEndLine = getLeadingHeaderEndLine(normalized);

  if (headerEndLine === 0) {
    return {
      controlHeader: "",
      promptBody: normalized,
    };
  }

  return {
    controlHeader: lines.slice(0, headerEndLine).join("\n").trimEnd(),
    promptBody: lines.slice(headerEndLine).join("\n"),
  };
}

export function getLeadingHeaderEndLine(source: string): number {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let endLine = 0;

  for (const line of lines) {
    if (!line.trim() || !isServiceLine(line)) break;
    endLine += 1;
  }

  return endLine;
}

export function serviceLineClass(line: string): ServiceLineClass {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(">")) return "route";
  if (trimmed.startsWith("<")) return "constraint";
  if (knownDirectiveLine(trimmed) || directiveDraftLine(trimmed)) return "directive";
  if (escapedServiceLine(trimmed)) return "escaped";
  return "body";
}

function isServiceLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith(">") ||
    trimmed.startsWith("<") ||
    knownDirectiveLine(trimmed) ||
    directiveDraftLine(trimmed) ||
    escapedServiceLine(trimmed)
  );
}

function knownDirectiveLine(trimmed: string): boolean {
  return /^@(file|image|text|if|else|chain|use|call|input)\b/.test(trimmed) || /^@forward!?(?:\s|$)/.test(trimmed);
}

function directiveDraftLine(trimmed: string): boolean {
  const command = trimmed.match(/^@([a-zA-Z!]*)$/)?.[1].toLowerCase();
  if (command === undefined) return false;
  const knownCommands = ["file", "image", "text", "forward", "forward!", "if", "else", "chain", "use", "call", "input"];
  return command === "" || knownCommands.some((knownCommand) => knownCommand.startsWith(command));
}

function escapedServiceLine(trimmed: string): boolean {
  return /^\\[><@]/.test(trimmed);
}

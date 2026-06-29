import { describe, expect, it } from "vitest";
import { parseCellDsl } from "../language/latest";
import { splitUnifiedCellSource } from "./cellSource";

const requiredExamples = [
  "multi_model_hypothesis.icc",
  "contract_review_with_notes.icc",
  "code_generation_to_files.icc",
  "hft_strategy_branching.icc",
  "image_and_markdown_artifacts.icc",
];
const exampleModules = import.meta.glob("../../examples/*.icc", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const providerAliases = [
  {
    id: "openai",
    alias: "openai",
    label: "OpenAI",
    provider: "openai",
    models: ["gpt-4o", "gpt-4.1", "gpt-image-1"],
  },
  {
    id: "anthropic",
    alias: "claude",
    label: "Claude",
    provider: "anthropic",
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
  },
  {
    id: "provider_openrouter",
    alias: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    models: ["openrouter/auto", "openai/gpt-image-1", "openai/gpt-4o", "anthropic/claude-sonnet-4.5"],
  },
];

describe("release example notebooks", () => {
  it("ships every required public example notebook", () => {
    const available = Object.keys(exampleModules)
      .map((file) => file.split("/").pop() ?? "")
      .filter(Boolean)
      .sort();

    expect(available).toEqual([...requiredExamples].sort());
  });

  it.each(requiredExamples)("%s parses with the current ICC DSL", (fileName) => {
    const source = exampleModules[`../../examples/${fileName}`];
    const cells = parsePlainIccNotebook(source);
    const knownAliases = cells.map((cell) => cell.alias);

    expect(cells.length).toBeGreaterThanOrEqual(2);

    for (const cell of cells) {
      const split = splitUnifiedCellSource(cell.source.trim());
      const parsed = parseCellDsl(split.controlHeader, split.promptBody, {
        knownAliases,
        providerAliases,
        defaultLoopIterations: 3,
        maxLoopIterations: 10,
        cells: knownAliases.map((alias) => ({ alias, vars: {}, artifacts: [] })),
      });
      const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.level === "error");

      expect(errors, `${fileName} ${cell.alias}: ${errors.map((error) => error.message).join("; ")}`).toEqual([]);
    }
  });
});

function parsePlainIccNotebook(source: string): Array<{ alias: string; source: string }> {
  const cells: Array<{ alias: string; source: string }> = [];
  let current: { alias: string; lines: string[] } | undefined;

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^#\s+(c\d+)\s*$/);
    if (heading) {
      if (current) cells.push({ alias: current.alias, source: current.lines.join("\n").trim() });
      current = { alias: heading[1], lines: [] };
      continue;
    }
    current?.lines.push(line);
  }

  if (current) cells.push({ alias: current.alias, source: current.lines.join("\n").trim() });
  return cells;
}

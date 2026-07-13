import { describe, expect, it } from "vitest";
import type { NotebookCell } from "./types";
import {
  hasShareableOutput,
  isResultSectionDividerLine,
  resultOutputFilename,
  resultSectionDivider,
  resultSharePayload,
} from "./resultOutput";

function cell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "cell_1",
    kind: "intent",
    alias: "c1",
    title: "Review / Final Spec",
    controlHeader: "> openai.max",
    promptBody: "Write a final version.",
    output: "Final answer",
    status: "completed",
    viewMode: "expanded",
    collapsedPrompt: false,
    collapsedOutput: false,
    vars: {},
    attachments: [],
    artifacts: [],
    runHistory: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("result output actions", () => {
  it("uses stable readable filenames for saved cell output", () => {
    expect(resultOutputFilename(cell())).toBe("c1_review_final_spec_result.txt");
  });

  it("does not expose blank output as shareable", () => {
    expect(hasShareableOutput(cell({ output: "   \n\t" }))).toBe(false);
  });

  it("builds a share payload from the cell title and full output", () => {
    const payload = resultSharePayload(cell({ output: "Long answer\nwith lines" }));

    expect(payload).toEqual({
      title: "c1: Review / Final Spec",
      text: "Long answer\nwith lines",
    });
  });

  it("formats explicit section dividers for multi-provider output", () => {
    expect(resultSectionDivider("OpenAI / gpt-4o")).toBe("// --- OpenAI / gpt-4o ---");
  });

  it("recognizes only complete result section divider lines", () => {
    expect(isResultSectionDividerLine("// --- OpenAI / gpt-4o ---")).toBe(true);
    expect(isResultSectionDividerLine("  // --- xAI / grok-4 ---  ")).toBe(true);
    expect(isResultSectionDividerLine("// TODO: normal code comment")).toBe(false);
    expect(isResultSectionDividerLine("// --- missing close")).toBe(false);
  });
});

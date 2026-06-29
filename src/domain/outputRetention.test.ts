import { describe, expect, it } from "vitest";
import { clearVisibleCellOutput } from "./outputRetention";
import type { Artifact, NotebookCell, RunRecord } from "./types";

const timestamp = "2026-06-24T00:00:00.000Z";

function artifact(): Artifact {
  return {
    id: "artifact_1",
    cellId: "cell_1",
    cellAlias: "c1",
    runId: "run_1",
    displayName: "output_01.png",
    extension: ".png",
    mimeType: "image/png",
    version: 1,
    storageKey: "artifacts/c1/output_01.png",
    sizeBytes: 42,
    content: "base64",
    status: "created",
    createdAt: timestamp,
    metadata: {
      autoNamed: true,
      channel: "image",
      formatId: "png",
      source: "llm_output",
    },
  };
}

function runRecord(): RunRecord {
  return {
    id: "run_1",
    startedAt: timestamp,
    finishedAt: timestamp,
    status: "completed",
    costUsd: 0,
    latencyMs: 25,
    tokensIn: 10,
    tokensOut: 20,
    summary: "Old text output",
    providerRuns: [{ provider: "OpenAI", model: "gpt-5.5", status: "completed" }],
    inputResolved: "",
    textOutputRaw: "Old model answer",
    textOutputVisible: "Old model answer",
    vars: { score: 1 },
    artifacts: [artifact()],
    executionPlan: ["route: openai"],
    errors: [],
  };
}

function cell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  const run = runRecord();
  return {
    id: "cell_1",
    kind: "intent",
    alias: "c1",
    title: "Generate files",
    controlHeader: "> openai\n@image -png output_{01..02}.png",
    promptBody: "Generate images.",
    output: "Old model answer",
    status: "completed",
    viewMode: "expanded",
    collapsedPrompt: false,
    collapsedOutput: false,
    vars: { score: 1 },
    attachments: [],
    artifacts: [artifact()],
    lastRun: run,
    runHistory: [run],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("output retention", () => {
  it("clears text output while preserving generated artifacts", () => {
    const cleared = clearVisibleCellOutput(cell(), "2026-06-24T01:00:00.000Z");

    expect(cleared.output).toBe("");
    expect(cleared.vars).toEqual({});
    expect(cleared.status).toBe("completed");
    expect(cleared.artifacts).toHaveLength(1);
    expect(cleared.artifacts[0].displayName).toBe("output_01.png");
    expect(cleared.lastRun?.textOutputRaw).toBe("");
    expect(cleared.lastRun?.textOutputVisible).toBe("");
    expect(cleared.lastRun?.artifacts).toHaveLength(1);
    expect(cleared.lastRun?.artifacts[0].displayName).toBe("output_01.png");
    expect(cleared.runHistory[0].textOutputRaw).toBe("");
    expect(cleared.runHistory[0].artifacts).toHaveLength(1);
  });

  it("returns a text-only cell to not-run state when there are no artifacts to retain", () => {
    const cleared = clearVisibleCellOutput(cell({ artifacts: [] }), "2026-06-24T01:00:00.000Z");

    expect(cleared.output).toBe("");
    expect(cleared.status).toBe("not_run");
    expect(cleared.lastRun).toBeUndefined();
    expect(cleared.runHistory[0].textOutputRaw).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { parseCellDsl } from "../language/latest";
import { createInitialWorkspace } from "./fixtures";
import { buildProviderPrompt, createCellRunResult, simulateCellRun } from "./runtime";

describe("runtime simulation", () => {
  it("does not present a resolved %from prompt as the provider output", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = notebook.cells[1];
    const sourceOutput = "Source cell output that should become input, not the final answer.";
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings, {
      inputResolved: "%from c1",
      resolvedPromptBody: `Analyze this prior result:\n${sourceOutput}\n\nReturn a critique.`,
    });

    expect(result.run.inputResolved).toBe("%from c1");
    expect(result.run.textOutputRaw).not.toContain("Simulated provider run.");
    expect(result.run.textOutputRaw).toContain("pnl = -15.2");
    expect(result.output).toContain("Simulated provider run.");
    expect(result.run.textOutputRaw).not.toBe(sourceOutput);
    expect(result.output).not.toBe(sourceOutput);
  });

  it("explains that linked keys are not used by the simulator", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = notebook.cells[0];
    workspace.settings.providers[0].apiKeyMasked = "sk-proj-...y7kA";
    const parsed = parseCellDsl("> openai.max", "Find a candidate.", {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(result.output).toContain("Linked key detected for this route");
    expect(result.output).toContain("provider execution adapters are not enabled yet");
    expect(result.output).toContain("Resolved route: OpenAI / gpt-5.5");
  });

  it("creates multiple formatted artifacts without clipping text output", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      title: "Strategy package",
      controlHeader: "> openai\n@file -markdown report\n@file -json config.json\n@text <40",
      promptBody: "Create a JSON config and a report.",
      artifacts: [],
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(result.status).toBe("completed");
    expect(result.artifacts.map((artifact) => artifact.displayName)).toEqual(["report.md", "config.json"]);
    expect(result.artifacts.map((artifact) => artifact.metadata.formatId)).toEqual(["markdown", "json"]);
    expect(result.output).toContain('"strategy": "latency_sensitive_mean_reversion"');
    expect(result.output).not.toContain("Preview:");
    expect(result.output).toContain("Created:");
  });

  it("adds named artifact contracts to provider prompts for range-expanded outputs", () => {
    const parsed = parseCellDsl("@file -markdown output_{01..03}.md", "Create files.", {
      knownAliases: ["c1"],
      defaultLoopIterations: 3,
      maxLoopIterations: 10,
    });

    const prompt = buildProviderPrompt("Create files.", parsed);

    expect(prompt).toContain("Required artifact: output_01.md");
    expect(prompt).toContain("Required artifact: output_02.md");
    expect(prompt).toContain("Required artifact: output_03.md");
    expect(prompt).toContain("--- file: <filename> ---");
  });

  it("keeps file range declarations authoritative when prose asks for a different count", () => {
    const parsed = parseCellDsl("@file -markdown report_{01..03}.md", "Create exactly two markdown files.", {
      knownAliases: ["c1"],
      defaultLoopIterations: 3,
      maxLoopIterations: 10,
    });

    const prompt = buildProviderPrompt("Create exactly two markdown files.", parsed);

    expect(prompt).toContain("Create exactly two markdown files.");
    expect(prompt.match(/Required artifact: report_/g)).toHaveLength(3);
    expect(prompt).toContain("Required artifact: report_01.md");
    expect(prompt).toContain("Required artifact: report_02.md");
    expect(prompt).toContain("Required artifact: report_03.md");
  });

  it("passes sender notes as guidance instead of source text", () => {
    const parsed = {
      ...parseCellDsl("> claude.max", "Rewrite the abstract.", {
        knownAliases: ["c1"],
        defaultLoopIterations: 3,
        maxLoopIterations: 10,
      }),
      bodySegments: [
        { type: "source_text" as const, text: "Rewrite the abstract.\n" },
        { type: "sender_note" as const, text: "Preserve citations and do not quote this note." },
      ],
      senderNotes: ["Preserve citations and do not quote this note."],
    };

    const prompt = buildProviderPrompt("Rewrite the abstract.\n/* Preserve citations and do not quote this note. */", parsed);

    expect(prompt).toContain("sender notes are user comments");
    expect(prompt).toContain("Source text:\nRewrite the abstract.");
    expect(prompt).toContain("Sender notes:\n1. Preserve citations and do not quote this note.");
    expect(prompt).not.toContain("/* Preserve citations");
  });

  it("extracts named artifact sections from provider output", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      title: "Batch output",
      controlHeader: "> openai\n@file -markdown output_{01..02}.md",
      promptBody: "Create two files.",
      artifacts: [],
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = createCellRunResult(
      cell,
      parsed,
      workspace.settings,
      {},
      ["--- file: output_01.md ---", "First file.", "--- file: output_02.md ---", "Second file."].join("\n"),
    );

    expect(result.artifacts.map((artifact) => artifact.displayName)).toEqual(["output_01.md", "output_02.md"]);
    expect(result.artifacts.map((artifact) => artifact.content)).toEqual(["First file.", "Second file."]);
  });

  it("does not fabricate named artifacts from visible output when sections are missing", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      title: "Batch output",
      controlHeader: "> openai\n@file -markdown output_01.md",
      promptBody: "Create one file.",
      artifacts: [],
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = createCellRunResult(cell, parsed, workspace.settings, {}, "Visible answer only.");

    expect(result.status).toBe("artifact_error");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      displayName: "output_01.md",
      status: "failed",
      content: "",
    });
    expect(result.errors[0]?.message).toContain("missing_artifact_section");
  });

  it("treats missing legacy artifact arrays as empty when creating outputs", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      artifacts: undefined,
      controlHeader: "> openai\n@file -markdown result.md",
      promptBody: "Create a file.",
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = createCellRunResult(
      cell as unknown as typeof notebook.cells[number],
      parsed,
      workspace.settings,
      {},
      ["--- file: result.md ---", "Created from a legacy cell."].join("\n"),
    );

    expect(result.status).toBe("completed");
    expect(result.artifacts[0].displayName).toBe("result.md");
    expect(result.artifacts[0].version).toBe(1);
  });

  it("blocks rendered and image outputs when capabilities are missing", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      controlHeader: "> openai\n@file -pdf report.pdf\n@image -png logo.png",
      promptBody: "Create a report and an image.",
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.errors.map((error) => error.code)).toEqual(["missing_renderer", "missing_image_executor"]);
    expect(result.output).toContain("PDF output requires a configured PDF renderer");
    expect(result.output).toContain("Image output is declared correctly, but image generation is not enabled in this build yet.");
  });

  it("reports a missing image executor once for range-expanded image outputs", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      controlHeader: "> openrouter.max\n@image -png output_{01..10}.png",
      promptBody: "Create ten transparent PNG variants from the attached references.",
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(parsed.outputs.images).toHaveLength(10);
    expect(result.status).toBe("config_error");
    expect(result.errors.map((error) => error.code)).toEqual(["missing_image_executor"]);
    expect(result.output.match(/Image output is declared correctly/g)).toHaveLength(1);
    expect(result.output).toContain("Requested 10 image artifacts.");
  });

  it("preflights auto file outputs against prompt intent before execution", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      controlHeader: "> openai\n@file\n@text <100",
      promptBody: "Create a polished PDF report for the selected hypothesis.",
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.errors.map((error) => error.code)).toEqual(["missing_renderer"]);
    expect(result.output).toContain("PDF output requires a configured PDF renderer");
  });

  it("blocks binary intent for auto file outputs", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0].notebooks[0];
    const cell = {
      ...notebook.cells[0],
      controlHeader: "> openai\n@file\n@text <100",
      promptBody: "Create a ZIP archive with executable app files.",
    };
    const parsed = parseCellDsl(cell.controlHeader, cell.promptBody, {
      knownAliases: notebook.cells.map((candidate) => candidate.alias),
      providerAliases: workspace.settings.providers.map((provider) => ({
        id: provider.id,
        alias: provider.alias,
        label: provider.label,
        provider: provider.provider,
      })),
      defaultLoopIterations: workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.settings.orchestration.maxLoopIterations,
    });

    const result = simulateCellRun(cell, parsed, workspace.settings);

    expect(result.status).toBe("config_error");
    expect(result.errors.map((error) => error.code)).toEqual(["binary_format_not_directly_generatable"]);
    expect(result.output).toContain("binary_format_not_directly_generatable");
  });
});

import { describe, expect, it } from "vitest";
import { createInitialWorkspace } from "./fixtures";

describe("initial workspace fixtures", () => {
  it("starts new users with a neutral multi-cell product spec example", () => {
    const workspace = createInitialWorkspace();
    const notebook = workspace.projects[0]?.notebooks[0];

    expect(notebook?.title).toBe("Product spec workflow");
    expect(notebook?.cells).toHaveLength(3);
    expect(notebook?.cells.map((cell) => cell.alias)).toEqual(["c1", "c2", "c3"]);
    expect(notebook?.cells[1]?.promptBody).toContain("%from c1");
    expect(notebook?.cells[2]?.promptBody).toContain("%from c1");
    expect(notebook?.cells[2]?.promptBody).toContain("%from c2");
    expect(notebook?.cells[2]?.controlHeader).toContain("@file -markdown final_spec.md");

    const publicExampleText = notebook?.cells.map((cell) => `${cell.title}\n${cell.controlHeader}\n${cell.promptBody}`).join("\n") ?? "";
    expect(publicExampleText).not.toMatch(/\b(HFT|Binance|USDM)\b/i);
  });
});

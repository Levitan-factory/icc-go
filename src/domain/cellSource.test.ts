import { describe, expect, it } from "vitest";
import {
  combineCellSource,
  getLeadingHeaderEndLine,
  serviceLineClass,
  splitUnifiedCellSource,
} from "./cellSource";

describe("unified cell source", () => {
  it("splits a leading service block from prompt text", () => {
    expect(
      splitUnifiedCellSource(
        "> (openai + claude).best\n< cost <= $3.33\n@forward c2\nFind a hypothesis.",
      ),
    ).toEqual({
      controlHeader: "> (openai + claude).best\n< cost <= $3.33\n@forward c2",
      promptBody: "Find a hypothesis.",
    });
  });

  it("keeps later service-looking lines in the prompt body", () => {
    expect(splitUnifiedCellSource("Write code\n@text <300\n> openai")).toEqual({
      controlHeader: "",
      promptBody: "Write code\n@text <300\n> openai",
    });
  });

  it("ends the header at the first blank boundary", () => {
    expect(splitUnifiedCellSource("> openai\n\n@text <300\nBody")).toEqual({
      controlHeader: "> openai",
      promptBody: "\n@text <300\nBody",
    });
  });

  it("combines stored header and body into the unified editor text", () => {
    expect(combineCellSource("> openai", "Body")).toBe("> openai\nBody");
    expect(combineCellSource("> openai", "\nBody")).toBe("> openai\n\nBody");
  });

  it("classifies service line colors", () => {
    expect(getLeadingHeaderEndLine("> openai\n< 3m\n@\n@fo\n@text\n@forward! c2\nBody")).toBe(6);
    expect(serviceLineClass("> openai")).toBe("route");
    expect(serviceLineClass("< 3m")).toBe("constraint");
    expect(serviceLineClass("@")).toBe("directive");
    expect(serviceLineClass("@fo")).toBe("directive");
    expect(serviceLineClass("@text")).toBe("directive");
    expect(serviceLineClass("@forward! c2")).toBe("directive");
  });

  it("does not treat unknown @ words as header directives", () => {
    expect(getLeadingHeaderEndLine("> openai\n@anyword\nBody")).toBe(1);
    expect(serviceLineClass("@anyword")).toBe("body");
    expect(splitUnifiedCellSource("> openai\n@anyword\nBody")).toEqual({
      controlHeader: "> openai",
      promptBody: "@anyword\nBody",
    });
  });

  it("treats escaped service lines as one-line disabled header lines", () => {
    for (const escapedLine of ["\\> disabled route", "\\< disabled constraint", "\\@text <1000"]) {
      const source = ["> openai.max", escapedLine, "< tokens <= 50000", "@forward c2", "Body"].join("\n");

      expect(serviceLineClass(escapedLine)).toBe("escaped");
      expect(getLeadingHeaderEndLine(source)).toBe(4);
      expect(splitUnifiedCellSource(source)).toEqual({
        controlHeader: ["> openai.max", escapedLine, "< tokens <= 50000", "@forward c2"].join("\n"),
        promptBody: "Body",
      });
    }
  });
});

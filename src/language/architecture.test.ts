import { describe, expect, it } from "vitest";

const sourceModules = import.meta.glob("../**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const notebookLanguageConsumers = [
  "src/App.tsx",
  "src/store/useWorkspace.ts",
  "src/components/CellBlock.tsx",
  "src/domain/notebookExport.ts",
];

describe("language architecture", () => {
  it("keeps notebook consumers pinned to the latest language adapter", () => {
    notebookLanguageConsumers.forEach((file) => {
      const source = getSource(file);
      expect(source, `${file} should import the latest language adapter`).toContain("language/latest");
      expect(source, `${file} must not import old domain DSL modules`).not.toContain("domain/dsl");
      expect(source, `${file} must not import a concrete language version`).not.toMatch(/language\/v[0-9_]+/);
    });
  });

  it("prevents non-language code from importing concrete language versions", () => {
    const violations = Object.entries(sourceModules)
      .filter(([path]) => !toSourcePath(path).startsWith("src/language/"))
      .filter(([, source]) => /language\/v[0-9_]+/.test(source))
      .map(([path]) => toSourcePath(path));

    expect(violations).toEqual([]);
  });
});

function getSource(sourcePath: string): string {
  const found = Object.entries(sourceModules).find(([path]) => toSourcePath(path) === sourcePath);
  if (!found) throw new Error(`Source file not found: ${sourcePath}`);
  return found[1];
}

function toSourcePath(globPath: string): string {
  return globPath.replace(/^\.\.\//, "src/");
}

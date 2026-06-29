import overview from "../../docs/README.md?raw";
import intentCellCoding from "../../docs/articles/intent-cell-coding.md?raw";
import workspaceReference from "../../docs/reference/workspace.md?raw";
import artifactExample from "../../docs/examples/artifacts.md?raw";
import basicCellExample from "../../docs/examples/basic-cell.md?raw";
import branchingExample from "../../docs/examples/branching.md?raw";
import textBlocksExample from "../../docs/examples/text-blocks.md?raw";

export type DocumentationSection = "Overview" | "Articles" | "Reference" | "Examples";
export type DocumentationPageKind = "markdown" | "dsl-catalog" | "dsl-index";

export interface DocumentationPage {
  id: string;
  section: DocumentationSection;
  title: string;
  description: string;
  kind: DocumentationPageKind;
  content?: string;
}

export const defaultDocumentationPageId = "overview";

export const documentationPages: DocumentationPage[] = [
  {
    id: "overview",
    section: "Overview",
    title: "Documentation Home",
    description: "Start here for the structure of ICC-GO documentation.",
    kind: "markdown",
    content: overview,
  },
  {
    id: "intent-cell-coding",
    section: "Articles",
    title: "Intent-Cell Coding",
    description: "The approach behind ICC-GO and the role of intent cells.",
    kind: "markdown",
    content: intentCellCoding,
  },
  {
    id: "language-reference",
    section: "Reference",
    title: "ICC DSL Wiki",
    description: "Generated ICC catalog with groups, support status, examples, and parser coverage.",
    kind: "dsl-catalog",
  },
  {
    id: "alphabetical-index",
    section: "Reference",
    title: "Alphabetical Index",
    description: "A-Z index of ICC operators, functions, references, statuses, and planned items.",
    kind: "dsl-index",
  },
  {
    id: "workspace-reference",
    section: "Reference",
    title: "Workspace Reference",
    description: "Menus, shortcuts, exports, settings, and notebook controls.",
    kind: "markdown",
    content: workspaceReference,
  },
  {
    id: "example-basic-cell",
    section: "Examples",
    title: "Basic Intent Cell",
    description: "A minimal executable cell with routing, limits, and a readable prompt.",
    kind: "markdown",
    content: basicCellExample,
  },
  {
    id: "example-branching",
    section: "Examples",
    title: "Branching Workflow",
    description: "A deterministic branch pattern using parsed variables.",
    kind: "markdown",
    content: branchingExample,
  },
  {
    id: "example-artifacts",
    section: "Examples",
    title: "Artifact Output",
    description: "Generate durable files and reuse them in later cells.",
    kind: "markdown",
    content: artifactExample,
  },
  {
    id: "example-text-blocks",
    section: "Examples",
    title: "Text Blocks",
    description: "Use narrative markdown between executable cells without affecting runs.",
    kind: "markdown",
    content: textBlocksExample,
  },
];

export const documentationSections: DocumentationSection[] = ["Overview", "Articles", "Reference", "Examples"];

export function findDocumentationPage(pageId?: string): DocumentationPage {
  return documentationPages.find((page) => page.id === pageId) ?? documentationPages[0];
}

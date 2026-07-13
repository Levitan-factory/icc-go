import type { Notebook, NotebookCell } from "../domain/types";

interface CodeSurfaceProps {
  notebook: Notebook;
}

export function CodeSurface({ notebook }: CodeSurfaceProps) {
  const source = notebook.cells.map(renderCell).join("\n\n---\n\n");

  return (
    <section className="code-surface" aria-label="ICC Code view">
      <div className="code-surface-header">
        <span>ICC Code</span>
        <strong>{notebook.metadata.dsl_version_label}</strong>
      </div>
      <pre>
        <code>{source || "# Empty notebook"}</code>
      </pre>
    </section>
  );
}

function renderCell(cell: NotebookCell): string {
  if (cell.kind === "text") {
    return [`# ${cell.title}`, "", cell.noteBody ?? ""].join("\n").trim();
  }

  return [
    `# ${cell.alias} ${cell.title}`.trim(),
    cell.controlHeader.trim(),
    "",
    cell.promptBody.trim(),
  ]
    .filter((part, index) => index === 2 || part.length > 0)
    .join("\n")
    .trim();
}

import type { Notebook, NotebookCell, WorkspaceSettings } from "../domain/types";
import { CellBlock } from "./CellBlock";
import { TextBlock } from "./TextBlock";

interface NotebookCanvasProps {
  notebook: Notebook;
  settings: WorkspaceSettings;
  selectedCellId?: string;
  runningCellIds: Set<string>;
  onSelectCell: (cellId: string) => void;
  onUpdateCell: (cellId: string, patch: Partial<NotebookCell>) => void;
  onAddCell: (afterCellId?: string) => void;
  onAddTextCell: (afterCellId?: string) => void;
  onRunCell: (cellId: string) => void;
  onRunFromHere: (cellId: string) => void;
  onStopCell: (cellId: string) => void;
  onAttachFiles: (cellId: string, files: File[] | FileList) => void;
  onRemoveAttachment: (cellId: string, attachmentId: string) => void;
  onDuplicateCell: (cellId: string) => void;
  onDeleteCell: (cellId: string) => void;
  onMoveCell: (cellId: string, direction: "up" | "down") => void;
  onOpenArtifact: (artifactId: string) => void;
}

export function NotebookCanvas({
  notebook,
  settings,
  selectedCellId,
  runningCellIds,
  onSelectCell,
  onUpdateCell,
  onAddCell,
  onAddTextCell,
  onRunCell,
  onRunFromHere,
  onStopCell,
  onAttachFiles,
  onRemoveAttachment,
  onDuplicateCell,
  onDeleteCell,
  onMoveCell,
  onOpenArtifact,
}: NotebookCanvasProps) {
  const aliases = notebook.cells.filter((cell) => cell.kind !== "text").map((cell) => cell.alias);

  return (
    <section className="notebook-canvas">
      {notebook.cells.map((cell, index) =>
        cell.kind === "text" ? (
          <TextBlock
            key={cell.id}
            cell={cell}
            selected={cell.id === selectedCellId}
            isFirst={index === 0}
            isLast={index === notebook.cells.length - 1}
            onSelect={() => onSelectCell(cell.id)}
            onUpdate={(patch) => onUpdateCell(cell.id, patch)}
            onAddAfter={() => onAddCell(cell.id)}
            onAddTextAfter={() => onAddTextCell(cell.id)}
            onDuplicate={() => onDuplicateCell(cell.id)}
            onDelete={() => onDeleteCell(cell.id)}
            onMove={(direction) => onMoveCell(cell.id, direction)}
          />
        ) : (
          <CellBlock
            key={cell.id}
            cell={cell}
            cells={notebook.cells}
            knownAliases={aliases}
            settings={settings}
            selected={cell.id === selectedCellId}
            running={runningCellIds.has(cell.id)}
            isFirst={index === 0}
            isLast={index === notebook.cells.length - 1}
            onSelect={() => onSelectCell(cell.id)}
            onUpdate={(patch) => onUpdateCell(cell.id, patch)}
            onAddAfter={() => onAddCell(cell.id)}
            onAddTextAfter={() => onAddTextCell(cell.id)}
            onRun={() => onRunCell(cell.id)}
            onRunFromHere={() => onRunFromHere(cell.id)}
            onStop={() => onStopCell(cell.id)}
            onAttachFiles={(files) => onAttachFiles(cell.id, files)}
            onRemoveAttachment={(attachmentId) => onRemoveAttachment(cell.id, attachmentId)}
            onDuplicate={() => onDuplicateCell(cell.id)}
            onDelete={() => onDeleteCell(cell.id)}
            onMove={(direction) => onMoveCell(cell.id, direction)}
            onOpenArtifact={onOpenArtifact}
          />
        ),
      )}
    </section>
  );
}

import { ArrowDown, ArrowUp, Copy, Edit3, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NotebookCell } from "../domain/types";
import { MarkdownView } from "./MarkdownView";

interface TextBlockProps {
  cell: NotebookCell;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<NotebookCell>) => void;
  onAddAfter: () => void;
  onAddTextAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}

export function TextBlock({
  cell,
  selected,
  isFirst,
  isLast,
  onSelect,
  onUpdate,
  onAddAfter,
  onAddTextAfter,
  onDuplicate,
  onDelete,
  onMove,
}: TextBlockProps) {
  const [editing, setEditing] = useState(() => !cell.noteBody?.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (selected && !cell.noteBody?.trim()) setEditing(true);
  }, [cell.noteBody, selected]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  return (
    <article
      id={`cell-${cell.id}`}
      className={`text-block ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={() => setEditing(true)}
    >
      <div className="text-block-actions">
        <button type="button" onClick={() => setEditing(true)} title="Edit text">
          <Edit3 size={14} />
        </button>
        <button type="button" onClick={onDuplicate} title="Duplicate text">
          <Copy size={14} />
        </button>
        <button type="button" onClick={() => onMove("up")} disabled={isFirst} title="Move up">
          <ArrowUp size={14} />
        </button>
        <button type="button" onClick={() => onMove("down")} disabled={isLast} title="Move down">
          <ArrowDown size={14} />
        </button>
        <button type="button" onClick={onDelete} title="Delete text">
          <Trash2 size={14} />
        </button>
      </div>

      {editing ? (
        <textarea
          ref={textareaRef}
          className="text-block-editor"
          value={cell.noteBody ?? ""}
          onChange={(event) => onUpdate({ noteBody: event.target.value })}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => {
            if (cell.noteBody?.trim()) setEditing(false);
          }}
          placeholder={"## Section title\n\nWrite context, notes, hypotheses, links, or instructions between intent cells."}
        />
      ) : (
        <MarkdownView className="text-block-preview" emptyText="Empty text block." markdown={cell.noteBody ?? ""} />
      )}

      <div className="insert-cell-controls" aria-label="Insert after text">
        <button type="button" onClick={onAddAfter} aria-label="Add intent cell after text" title="Add intent cell">
          <Plus size={14} />
        </button>
        <button type="button" onClick={onAddTextAfter} aria-label="Add text block after text" title="Add text block">
          <Type size={14} />
        </button>
      </div>
    </article>
  );
}

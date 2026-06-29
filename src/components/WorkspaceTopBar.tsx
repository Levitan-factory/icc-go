import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  FileDown,
  Play,
  Redo2,
  Save,
  Search,
  Settings,
  Undo2,
} from "lucide-react";
import type { CellViewMode, Notebook, SaveStatus } from "../domain/types";
import { ICC_GO_RELEASE_LABEL, SUPPORTED_ICC_DSL_VERSION_LABEL } from "../version";
import { AppLogo } from "./AppLogo";

interface WorkspaceTopBarProps {
  notebook?: Notebook;
  saveStatus: SaveStatus;
  lastSavedAt?: string;
  canUndo: boolean;
  canRedo: boolean;
  inspectorOpen: boolean;
  onNewProject: () => void;
  onNewNotebook: () => void;
  onDuplicateNotebook: () => void;
  onDeleteNotebook: () => void;
  onSave: () => void;
  onSaveSnapshot: () => void;
  onRestoreSnapshot: (snapshotId: string) => void;
  onImportNotebook: (file: File) => void;
  onExport: (format: "json" | "md" | "zip") => void;
  onDownloadArtifacts: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddCell: () => void;
  onAddTextCell: () => void;
  onRunCurrent: () => void;
  onRunAll: () => void;
  onRunStale: () => void;
  onRunFromHere: () => void;
  onStopAll: () => void;
  onValidate: () => void;
  onEstimateCost: () => void;
  onFind: () => void;
  onCopyCurrentMarkdown: () => void;
  onCopyNotebookMarkdown: () => void;
  onClearCurrentOutput: () => void;
  onClearAllOutputs: () => void;
  onSetViewMode: (mode: CellViewMode) => void;
  onToggleInspector: () => void;
  onOpenSettings: () => void;
  onOpenDocs: (pageId?: string) => void;
}

export function WorkspaceTopBar({
  notebook,
  saveStatus,
  lastSavedAt,
  canUndo,
  canRedo,
  inspectorOpen,
  onNewProject,
  onNewNotebook,
  onDuplicateNotebook,
  onDeleteNotebook,
  onSave,
  onSaveSnapshot,
  onRestoreSnapshot,
  onImportNotebook,
  onExport,
  onDownloadArtifacts,
  onUndo,
  onRedo,
  onAddCell,
  onAddTextCell,
  onRunCurrent,
  onRunAll,
  onRunStale,
  onRunFromHere,
  onStopAll,
  onValidate,
  onEstimateCost,
  onFind,
  onCopyCurrentMarkdown,
  onCopyNotebookMarkdown,
  onClearCurrentOutput,
  onClearAllOutputs,
  onSetViewMode,
  onToggleInspector,
  onOpenSettings,
  onOpenDocs,
}: WorkspaceTopBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!topbarRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function toggleMenu(label: string) {
    setOpenMenu((current) => (current === label ? null : label));
  }

  return (
    <header className="workspace-topbar" ref={topbarRef}>
      <AppLogo className="topbar-logo" />

      <nav className="topbar-menu" aria-label="Workspace menu">
        <Menu label="File" open={openMenu === "File"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("File")}>
          <MenuButton onClick={onNewProject}>New Project</MenuButton>
          <MenuButton onClick={onNewNotebook}>New Notebook</MenuButton>
          <MenuButton onClick={onDuplicateNotebook}>Duplicate Notebook</MenuButton>
          <MenuButton onClick={onSave}>Save</MenuButton>
          <MenuButton onClick={onSaveSnapshot}>Save Snapshot</MenuButton>
          <MenuButton onClick={() => importInputRef.current?.click()}>Import Notebook</MenuButton>
          <MenuButton onClick={() => onExport("zip")}>Export Notebook</MenuButton>
          <MenuButton onClick={() => onExport("md")}>Export as Markdown</MenuButton>
          <MenuButton onClick={() => onExport("json")}>Export as JSON</MenuButton>
          <MenuButton onClick={() => onExport("zip")}>Export as ZIP</MenuButton>
          <MenuButton onClick={onDownloadArtifacts}>Download All Artifacts</MenuButton>
          <MenuButton danger onClick={onDeleteNotebook}>Delete Notebook</MenuButton>
        </Menu>
        <Menu label="Edit" open={openMenu === "Edit"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("Edit")}>
          <MenuButton disabled={!canUndo} onClick={onUndo}>Undo</MenuButton>
          <MenuButton disabled={!canRedo} onClick={onRedo}>Redo</MenuButton>
          <MenuButton onClick={onCopyCurrentMarkdown}>Copy Cell as Markdown</MenuButton>
          <MenuButton onClick={onCopyNotebookMarkdown}>Copy Notebook as Markdown</MenuButton>
          <MenuButton onClick={onClearCurrentOutput}>Clear Cell Output</MenuButton>
          <MenuButton onClick={onClearAllOutputs}>Clear All Outputs</MenuButton>
          <MenuButton onClick={onFind}>Find / Go to Cell</MenuButton>
        </Menu>
        <Menu label="Insert" open={openMenu === "Insert"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("Insert")}>
          <MenuButton onClick={onAddCell}>Intent Cell Below</MenuButton>
          <MenuButton onClick={onAddTextCell}>Text Block Below</MenuButton>
        </Menu>
        <Menu label="Run" open={openMenu === "Run"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("Run")}>
          <MenuButton onClick={onRunCurrent}>Run Current Cell</MenuButton>
          <MenuButton onClick={onRunFromHere}>Run From Here</MenuButton>
          <MenuButton onClick={onRunAll}>Run All</MenuButton>
          <MenuButton onClick={onRunStale}>Run Stale Cells</MenuButton>
          <MenuButton onClick={onStopAll}>Stop All Runs</MenuButton>
          <MenuButton onClick={onValidate}>Validate Notebook</MenuButton>
          <MenuButton onClick={onEstimateCost}>Estimate Cost</MenuButton>
        </Menu>
        <Menu label="View" open={openMenu === "View"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("View")}>
          <MenuButton onClick={() => onSetViewMode("compact")}>Compact Mode</MenuButton>
          <MenuButton onClick={() => onSetViewMode("expanded")}>Expanded Mode</MenuButton>
          <MenuButton onClick={onToggleInspector}>{inspectorOpen ? "Hide Inspector" : "Show Inspector"}</MenuButton>
        </Menu>
        <Menu label="Tools" open={openMenu === "Tools"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("Tools")}>
          <MenuButton onClick={onValidate}>Validate ICC</MenuButton>
          <MenuButton onClick={() => window.alert(syntaxCheatSheet)}>Open Syntax Cheat Sheet</MenuButton>
          <MenuButton onClick={onOpenSettings}>Settings</MenuButton>
        </Menu>
        <Menu label="Help" open={openMenu === "Help"} onClose={() => setOpenMenu(null)} onToggle={() => toggleMenu("Help")}>
          <MenuButton onClick={() => onOpenDocs("overview")}>Documentation</MenuButton>
          <MenuButton onClick={() => onOpenDocs("language-reference")}>ICC DSL Wiki</MenuButton>
          <MenuButton onClick={() => onOpenDocs("alphabetical-index")}>ICC Index</MenuButton>
          <MenuButton onClick={() => onOpenDocs("intent-cell-coding")}>Intent-Cell Coding</MenuButton>
          <MenuButton onClick={() => onOpenDocs("example-basic-cell")}>Examples</MenuButton>
          <MenuButton onClick={() => window.alert(shortcutsText)}>Keyboard Shortcuts</MenuButton>
          <MenuButton
            onClick={() =>
              window.alert(
                `${ICC_GO_RELEASE_LABEL}\n${SUPPORTED_ICC_DSL_VERSION_LABEL}\nIntent-Cell Coding workspace controls.`,
              )
            }
          >
            About ICC-GO Notebook
          </MenuButton>
        </Menu>
      </nav>

      <div className="topbar-toolbar">
        <span className={`save-status ${saveStatus}`}>
          <Check size={13} />
          {formatSaveStatus(saveStatus, lastSavedAt)}
        </span>

        <div className="topbar-actions">
          <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo">
            <Undo2 size={16} />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo">
            <Redo2 size={16} />
          </button>
          <button type="button" onClick={onRunAll} title="Run all">
            <Play size={16} />
            Run all
          </button>
          <button type="button" onClick={() => onExport("zip")} title="Export notebook">
            <Download size={16} />
            Export
          </button>
          <button type="button" onClick={onFind} title="Find">
            <Search size={16} />
          </button>
          <button type="button" onClick={onToggleInspector} title="Toggle inspector">
            <Eye size={16} />
          </button>
          <button type="button" onClick={onSave} title="Save">
            <Save size={16} />
          </button>
          <button type="button" onClick={onOpenSettings} title="Settings">
            <Settings size={16} />
          </button>
        </div>
      </div>

      <input
        ref={importInputRef}
        hidden
        accept=".iccgo.json,.json"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onImportNotebook(file);
          event.currentTarget.value = "";
        }}
      />

      {notebook?.snapshots.length ? (
        <div className="snapshot-strip">
          <FileDown size={14} />
          <span>Snapshots</span>
          {notebook.snapshots.slice(0, 3).map((snapshot) => (
            <button key={snapshot.id} type="button" onClick={() => onRestoreSnapshot(snapshot.id)}>
              {snapshot.name}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function Menu({
  label,
  children,
  open,
  onClose,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={`topbar-menu-item ${open ? "is-open" : ""}`}>
      <button
        className="topbar-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        {label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="topbar-menu-popover"
          role="menu"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("button")) {
              window.setTimeout(onClose, 0);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  children,
  danger,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={danger ? "danger" : ""}
      disabled={disabled}
      type="button"
      role="menuitem"
      onClick={() => {
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function formatSaveStatus(status: SaveStatus, lastSavedAt?: string): string {
  if (status === "saving") return "Saving...";
  if (status === "unsaved") return "Unsaved changes";
  if (status === "failed") return "Save failed";
  if (status === "offline") return "Offline / local changes";
  return lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Saved";
}

const syntaxCheatSheet = `> openai
> claude.max
> (openai + claude).best
< cost <= $3
< latency <= 3m
@forward c2
@chain c1 > c2 > c3
@if pnl > 0 -> c3
@else -> c4
@file
@file .md
@file report.md
@file -python strategy.py
@file -json config.json
@file -markdown output_{01..10}.md
@image -png logo.png
@image -png frame_{1..3}.png
@text
@text <100
%from c1
%from c2.pnl
%error.c2.message
%file.c3:strategy_code.py`;

const shortcutsText = `Cmd/Ctrl + S: Save
Cmd/Ctrl + Z: Undo
Cmd/Ctrl + Shift + Z: Redo
Cmd/Ctrl + F: Find / Go to cell
Cmd/Ctrl + Enter: Run current cell
Shift + Enter: Run cell and go next
Alt + Enter: Run cell and insert below
Cmd/Ctrl + D: Duplicate cell
Cmd/Ctrl + Backspace: Delete selected cell
Cmd/Ctrl + E: Export
Cmd/Ctrl + /: Keyboard shortcuts`;

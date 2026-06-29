import {
  FileText,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { Notebook, Project } from "../domain/types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  activeNotebookId: string;
  onSelectProject: (projectId: string) => void;
  onSelectNotebook: (notebookId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onCreateNotebook: () => void;
  onDeleteNotebook: (notebookId: string) => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeNotebookId,
  onSelectProject,
  onSelectNotebook,
  onCreateProject,
  onDeleteProject,
  onCreateNotebook,
  onDeleteNotebook,
}: SidebarProps) {
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [notebookToDelete, setNotebookToDelete] = useState<Notebook | null>(null);
  const activeProject = projects.find((project) => project.id === activeProjectId);

  return (
    <aside className="sidebar">
      <div className="sidebar-section projects-section">
        <div className="section-title">
          <span>Projects</span>
          <button type="button" onClick={onCreateProject} aria-label="New project" title="New project">
            <Plus size={14} />
          </button>
        </div>
        <div className="nav-list">
          {projects.map((project) => (
            <div className={`project-nav-row ${project.id === activeProjectId ? "is-active" : ""}`} key={project.id}>
              <button className="nav-item project-nav-main" type="button" onClick={() => onSelectProject(project.id)}>
                <FolderOpen size={16} />
                <span>{project.name}</span>
              </button>
              <button
                className="project-delete-button"
                type="button"
                onClick={() => setProjectToDelete(project)}
                aria-label={`Delete project ${project.name}`}
                title="Delete project"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section grow">
        <div className="section-title">
          <span>Recents</span>
          <button type="button" onClick={onCreateNotebook} aria-label="New notebook" title="New notebook">
            <Plus size={14} />
          </button>
        </div>
        <div className="nav-list">
          {activeProject?.notebooks.map((notebook) => (
            <div className={`notebook-nav-row ${notebook.id === activeNotebookId ? "is-active" : ""}`} key={notebook.id}>
              <button
                className="nav-item notebook-nav-main"
                type="button"
                onClick={() => onSelectNotebook(notebook.id)}
              >
                <FileText size={15} strokeWidth={1.8} />
                <span>{notebook.title}</span>
              </button>
              <button
                className="notebook-delete-button"
                type="button"
                onClick={() => setNotebookToDelete(notebook)}
                aria-label={`Delete notebook ${notebook.title}`}
                title="Delete notebook"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {projectToDelete && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
          <div className="confirm-dialog">
            <h2 id="delete-project-title">Delete project?</h2>
            <p>
              This will delete "{projectToDelete.name}" and all notebooks inside it. This action cannot be undone from
              the sidebar.
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setProjectToDelete(null)}>
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  onDeleteProject(projectToDelete.id);
                  setProjectToDelete(null);
                }}
              >
                Delete project
              </button>
            </div>
          </div>
        </div>
      )}

      {notebookToDelete && (
        <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-notebook-title">
          <div className="confirm-dialog">
            <h2 id="delete-notebook-title">Delete notebook?</h2>
            <p>
              This will delete "{notebookToDelete.title}" from Recents. Export or snapshot it first if you need a copy.
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setNotebookToDelete(null)}>
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  onDeleteNotebook(notebookToDelete.id);
                  setNotebookToDelete(null);
                }}
              >
                Delete notebook
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

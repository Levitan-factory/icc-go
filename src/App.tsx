import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { parseCellDsl } from "./language/latest";
import { useWorkspace } from "./store/useWorkspace";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceTopBar, type WorkspaceSurface } from "./components/WorkspaceTopBar";
import { NotebookCanvas } from "./components/NotebookCanvas";
import { Inspector } from "./components/Inspector";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ArtifactViewer } from "./components/ArtifactViewer";
import { DocsPage } from "./components/DocsPage";
import { AdminPage } from "./components/AdminPage";
import { CodeSurface } from "./components/CodeSurface";
import { VisualEditor } from "./visual/VisualEditor";
import { providerAliasOptions } from "./domain/providerAliases";
import { recordOnlineEvent } from "./domain/onlineApi";
import { checkAppBundleFreshness, type AppBundleStatus } from "./domain/appUpdate";
import {
  configuredOnlineAuthProviders,
  completeOnlineAuthRedirectIfNeeded,
  disabledOnlineAuthConfig,
  ensureFreshOnlineSession,
  isHostedOnlineEnvironment,
  loadOnlineAuthConfig,
  preferredOnlineAuthProvider,
  signOutOnline,
  startOnlineSignIn,
} from "./domain/onlineAuth";
import type { Notebook, NotebookDslChannel, WorkspaceSettings } from "./domain/types";
import type { OnlineAuthConfig, OnlineAuthProvider, OnlineAuthSession } from "./domain/onlineAuth";

type OnlineAuthViewState = {
  loading: boolean;
  config: OnlineAuthConfig;
  session: OnlineAuthSession | null;
  error?: string;
};

const LOCAL_BACKUP_NOTICE_DISMISSED_KEY = "icc-go.local-backup-notice.dismissed.v1";

function readLocalBackupNoticeDismissed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LOCAL_BACKUP_NOTICE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalBackupNoticeDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_BACKUP_NOTICE_DISMISSED_KEY, "true");
  } catch {
    // The notice is non-critical; blocked storage should not interrupt the notebook.
  }
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(() => isSettingsRoute());
  const [docsOpen, setDocsOpen] = useState(() => isDocsRoute());
  const [adminOpen, setAdminOpen] = useState(() => isAdminRoute());
  const [workspaceSurface, setWorkspaceSurface] = useState<WorkspaceSurface>(() => surfaceFromRoute());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [localBackupNoticeDismissed, setLocalBackupNoticeDismissed] = useState(readLocalBackupNoticeDismissed);
  const isHostedOnline = useMemo(() => isHostedOnlineEnvironment(), []);
  const [appBundleStatus, setAppBundleStatus] = useState<AppBundleStatus>(() => ({
    status: "unknown",
    checkedAt: new Date(0).toISOString(),
  }));
  const [onlineAuth, setOnlineAuth] = useState<OnlineAuthViewState>(() => ({
    loading: isHostedOnline,
    config: disabledOnlineAuthConfig,
    session: null,
  }));
  const workspace = useWorkspace();
  const onlineAccess = {
    isHostedOnline,
    hasOauthSession: Boolean(onlineAuth.session),
    requiresAuth: isHostedOnline && (onlineAuth.loading || !onlineAuth.session),
  };
  const showLocalBackupNotice = onlineAccess.isHostedOnline && onlineAccess.hasOauthSession && !localBackupNoticeDismissed;

  const selectedParsed = useMemo(() => {
    if (!workspace.selectedCell) return undefined;
    if (workspace.selectedCell.kind === "text") return undefined;

    return parseCellDsl(workspace.selectedCell.controlHeader, workspace.selectedCell.promptBody, {
      knownAliases: workspace.knownAliases,
      providerAliases: providerAliasOptions(workspace.workspace.settings),
      defaultLoopIterations: workspace.workspace.settings.orchestration.defaultLoopIterations,
      maxLoopIterations: workspace.workspace.settings.orchestration.maxLoopIterations,
      cells: workspace.activeNotebook?.cells,
    });
  }, [workspace.activeNotebook?.cells, workspace.knownAliases, workspace.selectedCell, workspace.workspace.settings]);
  const selectedArtifact = workspace.allArtifacts.find((artifact) => artifact.id === selectedArtifactId);

  useEffect(() => {
    if (!isHostedOnline) return;

    let cancelled = false;

    async function loadAuth() {
      const config = await loadOnlineAuthConfig();
      const redirectResult = await completeOnlineAuthRedirectIfNeeded(config);
      const session = redirectResult.session ?? (await ensureFreshOnlineSession(config));

      if (cancelled) return;

      setOnlineAuth({
        loading: false,
        config,
        session,
        error: redirectResult.error,
      });

      if (redirectResult.error) {
        setAuthPromptOpen(true);
      }
    }

    loadAuth().catch((error: unknown) => {
      if (cancelled) return;
      setOnlineAuth((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "OAuth initialization failed.",
      }));
      setAuthPromptOpen(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isHostedOnline]);

  useEffect(() => {
    if (!isHostedOnline) return;

    let cancelled = false;

    async function refreshBundleStatus() {
      const status = await checkAppBundleFreshness();
      if (!cancelled) setAppBundleStatus(status);
    }

    void refreshBundleStatus();
    const handleFocus = () => void refreshBundleStatus();
    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshBundleStatus();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(refreshBundleStatus, 60000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [isHostedOnline]);

  useEffect(() => {
    function handlePopState() {
      setSettingsOpen(isSettingsRoute());
      setDocsOpen(isDocsRoute());
      setAdminOpen(isAdminRoute());
      setWorkspaceSurface(surfaceFromRoute());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function handleSignIn(provider?: OnlineAuthProvider) {
    const selectedProvider = provider ?? preferredOnlineAuthProvider(onlineAuth.config);
    try {
      void recordOnlineEvent(onlineAuth.config, onlineAuth.session, {
        eventType: "sign_in_started",
        provider: selectedProvider,
      });
      await startOnlineSignIn(onlineAuth.config, selectedProvider);
    } catch (error) {
      setOnlineAuth((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "OAuth sign-in could not be started.",
      }));
      setAuthPromptOpen(true);
    }
  }

  function handleSignOut() {
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, { eventType: "sign_out" });
    signOutOnline(onlineAuth.config);
  }

  function handleExportLocalBackup() {
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, {
      eventType: "backup_export_started",
      detail: "local_storage_notice",
    });
    workspace.exportNotebook("zip");
  }

  function handleDismissLocalBackupNotice() {
    writeLocalBackupNoticeDismissed();
    setLocalBackupNoticeDismissed(true);
  }

  function openSettings() {
    if (!isSettingsRoute()) {
      window.history.pushState(null, "", "/settings");
    }
    setSettingsOpen(true);
    setDocsOpen(false);
    setWorkspaceSurface(surfaceFromRoute());
  }

  function closeSettings() {
    if (isSettingsRoute()) {
      window.history.pushState(null, "", "/");
    }
    setSettingsOpen(false);
    setWorkspaceSurface(surfaceFromRoute());
  }

  function openDocs(pageId = "overview") {
    const nextPath = `/docs#${pageId}`;
    if (window.location.pathname + window.location.hash !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
    setDocsOpen(true);
    setSettingsOpen(false);
    setWorkspaceSurface(surfaceFromRoute());
  }

  function closeDocs() {
    if (isDocsRoute()) {
      window.history.pushState(null, "", "/");
    }
    setDocsOpen(false);
    setWorkspaceSurface(surfaceFromRoute());
  }

  function setSurfaceRoute(surface: WorkspaceSurface) {
    const nextPath = surface === "visual" ? "/" : `/${surface}`;
    if (window.location.pathname !== nextPath || window.location.hash) {
      window.history.pushState(null, "", nextPath);
    }
    setWorkspaceSurface(surface);
    setSettingsOpen(false);
    setDocsOpen(false);
    setAdminOpen(false);
  }

  useEffect(() => {
    if (!isHostedOnline || onlineAuth.loading || !onlineAuth.config.apiBaseUrl) return;
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, { eventType: "page_view" });
  }, [isHostedOnline, onlineAuth.loading, onlineAuth.config.apiBaseUrl, onlineAuth.session?.user.sub]);

  useEffect(() => {
    if (!isHostedOnline || onlineAuth.loading || !onlineAuth.config.apiBaseUrl || !onlineAuth.session) return;
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, { eventType: "sign_in_success" });
  }, [isHostedOnline, onlineAuth.loading, onlineAuth.config.apiBaseUrl, onlineAuth.session?.accessToken]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const editingText = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";

      if (onlineAccess.requiresAuth && isGatedKeyboardAction(event, editingText)) {
        event.preventDefault();
        void recordOnlineEvent(onlineAuth.config, onlineAuth.session, {
          eventType: "auth_gate_opened",
          detail: "keyboard",
        });
        setAuthPromptOpen(true);
        return;
      }

      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        workspace.manualSave();
      }
      if (command && event.key.toLowerCase() === "z" && !event.shiftKey && !editingText) {
        event.preventDefault();
        workspace.undo();
      }
      if (command && event.key.toLowerCase() === "z" && event.shiftKey && !editingText) {
        event.preventDefault();
        workspace.redo();
      }
      if (command && event.key.toLowerCase() === "f") {
        event.preventDefault();
        workspace.findOrGoToCell();
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        const cell = workspace.selectedCell;
        if (cell && cell.kind !== "text") handleRunCell(cell.id, "keyboard_current");
      }
      if (command && event.key.toLowerCase() === "d" && !editingText) {
        event.preventDefault();
        if (workspace.selectedCell) workspace.duplicateCell(workspace.selectedCell.id);
      }
      if (command && event.key === "Backspace" && !editingText) {
        event.preventDefault();
        if (workspace.selectedCell) workspace.deleteCell(workspace.selectedCell.id);
      }
      if (command && event.key.toLowerCase() === "e") {
        event.preventDefault();
        handleExportNotebook("zip", "keyboard");
      }
      if (command && event.key === "/") {
        event.preventDefault();
        window.alert("Cmd/Ctrl+S Save\nCmd/Ctrl+Z Undo\nCmd/Ctrl+Shift+Z Redo\nCmd/Ctrl+F Find\nCmd/Ctrl+Enter Run current\nCmd/Ctrl+E Export");
      }
      if (event.shiftKey && event.key === "Enter" && !command) {
        const cell = workspace.selectedCell;
        if (cell && cell.kind !== "text") {
          event.preventDefault();
          handleRunCell(cell.id, "keyboard_shift_enter");
        }
      }
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        workspace.addCell(workspace.selectedCell?.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onlineAccess.isHostedOnline,
    onlineAccess.requiresAuth,
    onlineAuth.config.apiBaseUrl,
    onlineAuth.session?.accessToken,
    onlineAuth.session?.user.sub,
    workspace,
  ]);

  function handleOnlineReadOnlyClick(event: MouseEvent<HTMLDivElement>) {
    if (!onlineAccess.requiresAuth) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-auth-gate]")) return;

    const interactive = target.closest("button, input, textarea, select, a, [contenteditable='true']");
    if (!interactive) return;

    event.preventDefault();
    event.stopPropagation();
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, {
      eventType: "auth_gate_opened",
      detail: "click",
    });
    setAuthPromptOpen(true);
  }

  function recordProductEvent(eventType: string, detail?: string, route?: string) {
    if (!onlineAccess.isHostedOnline || !onlineAuth.config.apiBaseUrl) return;
    void recordOnlineEvent(onlineAuth.config, onlineAuth.session, {
      eventType,
      detail,
      route,
    });
  }

  function countIntentCells() {
    return workspace.activeNotebook?.cells.filter((cell) => cell.kind !== "text").length ?? 0;
  }

  function cellRunDetail(source: string, count = 1, cellId?: string) {
    const cell = cellId ? workspace.activeNotebook?.cells.find((candidate) => candidate.id === cellId) : undefined;
    return [
      `count=${Math.max(1, count)}`,
      `source=${source}`,
      cell && cell.kind !== "text" ? `cell=${cell.alias}` : undefined,
      workspace.activeNotebook ? `notebook=${workspace.activeNotebook.id}` : undefined,
    ].filter(Boolean).join(";");
  }

  function shouldBlockStaleRun(source: string): boolean {
    if (appBundleStatus.status !== "stale") return false;

    recordProductEvent(
      "app_update_blocked_run",
      `source=${source};current=${appBundleStatus.currentAsset};latest=${appBundleStatus.latestAsset}`,
    );
    return true;
  }

  function reloadAppBundle() {
    window.location.reload();
  }

  function handleCreateProject() {
    recordProductEvent("project_created", "source=ui");
    recordProductEvent("notebook_created", "source=project_create;count=1");
    workspace.createProject();
  }

  function handleCreateNotebook(source = "ui") {
    recordProductEvent("notebook_created", `source=${source};count=1`);
    workspace.createNotebookInActiveProject();
  }

  function handleRunCell(cellId: string, source = "cell") {
    if (shouldBlockStaleRun(source)) return;
    recordProductEvent("cell_run_requested", cellRunDetail(source, 1, cellId));
    workspace.runCell(cellId);
  }

  function handleRunFromHere(cellId: string) {
    if (shouldBlockStaleRun("run_from_here")) return;
    recordProductEvent("run_from_here_requested", cellRunDetail("run_from_here", 1, cellId));
    recordProductEvent("cell_run_requested", cellRunDetail("run_from_here", 1, cellId));
    workspace.runFromHere(cellId);
  }

  function handleRunAll() {
    if (shouldBlockStaleRun("run_all")) return;
    const count = countIntentCells();
    recordProductEvent("run_all_requested", cellRunDetail("run_all", count));
    recordProductEvent("cell_run_requested", cellRunDetail("run_all", count));
    workspace.runAll();
  }

  function handleRunStaleCells() {
    if (shouldBlockStaleRun("run_stale")) return;
    const count = workspace.activeNotebook?.cells.filter((cell) => cell.kind !== "text" && cell.status === "stale").length ?? 0;
    recordProductEvent("run_stale_requested", cellRunDetail("run_stale", count));
    if (count) recordProductEvent("cell_run_requested", cellRunDetail("run_stale", count));
    workspace.runStaleCells();
  }

  function handleExportNotebook(format: "json" | "md" | "zip", source = "ui") {
    recordProductEvent("notebook_export_requested", `source=${source};format=${format}`);
    workspace.exportNotebook(format);
  }

  if (adminOpen && onlineAccess.isHostedOnline) {
    return (
      <AdminPage
        config={onlineAuth.config}
        error={onlineAuth.error}
        loadingAuth={onlineAuth.loading}
        session={onlineAuth.session}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <div className={`app-shell ${onlineAccess.requiresAuth ? "is-online-readonly" : ""}`} onClickCapture={handleOnlineReadOnlyClick}>
      {onlineAccess.requiresAuth && (
        <div className="online-readonly-banner" role="status">
          <strong>{onlineAuth.loading ? "Checking OAuth session." : "Online preview is read-only."}</strong>
          <span>{onlineAuth.loading ? "Please wait while ICC-GO verifies sign-in." : "Sign in before editing, running, saving, exporting, or connecting provider keys."}</span>
        </div>
      )}

      {onlineAccess.isHostedOnline && onlineAccess.hasOauthSession && (
        <div className="online-status-bar" role="status">
          <div className="online-status-session">
            <strong>Signed in</strong>
            <span>{onlineAuth.session?.user.email || onlineAuth.session?.user.name || "ICC-GO account"}</span>
            <a href="/admin">Admin</a>
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
          {showLocalBackupNotice && (
            <>
              <span className="online-status-divider" aria-hidden="true" />
              <div className="online-storage-notice">
                <strong>Local browser storage</strong>
                <span>Notebooks, attachments, and generated files stay in this browser. Export a ZIP before clearing data or switching devices.</span>
                <div className="local-backup-actions">
                  <button className="local-backup-primary" type="button" onClick={handleExportLocalBackup}>
                    Export ZIP
                  </button>
                  <button type="button" onClick={handleDismissLocalBackupNotice}>
                    Dismiss
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <AppUpdateBanner status={appBundleStatus} onReload={reloadAppBundle} />
      <ProviderIssuesBanner settings={workspace.workspace.settings} onOpenSettings={openSettings} />

      <WorkspaceTopBar
        notebook={workspace.activeNotebook}
        surface={workspaceSurface}
        saveStatus={workspace.saveStatus}
        lastSavedAt={workspace.lastSavedAt}
        canUndo={workspace.canUndo}
        canRedo={workspace.canRedo}
        inspectorOpen={inspectorOpen}
        onNewProject={handleCreateProject}
        onNewNotebook={() => handleCreateNotebook("topbar")}
        onDuplicateNotebook={workspace.duplicateNotebook}
        onDeleteNotebook={workspace.deleteNotebook}
        onSave={workspace.manualSave}
        onSaveSnapshot={workspace.saveSnapshot}
        onRestoreSnapshot={workspace.restoreSnapshot}
        onImportNotebook={workspace.importNotebookFile}
        onExport={(format) => handleExportNotebook(format)}
        onDownloadArtifacts={workspace.downloadAllArtifacts}
        onUndo={workspace.undo}
        onRedo={workspace.redo}
        onAddCell={() => workspace.addCell(workspace.selectedCell?.id)}
        onAddTextCell={() => workspace.addTextCell(workspace.selectedCell?.id)}
        onRunCurrent={() => workspace.selectedCell?.kind !== "text" && workspace.selectedCell && handleRunCell(workspace.selectedCell.id, "topbar_current")}
        onRunAll={handleRunAll}
        onRunStale={handleRunStaleCells}
        onRunFromHere={() => workspace.selectedCell && handleRunFromHere(workspace.selectedCell.id)}
        onStopAll={workspace.stopAllRuns}
        onValidate={() => workspace.validateNotebook(true)}
        onEstimateCost={workspace.estimateCost}
        onFind={() => workspace.findOrGoToCell()}
        onCopyCurrentMarkdown={workspace.copyCurrentCellMarkdown}
        onCopyNotebookMarkdown={workspace.copyNotebookMarkdown}
        onClearCurrentOutput={() => workspace.clearCellOutput()}
        onClearAllOutputs={workspace.clearAllOutputs}
        onSetViewMode={workspace.setNotebookViewMode}
        onSetSurface={setSurfaceRoute}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        onOpenSettings={openSettings}
        onOpenDocs={openDocs}
      />

      <div className={`workspace-body ${workspaceSurface === "visual" ? "is-visual-surface" : ""}`}>
        {workspaceSurface === "visual" ? (
          <main className="visual-main-pane">
            <VisualEditor />
          </main>
        ) : (
          <>
            <Sidebar
              projects={workspace.workspace.projects}
              activeProjectId={workspace.workspace.activeProjectId}
              activeNotebookId={workspace.workspace.activeNotebookId}
              runningCellIds={workspace.runningCellIds}
              onSelectProject={workspace.setActiveProject}
              onSelectNotebook={workspace.setActiveNotebook}
              onCreateProject={handleCreateProject}
              onDeleteProject={workspace.deleteProject}
              onCreateNotebook={() => handleCreateNotebook("sidebar")}
              onDeleteNotebook={(notebookId) => workspace.deleteNotebook(notebookId, { confirm: false })}
            />

            <main className="main-pane">
              {workspace.activeNotebook ? (
                <>
                  <NotebookTitleBar
                    notebook={workspace.activeNotebook}
                    onRename={workspace.renameNotebook}
                    onSetChannel={workspace.setNotebookDslChannel}
                  />
                  {workspaceSurface === "code" ? (
                    <CodeSurface notebook={workspace.activeNotebook} />
                  ) : (
                    <NotebookCanvas
                      notebook={workspace.activeNotebook}
                      settings={workspace.workspace.settings}
                      selectedCellId={workspace.workspace.selectedCellId}
                      runningCellIds={workspace.runningCellIds}
                      onSelectCell={workspace.selectCell}
                      onUpdateCell={workspace.updateCell}
                      onAddCell={workspace.addCell}
                      onAddTextCell={workspace.addTextCell}
                      onRunCell={(cellId) => handleRunCell(cellId, "cell_button")}
                      onRunFromHere={handleRunFromHere}
                      onStopCell={workspace.stopCell}
                      onAttachFiles={workspace.attachFilesToCell}
                      onRemoveAttachment={workspace.removeCellAttachment}
                      onDuplicateCell={workspace.duplicateCell}
                      onDeleteCell={workspace.deleteCell}
                      onMoveCell={workspace.moveCell}
                      onOpenArtifact={setSelectedArtifactId}
                    />
                  )}
                </>
              ) : (
                <section className="empty-notebook">
                  <div>
                    <h1>No notebook selected</h1>
                    <p>Create a notebook to start writing executable LLM cells.</p>
                  </div>
                  <button className="primary-button" type="button" onClick={() => handleCreateNotebook("empty_state")}>
                    <Plus size={16} />
                    New notebook
                  </button>
                </section>
              )}
            </main>

            <aside className={`inspector-pane ${inspectorOpen ? "is-open" : "is-collapsed"}`}>
              <button
                className="inspector-toggle"
                type="button"
                onClick={() => setInspectorOpen((current) => !current)}
                aria-label={inspectorOpen ? "Collapse inspector" : "Open inspector"}
                title={inspectorOpen ? "Collapse inspector" : "Open inspector"}
              >
                {inspectorOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
              {inspectorOpen && (
                <Inspector cell={workspace.selectedCell} parsed={selectedParsed} settings={workspace.workspace.settings} />
              )}
            </aside>
          </>
        )}
      </div>

      <SettingsDrawer
        open={settingsOpen}
        settings={workspace.workspace.settings}
        onClose={closeSettings}
        onUpdateProvider={workspace.updateProvider}
        onAddProvider={workspace.addProvider}
        onDeleteProvider={workspace.deleteProvider}
        onMoveProvider={workspace.moveProvider}
        onUpdateOrchestration={workspace.updateOrchestration}
        onResetWorkspace={workspace.resetWorkspace}
      />

      <DocsPage open={docsOpen} onClose={closeDocs} />

      <ArtifactViewer
        artifact={selectedArtifact}
        onClose={() => setSelectedArtifactId(undefined)}
        onUseInPrompt={(artifact) => workspace.useArtifactInSelectedCell(artifact, "prompt")}
      />

      {authPromptOpen && (
        <OnlineAuthGate
          config={onlineAuth.config}
          error={onlineAuth.error}
          loading={onlineAuth.loading}
          onClose={() => setAuthPromptOpen(false)}
          onSignIn={handleSignIn}
        />
      )}
    </div>
  );
}

function AppUpdateBanner({ status, onReload }: { status: AppBundleStatus; onReload: () => void }) {
  if (status.status !== "stale") return null;

  return (
    <div className="app-update-banner" role="alert">
      <strong>ICC-GO was updated.</strong>
      <span>This tab is running an older build. Reload before running provider calls.</span>
      <button type="button" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}

function ProviderIssuesBanner({
  settings,
  onOpenSettings,
}: {
  settings: WorkspaceSettings;
  onOpenSettings: () => void;
}) {
  const issues = settings.providers.filter(
    (provider) => provider.enabled && (provider.balance.state === "warning" || provider.balance.state === "error"),
  );

  if (!issues.length) return null;

  return (
    <div className="provider-issues-banner" role="status">
      <strong>Provider key attention</strong>
      <span>
        {issues.map((provider) => `${provider.alias}: ${provider.balance.message}`).join(" · ")}
      </span>
      <button type="button" onClick={onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}

function isSettingsRoute(): boolean {
  return window.location.pathname === "/settings";
}

function isDocsRoute(): boolean {
  return window.location.pathname === "/docs";
}

function isAdminRoute(): boolean {
  return window.location.pathname === "/admin";
}

function surfaceFromRoute(): WorkspaceSurface {
  if (window.location.pathname === "/code") return "code";
  if (window.location.pathname === "/notebook") return "notebook";
  return "visual";
}

function isGatedKeyboardAction(event: KeyboardEvent, editingText: boolean): boolean {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (event.shiftKey && event.key === "Enter" && !command) return true;
  if (event.altKey && event.key === "Enter") return true;
  if (command && event.key === "Enter") return true;
  if (command && ["s", "z", "f", "d", "e"].includes(key)) return true;
  if (command && event.key === "/") return true;
  if (command && event.key === "Backspace" && !editingText) return true;

  return false;
}

function OnlineAuthGate({
  config,
  error,
  loading,
  onClose,
  onSignIn,
}: {
  config: OnlineAuthConfig;
  error?: string;
  loading: boolean;
  onClose: () => void;
  onSignIn: (provider?: OnlineAuthProvider) => void;
}) {
  const providers = configuredOnlineAuthProviders(config);
  const hasGoogle = providers.includes("Google");
  const hasApple = providers.includes("SignInWithApple");
  const hasCognito = providers.includes("COGNITO");
  const primaryProvider = preferredOnlineAuthProvider(config);
  const primaryLabel =
    primaryProvider === "Google"
      ? "Continue with Google"
      : primaryProvider === "SignInWithApple"
        ? "Continue with Apple"
        : "Sign in with email";
  const renderProviderButton = (provider: OnlineAuthProvider, label: string) => (
    <button
      className={`auth-provider-button auth-provider-${provider === "SignInWithApple" ? "apple" : provider.toLowerCase()}`}
      type="button"
      onClick={() => onSignIn(provider)}
      disabled={loading || !config.enabled}
    >
      {provider === "Google" && <GoogleMark />}
      <span>{loading && provider === primaryProvider ? "Checking sign-in..." : label}</span>
    </button>
  );

  return (
    <div className="auth-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title" data-auth-gate>
      <section className="auth-gate-dialog">
        <p className="eyebrow">OAuth required</p>
        <h2 id="auth-gate-title">Sign in before using the online notebook.</h2>
        <p>
          The hosted notebook can be viewed anonymously, but running cells, editing notebooks, exporting data, changing
          settings, and connecting provider keys require sign-in.
        </p>
        <p>
          No owner provider keys are shipped with this build. After sign-in, each user connects their own provider
          credentials in settings.
        </p>
        {error && <p className="auth-gate-error">{error}</p>}
        <div className="auth-gate-actions">
          {renderProviderButton(primaryProvider, primaryLabel)}
          {hasGoogle && primaryProvider !== "Google" && renderProviderButton("Google", "Continue with Google")}
          {hasApple && primaryProvider !== "SignInWithApple" && (
            renderProviderButton("SignInWithApple", "Continue with Apple")
          )}
          {hasCognito && primaryProvider !== "COGNITO" && (
            renderProviderButton("COGNITO", "Sign in with email")
          )}
          <a href="https://icc-go.com/download/">Download local bundle</a>
        </div>
        <button className="auth-gate-close" type="button" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="auth-provider-google-mark" aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function NotebookTitleBar({
  notebook,
  onRename,
  onSetChannel,
}: {
  notebook: Notebook;
  onRename: (title: string) => void;
  onSetChannel: (channel: NotebookDslChannel) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(notebook.title);
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    setDraftTitle(notebook.title);
  }, [notebook.title]);

  function commitTitle() {
    onRename(draftTitle);
    setEditingTitle(false);
  }

  return (
    <section className="notebook-titlebar" aria-label="Notebook title">
      {editingTitle ? (
        <input
          autoFocus
          value={draftTitle}
          onBlur={commitTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitTitle();
            if (event.key === "Escape") {
              setDraftTitle(notebook.title);
              setEditingTitle(false);
            }
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditingTitle(true)} title="Rename notebook">
          {notebook.title}
        </button>
      )}
      <div className="dsl-channel-switch" aria-label="ICC DSL channel">
        {(["stable", "preview", "experimental"] as const).map((channel) => (
          <button
            className={notebook.metadata.dsl_channel === channel ? "is-active" : ""}
            type="button"
            key={channel}
            onClick={() => onSetChannel(channel)}
          >
            {channel}
          </button>
        ))}
      </div>
    </section>
  );
}

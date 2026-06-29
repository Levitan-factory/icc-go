import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { parseCellDsl } from "./language/latest";
import { useWorkspace } from "./store/useWorkspace";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceTopBar } from "./components/WorkspaceTopBar";
import { NotebookCanvas } from "./components/NotebookCanvas";
import { Inspector } from "./components/Inspector";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ArtifactViewer } from "./components/ArtifactViewer";
import { DocsPage } from "./components/DocsPage";
import { AdminPage } from "./components/AdminPage";
import { providerAliasOptions } from "./domain/providerAliases";
import { recordOnlineEvent } from "./domain/onlineApi";
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [localBackupNoticeDismissed, setLocalBackupNoticeDismissed] = useState(readLocalBackupNoticeDismissed);
  const isHostedOnline = useMemo(() => isHostedOnlineEnvironment(), []);
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
    function handlePopState() {
      setSettingsOpen(isSettingsRoute());
      setDocsOpen(isDocsRoute());
      setAdminOpen(isAdminRoute());
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
  }

  function closeSettings() {
    if (isSettingsRoute()) {
      window.history.pushState(null, "", "/");
    }
    setSettingsOpen(false);
  }

  function openDocs(pageId = "overview") {
    const nextPath = `/docs#${pageId}`;
    if (window.location.pathname + window.location.hash !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
    setDocsOpen(true);
    setSettingsOpen(false);
  }

  function closeDocs() {
    if (isDocsRoute()) {
      window.history.pushState(null, "", "/");
    }
    setDocsOpen(false);
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
        if (cell && cell.kind !== "text") workspace.runCell(cell.id);
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
        workspace.exportNotebook("zip");
      }
      if (command && event.key === "/") {
        event.preventDefault();
        window.alert("Cmd/Ctrl+S Save\nCmd/Ctrl+Z Undo\nCmd/Ctrl+Shift+Z Redo\nCmd/Ctrl+F Find\nCmd/Ctrl+Enter Run current\nCmd/Ctrl+E Export");
      }
      if (event.shiftKey && event.key === "Enter" && !command) {
        const cell = workspace.selectedCell;
        if (cell && cell.kind !== "text") {
          event.preventDefault();
          workspace.runCell(cell.id);
        }
      }
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        workspace.addCell(workspace.selectedCell?.id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onlineAccess.requiresAuth, workspace]);

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

      <ProviderIssuesBanner settings={workspace.workspace.settings} onOpenSettings={openSettings} />

      <WorkspaceTopBar
        notebook={workspace.activeNotebook}
        saveStatus={workspace.saveStatus}
        lastSavedAt={workspace.lastSavedAt}
        canUndo={workspace.canUndo}
        canRedo={workspace.canRedo}
        inspectorOpen={inspectorOpen}
        onNewProject={workspace.createProject}
        onNewNotebook={workspace.createNotebookInActiveProject}
        onDuplicateNotebook={workspace.duplicateNotebook}
        onDeleteNotebook={workspace.deleteNotebook}
        onSave={workspace.manualSave}
        onSaveSnapshot={workspace.saveSnapshot}
        onRestoreSnapshot={workspace.restoreSnapshot}
        onImportNotebook={workspace.importNotebookFile}
        onExport={workspace.exportNotebook}
        onDownloadArtifacts={workspace.downloadAllArtifacts}
        onUndo={workspace.undo}
        onRedo={workspace.redo}
        onAddCell={() => workspace.addCell(workspace.selectedCell?.id)}
        onAddTextCell={() => workspace.addTextCell(workspace.selectedCell?.id)}
        onRunCurrent={() => workspace.selectedCell?.kind !== "text" && workspace.selectedCell && workspace.runCell(workspace.selectedCell.id)}
        onRunAll={workspace.runAll}
        onRunStale={workspace.runStaleCells}
        onRunFromHere={() => workspace.selectedCell && workspace.runFromHere(workspace.selectedCell.id)}
        onStopAll={workspace.stopAllRuns}
        onValidate={() => workspace.validateNotebook(true)}
        onEstimateCost={workspace.estimateCost}
        onFind={() => workspace.findOrGoToCell()}
        onCopyCurrentMarkdown={workspace.copyCurrentCellMarkdown}
        onCopyNotebookMarkdown={workspace.copyNotebookMarkdown}
        onClearCurrentOutput={() => workspace.clearCellOutput()}
        onClearAllOutputs={workspace.clearAllOutputs}
        onSetViewMode={workspace.setNotebookViewMode}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        onOpenSettings={openSettings}
        onOpenDocs={openDocs}
      />

      <div className="workspace-body">
        <Sidebar
          projects={workspace.workspace.projects}
          activeProjectId={workspace.workspace.activeProjectId}
          activeNotebookId={workspace.workspace.activeNotebookId}
          onSelectProject={workspace.setActiveProject}
          onSelectNotebook={workspace.setActiveNotebook}
          onCreateProject={workspace.createProject}
          onDeleteProject={workspace.deleteProject}
          onCreateNotebook={workspace.createNotebookInActiveProject}
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
              <NotebookCanvas
                notebook={workspace.activeNotebook}
                settings={workspace.workspace.settings}
                selectedCellId={workspace.workspace.selectedCellId}
                runningCellIds={workspace.runningCellIds}
                onSelectCell={workspace.selectCell}
                onUpdateCell={workspace.updateCell}
                onAddCell={workspace.addCell}
                onAddTextCell={workspace.addTextCell}
                onRunCell={workspace.runCell}
                onRunFromHere={workspace.runFromHere}
                onStopCell={workspace.stopCell}
                onAttachFiles={workspace.attachFilesToCell}
                onRemoveAttachment={workspace.removeCellAttachment}
                onDuplicateCell={workspace.duplicateCell}
                onDeleteCell={workspace.deleteCell}
                onMoveCell={workspace.moveCell}
                onOpenArtifact={setSelectedArtifactId}
              />
            </>
          ) : (
            <section className="empty-notebook">
              <div>
                <h1>No notebook selected</h1>
                <p>Create a notebook to start writing executable LLM cells.</p>
              </div>
              <button className="primary-button" type="button" onClick={workspace.createNotebookInActiveProject}>
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

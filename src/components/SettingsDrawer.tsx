import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  chooseAutoModelForProvider,
  providerModelRegistryVersion,
  refreshProviderModelCatalog,
  uniqueRegistryModelChoices,
} from "../domain/providerModelRegistry";
import {
  modelChoicesForProviderSettings,
  modelProfileFields,
  openRouterFamilies,
  openRouterFamilyForModel,
  uniqueModelChoices,
} from "../domain/modelCatalog";
import { providerKindLabel, providerKinds } from "../domain/providerAliases";
import { deleteProviderSecret, readProviderSecret, writeProviderSecret } from "../domain/providerSecrets";
import type { OrchestrationSettings, ProviderBalanceStatus, ProviderKind, ProviderSettings, WorkspaceSettings } from "../domain/types";
import { AppLogo } from "./AppLogo";

interface SettingsDrawerProps {
  open: boolean;
  settings: WorkspaceSettings;
  onClose: () => void;
  onUpdateProvider: (providerId: string, patch: Partial<ProviderSettings>) => void;
  onAddProvider: (provider: ProviderKind) => void;
  onDeleteProvider: (providerId: string) => void;
  onMoveProvider: (providerId: string, direction: "up" | "down") => void;
  onUpdateOrchestration: (patch: Partial<OrchestrationSettings>) => void;
  onResetWorkspace: () => void;
}

type KeyCheckState = "idle" | "checking" | "passed" | "failed";
type ProviderModelField = (typeof modelProfileFields)[number][1];

interface KeyCheckResult {
  state: KeyCheckState;
  message: string;
  maskedKey?: string;
  balance?: ProviderBalanceStatus;
}

const openRouterKeyInfoUrl = "https://openrouter.ai/api/v1/key";

export function SettingsDrawer({
  open,
  settings,
  onClose,
  onUpdateProvider,
  onAddProvider,
  onDeleteProvider,
  onMoveProvider,
  onUpdateOrchestration,
  onResetWorkspace,
}: SettingsDrawerProps) {
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [keyChecks, setKeyChecks] = useState<Record<string, KeyCheckResult>>({});
  const [modelRefreshes, setModelRefreshes] = useState<Record<string, KeyCheckResult>>({});
  const [newProviderKind, setNewProviderKind] = useState<ProviderKind>("openrouter");
  const linkedCount = useMemo(
    () => settings.providers.filter((provider) => Boolean(provider.apiKeyMasked)).length,
    [settings.providers],
  );
  const providerWarnings = useMemo(
    () =>
      settings.providers.filter(
        (provider) =>
          Boolean(provider.apiKeyMasked) && (provider.balance.state === "warning" || provider.balance.state === "error"),
      ),
    [settings.providers],
  );

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function setDraft(providerId: string, value: string) {
    setDraftKeys((current) => ({ ...current, [providerId]: value }));
    setKeyChecks((current) => ({
      ...current,
      [providerId]: { state: "idle", message: "Key is not checked yet." },
    }));
  }

  async function bindKey(provider: ProviderSettings) {
    const value = draftKeys[provider.id]?.trim() ?? "";
    const validation = validateProviderKey(provider.provider, value);

    if (!validation.ok) {
      setKeyChecks((current) => ({
        ...current,
        [provider.id]: { state: "failed", message: validation.message },
      }));
      return;
    }

    const balance = await checkProviderBalance(provider, value);

    onUpdateProvider(provider.id, {
      apiKeyMasked: maskKey(value),
      enabled: true,
      balance,
    });
    writeProviderSecret(provider.id, value);
    setDraftKeys((current) => ({ ...current, [provider.id]: "" }));
    setKeyChecks((current) => ({
      ...current,
      [provider.id]: {
        state: balance.state === "error" ? "failed" : "passed",
        message:
          balance.state === "error"
            ? balance.message
            : `Linked locally as ${maskKey(value)}. ${balance.message}`,
        maskedKey: maskKey(value),
        balance,
      },
    }));
  }

  async function checkKey(provider: ProviderSettings) {
    const draftInput = draftKeys[provider.id]?.trim() ?? "";
    const storedSecret = readProviderSecret(provider.id);
    const draft = draftInput || storedSecret;
    const alreadyLinked = Boolean(!draftInput && storedSecret && provider.apiKeyMasked);

    if (!draft) {
      const result = provider.apiKeyMasked
        ? {
            state: "failed" as const,
            message: "Paste and bind the full key again. This linked entry only has a masked reference, so live runs cannot use it yet.",
          }
        : { state: "failed" as const, message: "Paste a key before checking this provider." };

      setKeyChecks((current) => ({ ...current, [provider.id]: result }));
      return;
    }

    const validation = validateProviderKey(provider.provider, draft);
    if (!validation.ok) {
      setKeyChecks((current) => ({
        ...current,
        [provider.id]: { state: "failed", message: validation.message },
      }));
      return;
    }

    setKeyChecks((current) => ({
      ...current,
      [provider.id]: { state: "checking", message: "Checking key..." },
    }));

    const balance = await checkProviderBalance(provider, draft);
    const maskedKey = maskKey(draft);
    setKeyChecks((current) => ({
      ...current,
      [provider.id]: {
        state: balance.state === "error" ? "failed" : "passed",
        message:
          balance.state === "error"
            ? balance.message
            : alreadyLinked
              ? `Live key verified for ${provider.apiKeyMasked}. ${balance.message}`
              : `Verified ${maskedKey}. Not linked yet: click Bind key to save this provider reference.`,
        maskedKey,
        balance,
      },
    }));
  }

  function unlinkKey(provider: ProviderSettings) {
    deleteProviderSecret(provider.id);
    onUpdateProvider(provider.id, {
      apiKeyMasked: "",
      enabled: false,
      balance: {
        state: "unchecked",
        message: "Provider key is unlinked.",
      },
    });
    setDraftKeys((current) => ({ ...current, [provider.id]: "" }));
    setKeyChecks((current) => ({
      ...current,
      [provider.id]: { state: "idle", message: "Provider key is unlinked." },
    }));
  }

  async function refreshModels(provider: ProviderSettings) {
    const storedSecret = readProviderSecret(provider.id);

    setModelRefreshes((current) => ({
      ...current,
      [provider.id]: { state: "checking", message: "Refreshing provider model catalog..." },
    }));

    try {
      const refresh = await refreshProviderModelCatalog(provider, storedSecret ?? undefined);
      const choices = uniqueRegistryModelChoices(refresh.choices);
      const nextPatch: Partial<ProviderSettings> = {
        modelCatalog: choices,
        modelCatalogUpdatedAt: refresh.fetchedAt,
        modelCatalogSource: refresh.source,
      };

      nextPatch.defaultModel = chooseAutoModelForProvider(provider.provider, choices, "default", provider.defaultModel);
      nextPatch.maxModel = chooseAutoModelForProvider(provider.provider, choices, "max", provider.maxModel);
      nextPatch.ensembleModel = chooseAutoModelForProvider(provider.provider, choices, "ensemble", provider.ensembleModel);
      nextPatch.cheapModel = chooseAutoModelForProvider(provider.provider, choices, "cheap", provider.cheapModel);
      nextPatch.fastModel = chooseAutoModelForProvider(provider.provider, choices, "fast", provider.fastModel);
      nextPatch.codeModel = chooseAutoModelForProvider(provider.provider, choices, "code", provider.codeModel);
      if (provider.imageModel) nextPatch.imageModel = chooseAutoModelForProvider(provider.provider, choices, "image", provider.imageModel);

      onUpdateProvider(provider.id, nextPatch);
      setModelRefreshes((current) => ({
        ...current,
        [provider.id]: {
          state: "passed",
          message: `Loaded ${choices.length} models from ${refresh.source}. Auto model profile was checked against the fresh catalog.`,
        },
      }));
    } catch (error) {
      setModelRefreshes((current) => ({
        ...current,
        [provider.id]: {
          state: "failed",
          message: error instanceof Error ? error.message : "Model catalog refresh failed.",
        },
      }));
    }
  }

  return (
    <section className="settings-backdrop is-open" aria-label="Settings" aria-modal="true" role="dialog">
      <div className="settings-screen">
        <header className="settings-page-header">
          <div className="settings-header-copy">
            <AppLogo className="settings-logo" onClick={onClose} />
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Settings</h2>
              <p>Provider keys, routing aliases, fallback order, model profiles, and local workspace controls.</p>
            </div>
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label="Close settings">
            <X size={20} />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <a href="#settings-keys">API keys</a>
            <a href="#settings-models">Model profiles</a>
            <a href="#settings-orchestration">Orchestration</a>
            <a href="#settings-danger">Danger zone</a>
          </nav>

          <main className="settings-main">
            <section className="settings-panel" id="settings-keys">
              <div className="settings-section-heading">
                <div>
                  <h3>API keys</h3>
                  <p>{linkedCount} keys linked locally. Fallback follows the order from top to bottom.</p>
                </div>
                <ShieldCheck size={18} />
              </div>
              <p className="settings-note">
                Provider type is the API vendor, such as OpenAI, Anthropic, or OpenRouter. Alias is the name used in
                ICC code. For example, an Anthropic key can keep alias <code>claude</code>, and a DeepSeek key can be
                named <code>chinese</code> and used as <code>&gt; (claude + chinese).best</code>. OpenRouter keys use the
                OpenAI-compatible API and can route many model ids through one key.
              </p>
              <div className="provider-routing-guide" aria-label="Provider routing syntax guide">
                <div>
                  <strong>Routing rule</strong>
                  <p>
                    Alias selects the saved key. Colon selects a concrete model inside that key. Dot selects an ICC
                    profile.
                  </p>
                </div>
                <div className="provider-routing-examples">
                  <code>&gt; openai.max</code>
                  <span>Direct OpenAI key, max profile.</span>
                  <code>&gt; openrouter.max</code>
                  <span>OpenRouter key, max profile, default model <code>openrouter/auto</code>.</span>
                  <code>&gt; openrouter:openai/gpt-4o</code>
                  <span>OpenAI model routed through the OpenRouter key.</span>
                  <code>&gt; openrouter.openai.max</code>
                  <span>Not valid ICC syntax. Use <code>:</code> for OpenRouter model ids.</span>
                </div>
              </div>

              {providerWarnings.length > 0 && (
                <div className="settings-warning" role="status">
                  <AlertCircle size={16} />
                  <span>
                    {providerWarnings.length} provider {providerWarnings.length === 1 ? "needs" : "need"} attention.
                    The notebook will also show this warning while the issue remains.
                  </span>
                </div>
              )}

              <div className="add-provider-row">
                <label>
                  Provider type
                  <select
                    value={newProviderKind}
                    onChange={(event) => setNewProviderKind(event.target.value as ProviderKind)}
                  >
                    {providerKinds.map((provider) => (
                      <option value={provider} key={provider}>
                        {providerKindLabel(provider)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => onAddProvider(newProviderKind)}>
                  <Plus size={16} />
                  Add key
                </button>
              </div>

              <div className="provider-list">
                {settings.providers.map((provider, index) => {
                  const draft = draftKeys[provider.id] ?? "";
                  const check = keyChecks[provider.id] ?? {
                    state: "idle",
                    message: provider.apiKeyMasked
                      ? provider.balance.message || "Key is linked."
                      : "Paste a key, then use Check only or Bind key.",
                  };
                  const linkedLabel = provider.apiKeyMasked ? `Linked · ${provider.apiKeyMasked}` : "Not linked";
                  const providerRowClassName = [
                    "provider-row",
                    provider.apiKeyMasked ? "is-linked" : "",
                    provider.apiKeyMasked && provider.balance.state === "warning" ? "is-warning" : "",
                    provider.apiKeyMasked && provider.balance.state === "error" ? "is-error" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <section className={providerRowClassName} key={provider.id}>
                      <div className="provider-row-header">
                        <div className="provider-order-block">
                          <span className="fallback-index">{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{provider.label}</strong>
                            <span>
                              {providerKindLabel(provider.provider)} · alias {provider.alias}
                              {provider.apiKeyMasked ? ` · ${provider.apiKeyMasked}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="provider-row-actions">
                          <span className={`settings-status ${provider.apiKeyMasked ? "linked" : "muted"}`}>
                            {linkedLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() => onMoveProvider(provider.id, "up")}
                            disabled={index === 0}
                            title="Move up in fallback order"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onMoveProvider(provider.id, "down")}
                            disabled={index === settings.providers.length - 1}
                            title="Move down in fallback order"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete provider key "${provider.label}"?`)) {
                                deleteProviderSecret(provider.id);
                                onDeleteProvider(provider.id);
                              }
                            }}
                            title="Delete provider key"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="provider-connection-grid">
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={provider.enabled}
                            onChange={(event) => onUpdateProvider(provider.id, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                        <label>
                          Provider
                          <select
                            value={provider.provider}
                            onChange={(event) => onUpdateProvider(provider.id, { provider: event.target.value as ProviderKind })}
                          >
                            {providerKinds.map((providerKind) => (
                              <option value={providerKind} key={providerKind}>
                                {providerKindLabel(providerKind)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Label
                          <input
                            aria-label={`${provider.label} display label`}
                            value={provider.label}
                            onChange={(event) => onUpdateProvider(provider.id, { label: event.target.value })}
                          />
                        </label>
                        <label>
                          Alias
                          <input
                            aria-label={`${provider.label} routing alias`}
                            pattern="[A-Za-z0-9_-]+"
                            value={provider.alias}
                            onChange={(event) => onUpdateProvider(provider.id, { alias: event.target.value })}
                          />
                        </label>
                      </div>

                      <div className="key-binding-row">
                        <KeyRound size={16} />
                        <input
                          aria-label={`${provider.label} API key`}
                          placeholder={provider.apiKeyMasked ? `Linked as ${provider.apiKeyMasked}` : "Paste API key"}
                          type="password"
                          value={draft}
                          onChange={(event) => setDraft(provider.id, event.target.value)}
                        />
                        <button type="button" onClick={() => void checkKey(provider)} disabled={check.state === "checking"}>
                          Check only
                        </button>
                        <button type="button" onClick={() => void bindKey(provider)} disabled={!draft.trim()}>
                          Bind key
                        </button>
                        <button type="button" onClick={() => unlinkKey(provider)} disabled={!provider.apiKeyMasked}>
                          <Unlink size={15} />
                          Unbind
                        </button>
                      </div>

                      <div className="provider-health-row">
                        <p className={`key-check ${check.state}`}>
                          {check.state === "passed" && <CheckCircle2 size={14} />}
                          {check.state === "failed" && <AlertCircle size={14} />}
                          {check.message}
                        </p>
                        <ProviderBalancePill balance={provider.balance} linked={Boolean(provider.apiKeyMasked)} />
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>

            <section className="settings-panel" id="settings-models">
              <div className="settings-section-heading">
                <div>
                  <h3>Model profiles</h3>
                  <p>
                    Profiles decide which model is used when a route omits a concrete model. The Auto model is used
                    for provider-only routes such as <code>&gt; openai</code>. Registry fallback{" "}
                    <code>{providerModelRegistryVersion}</code> is shipped with ICC-GO; linked providers can refresh
                    their model catalog from API.
                  </p>
                </div>
              </div>

              <div className="provider-list">
                {settings.providers.map((provider) => (
                  <section className="provider-row" key={`${provider.id}-models`}>
                    <div className="provider-row-header">
                      <div>
                        <strong>{provider.alias}</strong>
                        <span className="settings-status muted">
                          {provider.contextLimit.toLocaleString()} ctx
                          {provider.modelCatalogUpdatedAt
                            ? ` · models updated ${new Date(provider.modelCatalogUpdatedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
                            : " · fallback registry"}
                        </span>
                      </div>
                      <button
                        className="settings-inline-button"
                        type="button"
                        onClick={() => void refreshModels(provider)}
                        disabled={modelRefreshes[provider.id]?.state === "checking"}
                      >
                        <RefreshCw size={15} />
                        Refresh models
                      </button>
                    </div>
                    <div className="provider-model-grid">
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="defaultModel"
                        label="Auto model"
                        onChange={(value) => onUpdateProvider(provider.id, { defaultModel: value })}
                      />
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="maxModel"
                        label="Max"
                        onChange={(value) => onUpdateProvider(provider.id, { maxModel: value })}
                      />
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="ensembleModel"
                        label="Ensemble"
                        onChange={(value) => onUpdateProvider(provider.id, { ensembleModel: value })}
                      />
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="codeModel"
                        label="Code"
                        onChange={(value) => onUpdateProvider(provider.id, { codeModel: value })}
                      />
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="cheapModel"
                        label="Cheap"
                        onChange={(value) => onUpdateProvider(provider.id, { cheapModel: value })}
                      />
                      <ProviderModelProfileSelect
                        provider={provider}
                        field="fastModel"
                        label="Fast"
                        onChange={(value) => onUpdateProvider(provider.id, { fastModel: value })}
                      />
                      {supportsImageProfile(provider) && (
                        <ProviderModelProfileSelect
                          provider={provider}
                          field="imageModel"
                          label="Image"
                          onChange={(value) => onUpdateProvider(provider.id, { imageModel: value })}
                        />
                      )}
                      <label>
                        Context
                        <input
                          aria-label={`${provider.label} context limit`}
                          inputMode="numeric"
                          value={provider.contextLimit}
                          onChange={(event) => onUpdateProvider(provider.id, { contextLimit: Number(event.target.value) || 0 })}
                        />
                      </label>
                    </div>
                    {provider.provider === "openrouter" && (
                      <p className="settings-note">
                        OpenRouter native routes: <code>openrouter/auto</code> for <code>.max</code> and{" "}
                        <code>openrouter/fusion</code> for <code>.ensemble</code>. Explicit model ids such as{" "}
                        <code>anthropic/claude-sonnet-4.6</code> or <code>deepseek/deepseek-chat:free</code> are valid.
                        Use <code>&gt; openrouter:anthropic/claude-sonnet-4.6</code> for an explicit model through
                        OpenRouter; <code>openrouter.openai.max</code> is not ICC syntax.
                      </p>
                    )}
                    {modelRefreshes[provider.id] && (
                      <p className={`key-check ${modelRefreshes[provider.id].state}`}>
                        {modelRefreshes[provider.id].state === "passed" && <CheckCircle2 size={14} />}
                        {modelRefreshes[provider.id].state === "failed" && <AlertCircle size={14} />}
                        {modelRefreshes[provider.id].state === "checking" && <RefreshCw size={14} />}
                        {modelRefreshes[provider.id].message}
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </section>

            <section className="settings-panel" id="settings-orchestration">
              <div className="settings-section-heading">
                <div>
                  <h3>Orchestration</h3>
                  <p>Final decision models used when ICC-GO, not a provider-native router, resolves multi-model work.</p>
                </div>
              </div>
              <div className="orchestration-grid">
                <OrchestrationModelPicker
                  label={
                    <>
                      Selector for <code>.best</code>
                    </>
                  }
                  settings={settings}
                  value={settings.orchestration.selectorModel}
                  onChange={(selectorModel) => onUpdateOrchestration({ selectorModel })}
                />
                <OrchestrationModelPicker
                  label={
                    <>
                      Ensemble model for <code>.ensemble</code>
                    </>
                  }
                  settings={settings}
                  value={settings.orchestration.synthesisModel}
                  onChange={(ensembleModel) => onUpdateOrchestration({ synthesisModel: ensembleModel })}
                />
                <OrchestrationModelPicker
                  label="Evaluator"
                  settings={settings}
                  value={settings.orchestration.evaluatorModel}
                  onChange={(evaluatorModel) => onUpdateOrchestration({ evaluatorModel })}
                />
                <label>
                  Default loop iterations
                  <input
                    inputMode="numeric"
                    value={settings.orchestration.defaultLoopIterations}
                    onChange={(event) => onUpdateOrchestration({ defaultLoopIterations: Number(event.target.value) || 1 })}
                  />
                </label>
                <label>
                  Max loop iterations
                  <input
                    inputMode="numeric"
                    value={settings.orchestration.maxLoopIterations}
                    onChange={(event) => onUpdateOrchestration({ maxLoopIterations: Number(event.target.value) || 1 })}
                  />
                </label>
                <label>
                  Retry policy
                  <select
                    value={settings.orchestration.retryPolicy}
                    onChange={(event) =>
                      onUpdateOrchestration({ retryPolicy: event.target.value as OrchestrationSettings["retryPolicy"] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="once">Once</option>
                    <option value="exponential">Exponential</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="settings-panel danger-panel" id="settings-danger">
              <div className="settings-section-heading">
                <div>
                  <h3>Danger zone</h3>
                  <p>Local-only destructive actions.</p>
                </div>
              </div>
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  if (window.confirm("Reset local workspace? This will replace local projects and notebooks.")) {
                    onResetWorkspace();
                  }
                }}
              >
                <RotateCcw size={16} />
                Reset local workspace
              </button>
            </section>
          </main>
        </div>
      </div>
    </section>
  );
}

function ProviderBalancePill({ balance, linked }: { balance: ProviderBalanceStatus; linked: boolean }) {
  if (!linked) {
    return (
      <span className="provider-balance-pill unchecked" title="Bind a verified key before this provider is linked.">
        No key linked
      </span>
    );
  }

  return (
    <span className={`provider-balance-pill ${balance.state}`} title={balance.message}>
      {balance.state === "ok" ? "Balance ok" : balance.state === "unchecked" ? "Not checked" : "Needs attention"}
      {typeof balance.remainingCreditsUsd === "number" ? ` · $${balance.remainingCreditsUsd.toFixed(2)}` : ""}
    </span>
  );
}

function ProviderModelProfileSelect({
  provider,
  field,
  label,
  onChange,
}: {
  provider: ProviderSettings;
  field: ProviderModelField;
  label: string;
  onChange: (value: string) => void;
}) {
  const currentValue = (provider[field] ?? "").trim();
  const choices = uniqueModelChoices([
    ...modelChoicesForProviderSettings(provider),
    currentValue ? { label: currentValue, value: currentValue } : undefined,
  ].filter(Boolean) as { label: string; value: string }[]);
  const selectedValue = choices.some((choice) => choice.value === currentValue)
    ? currentValue
    : choices[0]?.value ?? currentValue;

  return (
    <label>
      {label}
      <select
        aria-label={`${provider.label} ${label.toLowerCase()} model`}
        value={selectedValue}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function supportsImageProfile(provider: ProviderSettings): boolean {
  if (provider.imageModel) return true;
  return provider.provider === "openai" || provider.provider === "openrouter" || provider.provider === "gemini" || provider.provider === "xai";
}

function OrchestrationModelPicker({
  label,
  settings,
  value,
  onChange,
}: {
  label: ReactNode;
  settings: WorkspaceSettings;
  value: string;
  onChange: (value: string) => void;
}) {
  const route = parseRouteModel(value);
  const provider = resolveRouteProvider(settings, route.providerAlias);
  const routeAlias = preferredRouteAlias(provider, route.providerAlias);
  const isOpenRouter = provider.provider === "openrouter";
  const currentModel = route.model || defaultModelForProvider(provider);
  const openRouterFamily = openRouterFamilyForModel(currentModel);
  const modelChoices = isOpenRouter
    ? uniqueModelChoices([
        ...openRouterFamily.models,
        currentModel ? { label: currentModel, value: currentModel } : openRouterFamily.models[0],
      ])
    : uniqueModelChoices([
        ...modelChoicesForProviderSettings(provider),
        currentModel ? { label: currentModel, value: currentModel } : { label: provider.defaultModel, value: provider.defaultModel },
      ]);
  const selectedModel = modelChoices.some((choice) => choice.value === currentModel) ? currentModel : modelChoices[0]?.value ?? currentModel;
  const routeValue = formatRouteModel(routeAlias, selectedModel);

  function updateProvider(providerId: string) {
    const nextProvider = settings.providers.find((candidate) => candidate.id === providerId) ?? provider;
    const nextModel = defaultModelForProvider(nextProvider);
    onChange(formatRouteModel(preferredRouteAlias(nextProvider), nextModel));
  }

  function updateFamily(familyId: string) {
    const family = openRouterFamilies.find((candidate) => candidate.id === familyId) ?? openRouterFamilies[0];
    onChange(formatRouteModel(routeAlias, family.models[0]?.value ?? currentModel));
  }

  function updateModel(model: string) {
    onChange(formatRouteModel(routeAlias, model));
  }

  return (
    <label className={`orchestration-model-picker ${isOpenRouter ? "is-openrouter" : ""}`}>
      <span>{label}</span>
      <div className="orchestration-select-row">
        <select value={provider.id} onChange={(event) => updateProvider(event.target.value)} aria-label={`${labelText(label)} provider`}>
          {settings.providers.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.alias || candidate.label} · {providerKindLabel(candidate.provider)}
            </option>
          ))}
        </select>
        {isOpenRouter && (
          <select value={openRouterFamily.id} onChange={(event) => updateFamily(event.target.value)} aria-label={`${labelText(label)} model family`}>
            {openRouterFamilies.map((family) => (
              <option key={family.id} value={family.id}>
                {family.label}
              </option>
            ))}
          </select>
        )}
        <select value={selectedModel} onChange={(event) => updateModel(event.target.value)} aria-label={`${labelText(label)} model`}>
          {modelChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <small className="orchestration-route-preview">{routeValue}</small>
    </label>
  );
}

function parseRouteModel(value: string): { providerAlias: string; model: string } {
  const separator = value.indexOf(":");
  if (separator < 0) return { providerAlias: value.trim(), model: "" };
  return {
    providerAlias: value.slice(0, separator).trim(),
    model: value.slice(separator + 1).trim(),
  };
}

function resolveRouteProvider(settings: WorkspaceSettings, providerAlias: string): ProviderSettings {
  const normalized = providerAlias.trim().toLowerCase();
  return (
    settings.providers.find((provider) =>
      [provider.id, provider.provider, provider.alias, provider.label].some((candidate) => candidate.trim().toLowerCase() === normalized),
    ) ??
    settings.providers.find((provider) => provider.enabled) ??
    settings.providers[0]
  );
}

function preferredRouteAlias(provider: ProviderSettings, currentAlias?: string): string {
  const normalizedCurrent = currentAlias?.trim().toLowerCase();
  if (normalizedCurrent && [provider.id, provider.provider, provider.alias, provider.label].some((value) => value.trim().toLowerCase() === normalizedCurrent)) {
    return currentAlias!.trim();
  }
  const alias = provider.alias.trim();
  return alias && alias.toLowerCase() !== providerKindLabel(provider.provider).toLowerCase() ? alias : provider.provider;
}

function defaultModelForProvider(provider: ProviderSettings): string {
  return provider.provider === "openrouter" ? provider.defaultModel || "openrouter/auto" : provider.defaultModel;
}

function formatRouteModel(providerAlias: string, model: string): string {
  return `${providerAlias}:${model}`;
}

function labelText(label: ReactNode): string {
  return typeof label === "string" ? label : "Orchestration model";
}

function validateProviderKey(provider: ProviderKind, value: string): { ok: boolean; message: string } {
  if (!value) return { ok: false, message: "Paste a key before checking this provider." };

  const checks: Partial<Record<ProviderKind, RegExp>> = {
    openai: /^sk-[A-Za-z0-9_-]{20,}$/,
    anthropic: /^sk-ant-[A-Za-z0-9_-]{16,}$/,
    gemini: /^AIza[A-Za-z0-9_-]{20,}$/,
    xai: /^xai-[A-Za-z0-9_-]{16,}$/,
    openrouter: /^sk-or-v1-[A-Za-z0-9_-]{20,}$/,
    mistral: /^[A-Za-z0-9_-]{20,}$/,
    deepseek: /^sk-[A-Za-z0-9_-]{20,}$/,
  };
  const rule = checks[provider];
  const ok = rule ? rule.test(value) : value.length >= 16;

  return ok
    ? { ok: true, message: "Key format check passed." }
    : { ok: false, message: "Key format does not match this provider." };
}

async function checkProviderBalance(provider: ProviderSettings, key: string): Promise<ProviderBalanceStatus> {
  if (provider.provider !== "openrouter") {
    return {
      state: "ok",
      message: "Key format is valid. This provider has no local balance endpoint configured yet.",
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch(openRouterKeyInfoUrl, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      return {
        state: response.status === 402 ? "warning" : "error",
        message: `OpenRouter key check failed with HTTP ${response.status}.`,
        checkedAt: new Date().toISOString(),
      };
    }

    const payload = await response.json() as {
      data?: {
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number;
      };
    };
    const limit = payload.data?.limit ?? null;
    const remainingValue = payload.data?.limit_remaining ?? null;
    const remaining = typeof remainingValue === "number" ? remainingValue : undefined;

    return {
      state: remaining === undefined || remaining > 0 ? "ok" : "warning",
      remainingCreditsUsd: remaining,
      message:
        remaining === undefined
          ? `OpenRouter key is valid${limit === null ? " with no configured credit limit" : ""}.`
          : remaining > 0
            ? `OpenRouter credits remaining on this key: $${remaining.toFixed(2)}.`
            : "OpenRouter key limit appears to be exhausted.",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      state: "warning",
      message: "Could not pull OpenRouter credits from this browser. Check the key or network and try again.",
      checkedAt: new Date().toISOString(),
    };
  }
}

function maskKey(value: string): string {
  if (!value || value.includes("...")) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

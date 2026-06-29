const PROVIDER_SECRET_STORAGE_KEY = "icc-go.provider-secrets.v1";

export function readProviderSecret(providerId: string): string {
  return readProviderSecrets()[providerId] ?? "";
}

export function writeProviderSecret(providerId: string, secret: string): void {
  const secrets = readProviderSecrets();
  const trimmed = secret.trim();

  if (trimmed) {
    secrets[providerId] = trimmed;
  } else {
    delete secrets[providerId];
  }

  writeProviderSecrets(secrets);
}

export function deleteProviderSecret(providerId: string): void {
  const secrets = readProviderSecrets();
  delete secrets[providerId];
  writeProviderSecrets(secrets);
}

function readProviderSecrets(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(PROVIDER_SECRET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.trim()),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeProviderSecrets(secrets: Record<string, string>): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PROVIDER_SECRET_STORAGE_KEY, JSON.stringify(secrets));
  } catch {
    // Workspace execution can still fail gracefully if browser storage is unavailable.
  }
}

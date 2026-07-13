export type AppBundleStatus =
  | {
      status: "current";
      currentAsset: string;
      latestAsset: string;
      checkedAt: string;
    }
  | {
      status: "stale";
      currentAsset: string;
      latestAsset: string;
      checkedAt: string;
    }
  | {
      status: "unknown";
      currentAsset?: string;
      latestAsset?: string;
      checkedAt: string;
      error?: string;
    };

export function normalizeAssetPath(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://icc-go.local");
    return url.pathname;
  } catch {
    return value.startsWith("/") ? value : `/${value}`;
  }
}

export function extractViteEntryAssetPath(html: string): string | undefined {
  const scriptMatch =
    html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<script[^>]+src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i);

  return normalizeAssetPath(scriptMatch?.[1]);
}

export function currentDocumentEntryAsset(doc: Document = document): string | undefined {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>("script[type='module'][src]"));
  return scripts
    .map((script) => normalizeAssetPath(script.getAttribute("src") ?? undefined))
    .find((path) => path?.startsWith("/assets/index-"));
}

export async function checkAppBundleFreshness(options: {
  currentAsset?: string;
  fetchHtml?: typeof fetch;
  href?: string;
} = {}): Promise<AppBundleStatus> {
  const checkedAt = new Date().toISOString();
  const currentAsset = options.currentAsset ?? (typeof document !== "undefined" ? currentDocumentEntryAsset(document) : undefined);
  if (!currentAsset) return { status: "unknown", checkedAt, error: "Current app bundle could not be detected." };

  const fetchHtml = options.fetchHtml ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchHtml) return { status: "unknown", currentAsset, checkedAt, error: "Fetch is unavailable." };

  try {
    const response = await fetchHtml(options.href ?? `/?icc_go_update_check=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "text/html" },
    });
    if (!response.ok) {
      return { status: "unknown", currentAsset, checkedAt, error: `Update check failed with HTTP ${response.status}.` };
    }

    const latestAsset = extractViteEntryAssetPath(await response.text());
    if (!latestAsset) return { status: "unknown", currentAsset, checkedAt, error: "Latest app bundle could not be detected." };

    return {
      status: latestAsset === currentAsset ? "current" : "stale",
      currentAsset,
      latestAsset,
      checkedAt,
    };
  } catch (error) {
    return {
      status: "unknown",
      currentAsset,
      checkedAt,
      error: error instanceof Error ? error.message : "Update check failed.",
    };
  }
}

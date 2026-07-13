import { describe, expect, it, vi } from "vitest";
import { checkAppBundleFreshness, extractViteEntryAssetPath, normalizeAssetPath } from "./appUpdate";

describe("app update freshness", () => {
  it("extracts the Vite module entry script from HTML", () => {
    expect(
      extractViteEntryAssetPath('<script type="module" crossorigin src="/assets/index-abc123.js"></script>'),
    ).toBe("/assets/index-abc123.js");
  });

  it("normalizes relative and absolute asset paths", () => {
    expect(normalizeAssetPath("assets/index-a.js")).toBe("/assets/index-a.js");
    expect(normalizeAssetPath("https://app.icc-go.com/assets/index-a.js")).toBe("/assets/index-a.js");
  });

  it("reports a stale app when the latest HTML points at a different entry bundle", async () => {
    const fetchHtml = vi.fn(async () =>
      new Response('<script type="module" crossorigin src="/assets/index-new.js"></script>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const status = await checkAppBundleFreshness({
      currentAsset: "/assets/index-old.js",
      fetchHtml,
    });

    expect(status).toMatchObject({
      status: "stale",
      currentAsset: "/assets/index-old.js",
      latestAsset: "/assets/index-new.js",
    });
  });

  it("reports a current app when the latest HTML uses the running entry bundle", async () => {
    const fetchHtml = vi.fn(async () =>
      new Response('<script type="module" crossorigin src="/assets/index-current.js"></script>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const status = await checkAppBundleFreshness({
      currentAsset: "/assets/index-current.js",
      fetchHtml,
    });

    expect(status).toMatchObject({
      status: "current",
      currentAsset: "/assets/index-current.js",
      latestAsset: "/assets/index-current.js",
    });
  });
});

import { expect, test } from "@playwright/test";
import { createInitialWorkspace } from "../src/domain/fixtures";

test("deleting a notebook with a running cell warns and aborts the provider request", async ({ page }) => {
  const workspace = createInitialWorkspace();
  workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
  workspace.settings.providers[0].modelCatalog = [{ label: "GPT-4o", value: "gpt-4o" }];
  workspace.settings.providers[0].modelCatalogUpdatedAt = new Date().toISOString();
  workspace.settings.providers[0].modelCatalogSource = "provider-api";

  await page.addInitScript((workspaceJson) => {
    window.localStorage.setItem("icc-go.workspace.v1.2", workspaceJson);
    window.localStorage.setItem("icc-go.provider-secrets.v1", JSON.stringify({ provider_openai: "sk-test-openai" }));

    window.__iccGoAbortCount = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url !== "https://api.openai.com/v1/responses") return originalFetch(input, init);

      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          window.__iccGoAbortCount += 1;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    };
  }, JSON.stringify(workspace));

  await page.goto("/", { waitUntil: "networkidle" });
  const firstCell = page.locator(".cell-block").first();
  await expect(firstCell).toBeVisible();
  await firstCell.locator("textarea.unified-editor-input").fill(["> openai.max", "", "Return a short answer."].join("\n"));

  await firstCell.locator('button[title="Run cell"]').click();
  await expect(firstCell.locator(".running-output")).toContainText("Running provider");

  const activeNotebook = page.locator(".notebook-nav-row.is-active");
  await activeNotebook.hover();
  await activeNotebook.locator('button[title="Delete notebook"]').click();

  const dialog = page.getByRole("dialog", { name: "Delete notebook?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 running request is still in progress");
  await expect(dialog).toContainText("will cancel it and discard any pending output");

  await dialog.getByRole("button", { name: "Delete notebook" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__iccGoAbortCount)).toBe(1);
});

declare global {
  interface Window {
    __iccGoAbortCount: number;
  }
}

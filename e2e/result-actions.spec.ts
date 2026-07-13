import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createInitialWorkspace } from "../src/domain/fixtures";

test("cell result actions copy, save, and share the full output", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const workspace = createInitialWorkspace();
  workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";
  workspace.settings.providers[0].modelCatalog = [{ label: "GPT-4o", value: "gpt-4o" }];
  workspace.settings.providers[0].modelCatalogUpdatedAt = "2026-07-07T00:00:00.000Z";
  workspace.settings.providers[0].modelCatalogSource = "provider-api";

  await page.addInitScript((workspaceJson) => {
    window.localStorage.setItem("icc-go.workspace.v1.2", workspaceJson);
    window.localStorage.setItem("icc-go.provider-secrets.v1", JSON.stringify({ provider_openai: "sk-test-openai" }));
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: async (payload: ShareData) => {
        window.__iccGoSharePayload = payload;
      },
    });
  }, JSON.stringify(workspace));

  await page.route("https://api.openai.com/v1/responses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ output_text: "Line one.\nLine two.\nLine three." }),
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const firstCell = page.locator(".cell-block").first();
  await expect(firstCell).toBeVisible();
  await firstCell.locator("textarea.unified-editor-input").fill(["> openai.max", "", "Return three lines."].join("\n"));
  await firstCell.locator('button[title="Run cell"]').click();
  await expect(firstCell.locator(".cell-output")).toContainText("Line three.");

  await firstCell.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(firstCell.locator(".result-action-status")).toContainText("Copied");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Line one.\nLine two.\nLine three.");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    firstCell.getByRole("button", { name: "Save .txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("c1_draft_product_spec_result.txt");
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  await expect.poll(async () => readFile(downloadedPath!, "utf8")).toBe("Line one.\nLine two.\nLine three.");

  await firstCell.getByRole("button", { name: "Share" }).click();
  await expect(firstCell.locator(".result-action-status")).toContainText("Shared");
  await expect
    .poll(() => page.evaluate(() => window.__iccGoSharePayload?.text))
    .toBe("Line one.\nLine two.\nLine three.");
});

test("multi-provider fallback output renders readable section dividers", async ({ page }) => {
  const workspace = createInitialWorkspace();
  const openAi = workspace.settings.providers.find((provider) => provider.provider === "openai");
  const xai = workspace.settings.providers.find((provider) => provider.provider === "xai");
  if (!openAi || !xai) throw new Error("Provider fixtures missing");

  openAi.enabled = true;
  xai.enabled = true;
  openAi.apiKeyMasked = "sk-proj-...test";
  xai.apiKeyMasked = "xai-...test";
  openAi.modelCatalog = [{ label: "GPT-4o", value: "gpt-4o" }];
  openAi.modelCatalogUpdatedAt = "2026-07-07T00:00:00.000Z";
  openAi.modelCatalogSource = "provider-api";
  xai.modelCatalog = [{ label: "Grok 4", value: "grok-4" }];
  xai.modelCatalogUpdatedAt = "2026-07-07T00:00:00.000Z";
  xai.modelCatalogSource = "provider-api";
  workspace.settings.orchestration.synthesisModel = "openai:gpt-4o-mini";

  await page.addInitScript((workspaceJson) => {
    window.localStorage.setItem("icc-go.workspace.v1.2", workspaceJson);
    window.localStorage.setItem(
      "icc-go.provider-secrets.v1",
      JSON.stringify({
        provider_openai: "sk-test-openai",
        provider_xai: "xai-test",
      }),
    );
  }, JSON.stringify(workspace));

  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const body = route.request().postDataJSON();
    if (String(body?.input ?? "").includes("ICC-GO ensemble task")) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "synthesizer unavailable" } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ output_text: "OpenAI candidate answer." }),
    });
  });
  await page.route("https://api.x.ai/v1/chat/completions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "xAI candidate answer." } }] }),
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const firstCell = page.locator(".cell-block").first();
  await expect(firstCell).toBeVisible();
  await firstCell.locator("textarea.unified-editor-input").fill(["> (openai.max + xai.max).ensemble", "", "Return competing answers."].join("\n"));
  await firstCell.locator('button[title="Run cell"]').click();

  await expect(firstCell.locator(".cell-output")).toContainText("OpenAI candidate answer.");
  await expect(firstCell.locator(".cell-output-divider")).toHaveCount(2);
  await expect(firstCell.locator(".cell-output-divider").first()).toContainText("// --- OpenAI / gpt-4o ---");
  await expect(firstCell.locator(".cell-output-divider").nth(1)).toContainText("// --- xAI / grok-4 ---");
});

declare global {
  interface Window {
    __iccGoSharePayload?: ShareData;
  }
}

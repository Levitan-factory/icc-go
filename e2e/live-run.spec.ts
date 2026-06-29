import { expect, test } from "@playwright/test";
import { createInitialWorkspace } from "../src/domain/fixtures";

test("cell run shows a loader, calls the provider adapter, and renders the live result", async ({ page }) => {
  const workspace = createInitialWorkspace();
  workspace.settings.providers[0].apiKeyMasked = "sk-proj-...test";

  await page.addInitScript((workspaceJson) => {
    window.localStorage.setItem("icc-go.workspace.v1.2", workspaceJson);
    window.localStorage.setItem("icc-go.provider-secrets.v1", JSON.stringify({ provider_openai: "sk-test-openai" }));
  }, JSON.stringify(workspace));

  await page.route("https://api.openai.com/v1/responses", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ output_text: "Live browser answer." }),
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const firstCell = page.locator(".cell-block").first();
  await expect(firstCell).toBeVisible();

  await firstCell.locator("textarea.unified-editor-input").fill(["> openai.max", "", "Return a short answer."].join("\n"));

  await expect(firstCell.locator('button[title="Run cell"]')).toHaveCount(1);
  await expect(firstCell.locator('button[title="Run from here"]')).toHaveCount(0);

  await firstCell.locator('button[title="Run cell"]').click();

  await expect(firstCell.locator(".running-output")).toBeVisible();
  await expect(firstCell.locator(".running-output")).toContainText("Running provider");
  await expect(firstCell.locator(".cell-output")).toContainText("Live browser answer.");
  await expect(firstCell.locator(".cell-output")).not.toContainText("Simulated provider run");
});

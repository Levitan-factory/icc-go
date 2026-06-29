import { expect, test, type Page } from "@playwright/test";

const sampleSource = ["> openai.max", "@forward c2", "", "%from c2", "Body"].join("\n");

test.describe("ICC-GO editor suggestions", () => {
  test("route suggestions commit with IDE-style spacing and stay closed until the line is edited", async ({ page }) => {
    await openNotebook(page);
    const source = [">", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, 1);

    const labels = await suggestionLabels(page);
    expect(labels).toContain("openai.max");

    await chooseSuggestion(page, "openai.max");
    await expectFirstEditorLine(page, "> openai.max");
    await expectSuggestionMenuHidden(page);

    const committedSource = await editorValue(page);
    await setCaret(page, committedSource.indexOf("\n"));
    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectFirstEditorLine(page, "> openai.ma");
    expect(await suggestionLabels(page)).toContain("openai.max");
  });

  test("forward suggestions close after selection and return when the target is edited", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai.max", "@forward c", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("\n\n"));

    const labels = await suggestionLabels(page);
    expect(labels).toContain("@forward c2");

    await chooseSuggestion(page, "@forward c2");
    await expectEditorLine(page, 1, "@forward c2");
    await expectSuggestionMenuHidden(page);

    const committedSource = await editorValue(page);
    await setCaret(page, committedSource.indexOf("\n\n"));
    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectEditorLine(page, 1, "@forward c");
    expect(await suggestionLabels(page)).toContain("@forward c2");
  });

  test("exact cell references do not keep an obstructing suggestion menu open", async ({ page }) => {
    await openNotebook(page);
    await setEditorSource(page, sampleSource);
    await setCaret(page, sampleSource.indexOf("\nBody"));

    await expect(page.locator(".routing-suggestion-option")).toHaveCount(0);
  });

  test("manual completed routes keep suggestions closed until the route is edited", async ({ page }) => {
    await openNotebook(page);
    await setEditorSource(page, sampleSource);
    await setCaret(page, sampleSource.indexOf("\n"));

    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectFirstEditorLine(page, "> openai.ma");

    const labels = await suggestionLabels(page);
    expect(labels[0]).toBe("openai.max");
    expect(labels).not.toContain("openai");

    await chooseSuggestion(page, "openai.max");
    await expectFirstEditorLine(page, "> openai.max");
    await expectSuggestionMenuHidden(page);
  });

  test("manual completed OpenRouter routes keep suggestions closed until edited", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openrouter.max", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("\n"));

    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectFirstEditorLine(page, "> openrouter.ma");
    expect(await suggestionLabels(page)).toContain("openrouter.max");
  });

  test("output format suggestions use registered formats and close after selection", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@file -p", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("\n\n"));

    const labels = await suggestionLabels(page);
    expect(labels).toContain("-python");

    await chooseSuggestion(page, "-python");
    await expectEditorLine(page, 1, "@file -python ");
    await expectSuggestionMenuHidden(page);

    const committedSource = await editorValue(page);
    await setCaret(page, committedSource.indexOf("\n\n"));
    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectEditorLine(page, 1, "@file -python");
    expect(await suggestionLabels(page)).toContain("-python");
  });

  test("output format suggestions preserve an existing artifact filename", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@file - file_01.md", "@image - image_01.png", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("@file -") + "@file -".length);

    expect(await suggestionLabels(page)).toContain("-markdown");
    await chooseSuggestion(page, "-markdown");
    await expectEditorLine(page, 1, "@file -markdown file_01.md");
    await expectSuggestionMenuHidden(page);

    const updatedSource = await editorValue(page);
    await setCaret(page, updatedSource.indexOf("@image -") + "@image -".length);

    expect(await suggestionLabels(page)).toContain("-png");
    await chooseSuggestion(page, "-png");
    await expectEditorLine(page, 2, "@image -png image_01.png");
    await expectSuggestionMenuHidden(page);
  });

  test("file format suggestions bridge image outputs to the @image channel", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@file -p file_01.md", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("@file -p") + "@file -p".length);

    const labels = await suggestionLabels(page);
    expect(labels).toContain("-png");

    await chooseSuggestion(page, "-png");
    await expectEditorLine(page, 1, "@image -png file_01.png");
    await expectSuggestionMenuHidden(page);
  });

  test("suggestions can be dismissed and reopen after the current line changes", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@file - file_01.md", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("@file -") + "@file -".length);

    expect(await suggestionLabels(page)).toContain("-markdown");
    await page.locator(".routing-suggestion-close").click();
    await expectSuggestionMenuHidden(page);

    const unchangedSource = await editorValue(page);
    await setCaret(page, unchangedSource.indexOf("@file -") + "@file -".length);
    await expectSuggestionMenuHidden(page);

    await page.keyboard.type("m");
    expect(await suggestionLabels(page)).toContain("-markdown");

    await page.keyboard.press("Escape");
    await expectSuggestionMenuHidden(page);
  });

  test("constraint suggestions open after the < marker and close after selection", async ({ page }) => {
    await openNotebook(page);
    const source = ["<", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, 1);

    const labels = await suggestionLabels(page);
    expect(labels).toContain("cost <= $3.33");
    expect(labels).toContain("latency <= 3m");

    await chooseSuggestion(page, "latency <= 3m");
    await expectFirstEditorLine(page, "< latency <= 3m");
    await expectSuggestionMenuHidden(page);

    const committedSource = await editorValue(page);
    await setCaret(page, committedSource.indexOf("\n"));
    await expectSuggestionMenuHidden(page);

    await page.keyboard.press("Backspace");
    await expectFirstEditorLine(page, "< latency <= 3");
    expect(await suggestionLabels(page)).toContain("latency <= 3m");
  });

  test("@ command suggestions open for valid directive drafts", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("@") + 1);

    await expect(page.locator(".unified-editor-highlight .unified-line").nth(1)).toHaveClass(/directive/);
    let labels = await suggestionLabels(page);
    expect(labels).toContain("@file");
    expect(labels).toContain("@forward");

    await page.keyboard.type("fo");
    await expectEditorLine(page, 1, "@fo");
    labels = await suggestionLabels(page);
    expect(labels).toEqual(["@forward"]);

    await chooseSuggestion(page, "@forward");
    await expectEditorLine(page, 1, "@forward ");
    labels = await suggestionLabels(page);
    expect(labels).toContain("@forward c2");
  });

  test("unknown @ words stay prompt text instead of highlighted directives", async ({ page }) => {
    await openNotebook(page);
    const source = ["> openai", "@anyword", "", "Body"].join("\n");
    await setEditorSource(page, source);
    await setCaret(page, source.indexOf("@anyword") + "@anyword".length);

    await expect(page.locator(".unified-editor-highlight .unified-line").nth(0)).toHaveClass(/route/);
    await expect(page.locator(".unified-editor-highlight .unified-line").nth(1)).toHaveClass(/body/);
    await expectSuggestionMenuHidden(page);
  });

  test("escaped service lines preserve later header highlighting and suggestions", async ({ page }) => {
    await openNotebook(page);
    for (const escapedLine of ["\\> disabled route", "\\< disabled constraint", "\\@text <1000"]) {
      const source = ["> openai.max", "@forward c2", escapedLine, "<", "", "Body"].join("\n");
      await setEditorSource(page, source);
      await setCaret(page, source.indexOf("\n<") + 2);

      await expect(page.locator(".unified-editor-highlight .unified-line").nth(0)).toHaveClass(/route/);
      await expect(page.locator(".unified-editor-highlight .unified-line").nth(1)).toHaveClass(/directive/);
      await expect(page.locator(".unified-editor-highlight .unified-line").nth(2)).toHaveClass(/escaped/);
      await expect(page.locator(".unified-editor-highlight .unified-line").nth(3)).toHaveClass(/constraint/);
      expect(await suggestionLabels(page)).toContain("latency <= 3m");
    }
  });

  test("long pasted text expands the editor without overlay or controls drifting", async ({ page }) => {
    await openNotebook(page);
    const longBody = Array.from({ length: 34 }, (_, index) =>
      `sample_image_${String(index + 1).padStart(2, "0")}.png — normalize this reference into one consistent transparent PNG style.`,
    ).join("\n");
    const source = ["> openai.max", "@image -png output_{01..10}.png", "", longBody].join("\n");

    await setEditorSource(page, source);

    const metrics = await page.locator("textarea.unified-editor-input").first().evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      const highlight = textarea.parentElement?.querySelector(".unified-editor-highlight") as HTMLElement | null;
      const attach = textarea.closest(".cell-block")?.querySelector(".attach-file-button") as HTMLElement | null;
      const textareaRect = textarea.getBoundingClientRect();
      const highlightRect = highlight?.getBoundingClientRect();
      const attachRect = attach?.getBoundingClientRect();

      return {
        clientHeight: textarea.clientHeight,
        scrollHeight: textarea.scrollHeight,
        highlightHeight: highlightRect?.height ?? 0,
        textareaBottom: textareaRect.bottom,
        attachTop: attachRect?.top ?? 0,
      };
    });

    expect(metrics.clientHeight).toBeGreaterThan(224);
    expect(metrics.clientHeight).toBeLessThanOrEqual(720);
    expect(Math.abs(metrics.highlightHeight - metrics.clientHeight)).toBeLessThanOrEqual(1);
    expect(metrics.attachTop).toBeGreaterThan(metrics.textareaBottom);
    expect(await editorValue(page)).toBe(source);
  });
});

async function openNotebook(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("textarea.unified-editor-input").first()).toBeVisible();
}

async function setEditorSource(page: Page, source: string) {
  await page.locator("textarea.unified-editor-input").first().fill(source);
}

async function setCaret(page: Page, index: number) {
  const editor = page.locator("textarea.unified-editor-input").first();
  await editor.evaluate((element, caretIndex) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(caretIndex, caretIndex);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
  }, index);
  await page.waitForTimeout(80);
}

async function editorValue(page: Page): Promise<string> {
  return page.locator("textarea.unified-editor-input").first().inputValue();
}

async function suggestionLabels(page: Page): Promise<string[]> {
  await expect(page.locator(".routing-suggestion-option").first()).toBeVisible();
  return page.locator(".routing-suggestion-option span").allTextContents();
}

async function expectSuggestionMenuHidden(page: Page) {
  await expect(page.locator(".routing-suggestion-option")).toHaveCount(0);
}

async function chooseSuggestion(page: Page, label: string) {
  await page.locator(".routing-suggestion-option").filter({ hasText: label }).first().click();
}

async function expectFirstEditorLine(page: Page, line: string) {
  await expectEditorLine(page, 0, line);
}

async function expectEditorLine(page: Page, index: number, line: string) {
  await expect.poll(async () => {
    const value = await page.locator("textarea.unified-editor-input").first().inputValue();
    return value.split("\n")[index];
  }).toBe(line);
}

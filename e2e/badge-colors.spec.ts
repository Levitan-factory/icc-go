import { expect, test } from "@playwright/test";

test("compact notebook badges keep distinct syntax color families", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.setAttribute("data-testid", "badge-color-fixture");
    fixture.style.position = "absolute";
    fixture.style.left = "-10000px";
    fixture.innerHTML = `
      <span class="chip if">if</span>
      <span class="chip flow">-&gt; c2</span>
      <span class="chip reference">from c1</span>
      <span class="chip artifact">file: markdown</span>
      <span class="chip budget">&lt;1m</span>
    `;
    document.body.appendChild(fixture);
  });

  const styleOf = async (selector: string) => {
    return page.locator(`[data-testid="badge-color-fixture"] ${selector}`).evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        color: style.color,
      };
    });
  };

  const ifChip = await styleOf(".chip.if");
  const flowChip = await styleOf(".chip.flow");
  const referenceChip = await styleOf(".chip.reference");
  const artifactChip = await styleOf(".chip.artifact");
  const budgetChip = await styleOf(".chip.budget");

  expect(ifChip).toEqual(flowChip);
  expect(ifChip).toEqual({
    background: "rgb(245, 240, 255)",
    border: "rgb(234, 223, 255)",
    color: "rgb(109, 51, 212)",
  });
  expect(referenceChip).toEqual({
    background: "rgb(237, 248, 241)",
    border: "rgb(191, 234, 223)",
    color: "rgb(8, 116, 92)",
  });
  expect(artifactChip).toEqual({
    background: "rgb(238, 245, 255)",
    border: "rgb(207, 226, 255)",
    color: "rgb(31, 93, 168)",
  });
  expect(budgetChip).toEqual({
    background: "rgb(255, 245, 220)",
    border: "rgb(245, 221, 164)",
    color: "rgb(155, 101, 11)",
  });
});

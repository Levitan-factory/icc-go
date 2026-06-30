import { describe, expect, it } from "vitest";
import { createInitialWorkspace } from "../domain/fixtures";
import {
  constraintEditorSuggestions,
  createConstraintSuggestions,
  createDirectiveSuggestions,
  createForwardSuggestions,
  createRoutingSuggestions,
  directiveEditorSuggestions,
  forwardEditorSuggestions,
  routingEditorSuggestions,
} from "./CellBlock";

describe("cell editor suggestions", () => {
  it("keeps route suggestions closed for completed provider profile tokens", () => {
    const workspace = createInitialWorkspace();
    const suggestions = createRoutingSuggestions(workspace.settings);
    const visible = routingEditorSuggestions(suggestions, "openai.max").map((suggestion) => suggestion.insertText);

    expect(visible).toEqual([]);
    const profileSuggestions = routingEditorSuggestions(suggestions, "openai.").map((suggestion) => suggestion.insertText);
    expect(profileSuggestions).toContain("openai.max");
    expect(profileSuggestions).not.toContain("openai.ensemble");
  });

  it("keeps OpenRouter suggestions closed for completed explicit models", () => {
    const workspace = createInitialWorkspace();
    const openRouter = workspace.settings.providers.find((provider) => provider.provider === "openrouter");
    if (openRouter) openRouter.enabled = true;

    const suggestions = createRoutingSuggestions(workspace.settings);
    const visible = routingEditorSuggestions(suggestions, "openrouter:openrouter/auto").map((suggestion) => suggestion.insertText);

    expect(visible).toEqual([]);
    expect(routingEditorSuggestions(suggestions, "openrouter:open").map((suggestion) => suggestion.insertText)).toContain(
      "openrouter:openrouter/auto",
    );
  });

  it("keeps forward suggestions closed for a completed @forward directive", () => {
    const suggestions = createForwardSuggestions(["c1", "c2", "c3"], "c1");
    const visible = forwardEditorSuggestions(suggestions, "c2").map((suggestion) => suggestion.insertText);

    expect(visible).toEqual([]);
    expect(forwardEditorSuggestions(suggestions, "c").map((suggestion) => suggestion.insertText)).toEqual([
      "@forward c2",
      "@forward c3",
    ]);
  });

  it("suggests constraint templates after the < control marker", () => {
    const suggestions = createConstraintSuggestions();

    expect(constraintEditorSuggestions(suggestions, "").map((suggestion) => suggestion.insertText)).toEqual([
      "cost <= $3.33",
      "latency <= 3m",
      "tokens <= 50000",
      "iterations <= 3",
    ]);
    expect(constraintEditorSuggestions(suggestions, "lat").map((suggestion) => suggestion.insertText)).toEqual([
      "latency <= 3m",
    ]);
    expect(constraintEditorSuggestions(suggestions, "latency <= 3m")).toEqual([]);
  });

  it("suggests only known @ directives while typing a command", () => {
    const suggestions = createDirectiveSuggestions();

    expect(directiveEditorSuggestions(suggestions, "").map((suggestion) => suggestion.insertText)).toContain("@forward ");
    expect(directiveEditorSuggestions(suggestions, "fo").map((suggestion) => suggestion.insertText)).toEqual([
      "@forward ",
    ]);
    expect(directiveEditorSuggestions(suggestions, "anyword")).toEqual([]);
  });
});

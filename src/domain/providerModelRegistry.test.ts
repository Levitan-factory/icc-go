import { describe, expect, it } from "vitest";
import { chooseAutoModelForProvider } from "./providerModelRegistry";

describe("provider model registry", () => {
  it("keeps provider-only OpenAI routes on the Auto model profile instead of API list order", () => {
    const choices = [
      { label: "GPT-5.5", value: "gpt-5.5" },
      { label: "GPT-5.4 mini", value: "gpt-5.4-mini" },
    ];

    expect(chooseAutoModelForProvider("openai", choices, "default")).toBe("gpt-5.4-mini");
    expect(chooseAutoModelForProvider("openai", choices, "max")).toBe("gpt-5.5");
  });

  it("migrates stale current model ids before validating the provider catalog", () => {
    const choices = [{ label: "GPT-5.4 mini", value: "gpt-5.4-mini" }];

    expect(chooseAutoModelForProvider("openai", choices, "default", "gpt-5.5-mini")).toBe("gpt-5.4-mini");
  });

  it("uses OpenRouter native auto routing for provider-only OpenRouter routes", () => {
    const choices = [
      { label: "Anthropic Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
      { label: "Auto router", value: "openrouter/auto" },
    ];

    expect(chooseAutoModelForProvider("openrouter", choices, "default")).toBe("openrouter/auto");
    expect(chooseAutoModelForProvider("openrouter", choices, "max")).toBe("openrouter/auto");
  });
});

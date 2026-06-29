import { describe, expect, it } from "vitest";
import { configuredOnlineAuthProviders, preferredOnlineAuthProvider } from "./onlineAuth";
import type { OnlineAuthConfig } from "./onlineAuth";

describe("online auth provider selection", () => {
  it("prefers Google when Google is configured", () => {
    const config = { enabled: true, providers: ["COGNITO", "Google"] } satisfies OnlineAuthConfig;

    expect(preferredOnlineAuthProvider(config)).toBe("Google");
  });

  it("uses Apple when Google is not configured", () => {
    const config = { enabled: true, providers: ["SignInWithApple", "COGNITO"] } satisfies OnlineAuthConfig;

    expect(preferredOnlineAuthProvider(config)).toBe("SignInWithApple");
  });

  it("keeps Cognito as an explicit fallback only", () => {
    const config = { enabled: true, providers: ["COGNITO"] } satisfies OnlineAuthConfig;

    expect(preferredOnlineAuthProvider(config)).toBe("COGNITO");
  });

  it("normalizes missing providers to the legacy Cognito fallback", () => {
    expect(configuredOnlineAuthProviders({ enabled: true })).toEqual(["COGNITO"]);
  });
});

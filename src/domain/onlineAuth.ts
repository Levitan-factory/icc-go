export type OnlineAuthProvider = "COGNITO" | "Google" | "SignInWithApple";

export type OnlineAuthConfig = {
  enabled: boolean;
  region?: string;
  userPoolId?: string;
  clientId?: string;
  hostedUiDomain?: string;
  redirectUri?: string;
  logoutUri?: string;
  apiBaseUrl?: string;
  scopes?: string[];
  providers?: OnlineAuthProvider[];
};

export type OnlineAuthUser = {
  sub?: string;
  email?: string;
  name?: string;
  username?: string;
};

export type OnlineAuthSession = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  user: OnlineAuthUser;
};

export const disabledOnlineAuthConfig: OnlineAuthConfig = {
  enabled: false,
  providers: [],
  scopes: ["openid", "email", "profile"],
};

export function isHostedOnlineEnvironment(): boolean {
  return false;
}

export async function loadOnlineAuthConfig(): Promise<OnlineAuthConfig> {
  return disabledOnlineAuthConfig;
}

export async function ensureFreshOnlineSession(_config?: OnlineAuthConfig): Promise<OnlineAuthSession | null> {
  return null;
}

export async function startOnlineSignIn(_config?: OnlineAuthConfig, _provider?: OnlineAuthProvider): Promise<void> {
  throw new Error("Hosted OAuth is not included in the public local-first build.");
}

export async function completeOnlineAuthRedirectIfNeeded(_config?: OnlineAuthConfig): Promise<{ handled: boolean; session?: OnlineAuthSession; error?: string }> {
  return { handled: false };
}

export function configuredOnlineAuthProviders(config: OnlineAuthConfig): OnlineAuthProvider[] {
  return config.providers?.length ? config.providers : ["COGNITO"];
}

export function preferredOnlineAuthProvider(config: OnlineAuthConfig): OnlineAuthProvider {
  const providers = configuredOnlineAuthProviders(config);
  if (providers.includes("Google")) return "Google";
  if (providers.includes("SignInWithApple")) return "SignInWithApple";
  return "COGNITO";
}

export function signOutOnline(_config?: OnlineAuthConfig): void {
  window.location.assign("/");
}

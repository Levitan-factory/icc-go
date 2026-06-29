import type { OnlineAuthConfig, OnlineAuthSession } from "./onlineAuth";

export type OnlineEventInput = {
  eventType: string;
  surface?: string;
  provider?: string;
  detail?: string;
  route?: string;
};

export type AdminDashboard = {
  generatedAt: string;
  retentionDays: number;
  totals: Record<string, number>;
  visitsByDay: Array<Record<string, unknown>>;
  eventsBySurface: Array<Record<string, unknown>>;
  eventsByType: Array<Record<string, unknown>>;
  recentEvents: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
};

export function getOnlineSessionId(): string {
  return "local-public-build";
}

export async function recordOnlineEvent(_config: OnlineAuthConfig, _session: OnlineAuthSession | null, _input: OnlineEventInput): Promise<void> {
  // Hosted telemetry is intentionally excluded from the public local-first build.
}

export async function fetchAdminDashboard(): Promise<AdminDashboard> {
  throw new Error("Hosted admin telemetry is not included in the public local-first build.");
}

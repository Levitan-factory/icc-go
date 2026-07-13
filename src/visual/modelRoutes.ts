import { modelChoicesForProviderSettings } from "../domain/modelCatalog";
import type { ProviderSettings } from "../domain/types";

export type RouteStrategy = "single" | "best" | "ensemble";
export type RouteMember = { providerId: string; choice: string };

const knownRouteProfiles = new Set(["default", "max", "ensemble", "image", "cheap", "fast", "code", "reasoning", "flash"]);

export function parseModelRoute(route: string, providers: ProviderSettings[]): { strategy: RouteStrategy; members: RouteMember[] } {
  const value = route.trim();
  const grouped = value.match(/^\((.+)\)\.(best|ensemble)$/i);
  if (grouped) {
    const members = grouped[1].split("+").map((part) => parseRouteMember(part.trim(), providers)).filter((member): member is RouteMember => Boolean(member));
    if (members.length) return { strategy: grouped[2].toLowerCase() as Exclude<RouteStrategy, "single">, members };
  }

  const enabled = providers.filter((provider) => provider.enabled);
  const fallback = enabled.length ? enabled : providers;
  const shorthand = value.toLowerCase();
  if (shorthand === "best" && fallback.length) {
    return { strategy: "best", members: fallback.slice(0, 2).map((provider) => ({ providerId: provider.id, choice: "profile:default" })) };
  }
  if (["auto", "max", "ensemble", "image", "cheap", "fast", "code"].includes(shorthand) && fallback[0]) {
    return { strategy: "single", members: [{ providerId: fallback[0].id, choice: `profile:${shorthand === "auto" ? "default" : shorthand}` }] };
  }

  const member = parseRouteMember(value, providers);
  return { strategy: "single", members: member ? [member] : fallback[0] ? [{ providerId: fallback[0].id, choice: "profile:default" }] : [] };
}

export function buildModelRoute(strategy: RouteStrategy, members: RouteMember[], providers: ProviderSettings[]): string {
  const rendered = members.map((member) => {
    const provider = providers.find((candidate) => candidate.id === member.providerId);
    if (!provider) return "";
    const alias = provider.alias.trim() || provider.label.trim() || provider.id;
    if (member.choice.startsWith("model:")) return `${alias}:${member.choice.slice("model:".length)}`;
    const profile = member.choice.startsWith("profile:") ? member.choice.slice("profile:".length) : "default";
    return profile === "default" ? alias : `${alias}.${profile}`;
  }).filter(Boolean);
  if (!rendered.length) return "auto";
  if (strategy === "single") return rendered[0];
  return `(${rendered.join(" + ")}).${strategy}`;
}

export function choiceTitle(provider: ProviderSettings, choice: string): string {
  if (choice.startsWith("model:")) {
    const value = choice.slice("model:".length);
    return modelChoicesForProviderSettings(provider).find((model) => model.value.toLowerCase() === value.toLowerCase())?.label ?? value;
  }
  const profile = choice.startsWith("profile:") ? choice.slice("profile:".length) : "default";
  return profile === "default" ? "Auto" : profile.charAt(0).toUpperCase() + profile.slice(1);
}

export function choiceDetail(provider: ProviderSettings, choice: string): string {
  if (choice.startsWith("model:")) return `Specific model · ${choice.slice("model:".length)}`;
  const profile = choice.startsWith("profile:") ? choice.slice("profile:".length) : "default";
  const model = profileModel(provider, profile);
  return model ? `Resolves to ${model}` : `ICC ${profile} profile`;
}

function parseRouteMember(expression: string, providers: ProviderSettings[]): RouteMember | undefined {
  const normalized = expression.trim().toLowerCase();
  const provider = [...providers].sort((left, right) => longestProviderName(right) - longestProviderName(left)).find((candidate) => routeProviderNames(candidate).some((name) => {
    const key = name.toLowerCase();
    return normalized === key || normalized.startsWith(`${key}.`) || normalized.startsWith(`${key}:`);
  }));
  if (!provider) return undefined;

  const name = routeProviderNames(provider).sort((left, right) => right.length - left.length).find((candidate) => {
    const key = candidate.toLowerCase();
    return normalized === key || normalized.startsWith(`${key}.`) || normalized.startsWith(`${key}:`);
  }) ?? provider.alias;
  const suffix = expression.trim().slice(name.length);
  if (suffix.startsWith(":")) return { providerId: provider.id, choice: `model:${suffix.slice(1)}` };
  if (suffix.startsWith(".")) {
    const profile = suffix.slice(1).toLowerCase();
    return { providerId: provider.id, choice: knownRouteProfiles.has(profile) ? `profile:${profile}` : `model:${suffix.slice(1)}` };
  }
  return { providerId: provider.id, choice: "profile:default" };
}

function routeProviderNames(provider: ProviderSettings): string[] {
  return Array.from(new Set([provider.alias, provider.label, provider.id, provider.provider].map((value) => value.trim()).filter(Boolean)));
}

function longestProviderName(provider: ProviderSettings): number {
  return Math.max(0, ...routeProviderNames(provider).map((name) => name.length));
}

function profileModel(provider: ProviderSettings, profile: string): string {
  if (profile === "max") return provider.maxModel;
  if (profile === "ensemble") return provider.ensembleModel;
  if (profile === "image") return provider.imageModel;
  if (profile === "cheap") return provider.cheapModel;
  if (profile === "fast") return provider.fastModel;
  if (profile === "code") return provider.codeModel;
  return profile === "default" ? provider.defaultModel : "";
}

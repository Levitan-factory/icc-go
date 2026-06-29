import {
  dslCatalogEntries,
  dslCatalogGroups,
  entrySortKey,
  getDslAlphabeticalIndex,
  getDslEntriesByGroup,
  getPlannedDslEntries,
  getSupportedDslEntries,
  LANGUAGE_VERSION_LABEL,
  type DslCatalogEntry,
  type DslCatalogGroup,
  type DslCatalogGroupId,
} from "../../language/latest";

export type LanguageWikiEntry = DslCatalogEntry;
export type LanguageWikiGroup = DslCatalogGroup;
export type LanguageWikiGroupId = DslCatalogGroupId;

export const languageWiki = {
  title: "ICC DSL Wiki",
  languageVersion: LANGUAGE_VERSION_LABEL,
  groups: dslCatalogGroups,
  entries: dslCatalogEntries,
};

export function getLanguageWikiEntriesByGroup(groupId: LanguageWikiGroupId): LanguageWikiEntry[] {
  return getDslEntriesByGroup(groupId);
}

export function getLanguageWikiAlphabeticalIndex(): LanguageWikiEntry[] {
  return getDslAlphabeticalIndex();
}

export function getSupportedLanguageWikiEntries(): LanguageWikiEntry[] {
  return getSupportedDslEntries();
}

export function getPlannedLanguageWikiEntries(): LanguageWikiEntry[] {
  return getPlannedDslEntries();
}

export function languageWikiEntrySortKey(entry: LanguageWikiEntry): string {
  return entrySortKey(entry);
}

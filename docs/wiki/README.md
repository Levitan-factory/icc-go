# ICC DSL Wiki

The ICC DSL wiki is a presentation layer over the latest language catalog.

## Current Layout

```text
src/docs/wiki/
  languageWiki.ts
```

The UI component `src/components/DslCatalogView.tsx` reads from `src/docs/wiki/languageWiki.ts`.

## Rules

- The wiki does not define language behavior.
- The wiki does not own parser constants.
- The wiki should read from `src/language/latest`.
- Grouped pages and alphabetical index are generated from catalog entries.
- Planned initial-spec items can be shown as `planned`, but must not be described as supported until the parser/runtime supports them.

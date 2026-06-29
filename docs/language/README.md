# ICC DSL

ICC is the DSL used by ICC-GO Notebook. It is versioned separately from notebook UI code.

## Current Layout

```text
src/language/
  v1_01/
    version.ts
    parser.ts
    catalog.ts
    *.test.ts
  v1_03/
    version.ts
    parser.ts
    catalog.ts
    formatRegistry.ts
    *.test.ts
  v1_04/
    version.ts
    parser.ts
    catalog.ts
    formatRegistry.ts
    *.test.ts
  v1_2/
    version.ts
    parser.ts
    catalog.ts
    *.test.ts
  latest/
    index.ts
```

## Rules

- Current ICC DSL implementation: `src/language/v1_04`.
- `src/language/v1_2` is retained as a legacy pre-ICC package for compatibility tests and future migrations.
- A concrete ICC DSL version lives in `src/language/vX_Y`.
- Parser behavior, language constants, catalog entries, and tests live together in that version folder.
- The notebook app imports language APIs only from `src/language/latest`.
- Provider names used by routing commands are workspace aliases. Built-in provider ids remain the fallback vocabulary,
  but the notebook passes current settings aliases into the parser.
- When a new ICC version is added, create a new `vX_Y` folder and repoint `src/language/latest/index.ts`.
- Do not import a concrete language version from notebook UI/runtime code unless you are writing migration code.

## Version Change Checklist

1. Add parser/runtime support in a versioned language folder.
2. Add or update catalog entries in the same folder.
3. Add tests in the same folder.
4. Update `src/language/latest/index.ts` when the new version becomes current.
5. Update wiki wording only if the documentation shell changes.
6. Run the repository-level version consistency check before build/deploy.
7. Commit language, tests, wiki behavior, and notebook compatibility together.

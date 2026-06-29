# Language Architecture

The in-app language wiki is generated from the current versioned language catalog.

Open it from:

```text
Help -> ICC DSL Wiki
Help -> ICC Index
```

## Source Of Truth

The ICC catalog is structured data, not hand-written prose. The current language entrypoint is:

```text
src/language/latest
```

The current concrete implementation is:

```text
src/language/v1_04
```

Each catalog entry defines:

- group;
- support status;
- symbol;
- name;
- summary;
- syntax;
- examples;
- notes;
- language version;
- parser/runtime coverage;
- source in the specification.

The documentation screen builds the grouped wiki view and the alphabetical index from that catalog.

## Maintenance Workflow

Whenever ICC-GO adds a new ICC operator, function, reference, status, provider capability, parser rule, or workspace-level command:

1. Implement parser/runtime support.
2. Add or update the catalog entry in the same `src/language/vX_Y` folder.
3. Add parser/catalog tests in the same language version folder.
4. Update `src/language/latest/index.ts` when a new language version becomes current.
5. Commit the parser, catalog, tests, wiki behavior, and language version together.

The tests in `src/language/vX_Y` are intentionally strict about parser constants such as providers, profiles, operators, reference fields, and registered output formats. If those change without catalog updates, the test suite should fail.

## Current Groups

- Routing
- Constraints
- Flow
- Outputs And Artifacts
- References
- Syntax Rules
- Providers And Profiles
- Statuses And Errors
- Planned From Initial Spec

## Planned Items

Initial-spec concepts that are not yet interpreted by the current parser are still documented in the generated wiki with `planned` status. They should not be described as supported until the parser/runtime understands them.

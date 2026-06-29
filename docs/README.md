# ICC-GO Documentation

ICC-GO is an Intent-Cell Coding notebook for executable LLM workflows.

The documentation is split by how people actually use it:

- Articles explain the method and product decisions.
- Reference pages define syntax and controls precisely.
- Examples show complete copyable patterns.
- Demo assets show the notebook flow for public release materials.

## Recommended Reading

1. Start with `articles/intent-cell-coding.md` to understand the method.
2. Open `Help -> ICC DSL Wiki` while writing cells.
3. Use `reference/workspace.md` for menus, shortcuts, exports, and settings.
4. Copy from `examples/` when building real workflows.
5. Use `assets/icc-go-60s-demo.gif` when introducing the notebook in public release notes.

## Minimal Cell

```text
> openai
< cost <= $0.50
@text <800

Summarize this research note into claims, evidence, risks, and next actions.
```

Only leading service lines are parsed as the control header. Everything after the first normal text line or blank boundary is prompt body.

## Sections

| Section | Purpose |
|---|---|
| Articles | Methodology, design rationale, and product concepts. |
| Reference | Generated ICC DSL wiki, alphabetical index, notebook controls, statuses, and exports. |
| Examples | Copyable patterns for common workflows. |

## Generated ICC Docs

The ICC wiki is generated from the versioned language catalog, not maintained as free-form markdown. When a new ICC function is added, add it to a concrete language version under `src/language/vX_Y` together with parser/runtime support and tests. The notebook imports `src/language/latest`, and the in-app docs show the latest language in the grouped wiki and alphabetical index.

## Current Pages

### Articles

- Intent-Cell Coding

### Reference

- ICC DSL Wiki
- Alphabetical Index
- Workspace Reference

### Maintenance

- Language architecture: `docs/language/README.md`
- Wiki architecture: `docs/wiki/README.md`

### Examples

- Basic Intent Cell
- Branching Workflow
- Artifact Output
- Text Blocks
- Release notebooks in `../examples/*.icc`
- 60-second demo GIF in `assets/icc-go-60s-demo.gif`

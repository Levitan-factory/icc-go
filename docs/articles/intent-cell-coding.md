# Intent-Cell Coding

Intent-Cell Coding is a notebook approach for building LLM workflows as reproducible intent units.

In a normal chat, intent, model choice, constraints, branching, references, outputs, and files are mixed into one conversation stream. In Intent-Cell Coding, each cell makes those parts explicit while staying readable:

- intent lives in the prompt body;
- provider/model routing lives in `>`;
- hard execution limits live in `<`;
- flow logic lives in `@`;
- dependencies live in ICC `%` references such as `%from c2`, `%from c2.pnl`, and `%file.c3:name.ext`;
- machine-readable results live in parsed variables;
- durable outputs live in generated artifacts.

The result is a workflow that still feels like writing, but can be parsed, validated, rerun, inspected, branched, versioned, and shared.

## Core Principles

1. A cell is an intent, not just a message.
2. The control header should stay small and readable.
3. The prompt body should remain natural text or code.
4. Branching must be deterministic when it affects workflow execution.
5. Artifacts are first-class outputs, not copied text blobs.
6. Stale state must be visible when upstream intent changes.
7. Text blocks explain the notebook, but do not participate in execution.
8. The notebook should explain itself through inspection, not visual graph clutter.

## ICC-GO

ICC-GO is the first implementation of this approach.

- `ICC`: the Intent-Cell Coding approach and the native DSL syntax.
- `GO`: execution, movement, and workflow progress.

The product should stay light: modern notebook, precise DSL, reliable execution state, and artifacts that can move forward into the next cell.

## Intent Cells vs Text Blocks

Intent cells are executable and receive aliases such as `c1`, `c2`, and `c3`. They can be referenced, routed, branched, run, and exported with run history.

Text blocks are narrative markdown. They are useful for explanations, section headings, assumptions, and research notes. They do not receive `cN` aliases and are ignored by runs, references, validation, and cost estimates.

# Branching Workflow

Use branching when a workflow must move to different next cells based on a deterministic variable.

```text
> claude.max
< tokens <= 50000
@text <800

Evaluate whether the strategy is worth implementation.

Return variables:
decision=accept|reject
confidence=0..1

Input:
%from c2
```

```text
> auto
@if confidence >= 0.75 -> c4
@else -> c5

Route the workflow based on the previous evaluation.
```

## Notes

- `@if` reads parsed variables from the current cell output.
- Missing variables produce `decision_error`.
- Branching should stay deterministic. Do not branch on prose that requires interpretation.

## Recommended Output Shape

Ask the model to return simple variables when a later cell needs to branch:

```text
decision=accept
confidence=0.82
risk=medium
```

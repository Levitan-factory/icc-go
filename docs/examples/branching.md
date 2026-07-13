# Branching Workflow

Use branching when a workflow must move to different next cells based on a deterministic variable.

`@if` is evaluated after the current cell finishes. It reads variables parsed from that same cell's output. It does not make a model call by itself, and it does not read a prior cell unless the current cell references that prior cell and emits a parseable variable.

## Recommended Pattern

```text
# c2
> claude.max
@if confidence >= 0.75 -> c4
@else -> c5
@text <800

Evaluate whether the draft from %from c1 is ready for implementation.

Return exactly parseable lines:
confidence = <number from 0 to 1>
decision = accept|reject
reason = <short rationale>
```

In this pattern:

- `%from c1` provides prior context to the model.
- `confidence = ...` is produced by the current cell output.
- `@if confidence >= 0.75 -> c4` is evaluated deterministically after that output exists.

## JSON Output Also Works

```text
{
  "confidence": 0.82,
  "decision": "accept",
  "reason": "The implementation risk is low enough for a first build."
}
```

## Notes

- `@if` reads parsed variables from the current cell output.
- Missing or unparseable variables produce `decision_error`.
- `@else` belongs to the preceding `@if`; it is not a standalone command.
- Branching should stay deterministic. Do not branch on prose that requires interpretation.
- Direct file branch targets such as `@if accepted -> file:report.md` are planned, not current syntax. Use a target cell that declares `@file`.

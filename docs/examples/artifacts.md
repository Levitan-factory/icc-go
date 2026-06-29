# Artifact Output

Use artifacts when a cell should produce a durable file instead of only inline text.

```text
> claude.max
< tokens <= 50000
@file -python strategy_code.py
@text <300

Write Python strategy code for the accepted hypothesis.

Requirements:
- keep exchange-specific constants isolated
- expose a `run_one(...)` function
- include a short smoke-test block

Input:
%from c2
```

## Artifact References

Later cells can reference generated artifacts:

```text
> openai
@text <900

Review this code for correctness and hidden assumptions:

%file.c3:strategy_code.py
```

## Good For

- code files
- markdown reports
- CSV tables
- JSON payloads
- SQL queries
- patches and diffs
- generated images via `@image`

## Image Outputs

Image outputs are declared with `@image`, not `@file`. ICC-GO uses the selected provider route for this channel; attached image files are passed as visual references when that provider adapter supports them.

```text
> openrouter.max
@image -png output_{01..10}.png

Use the attached reference images as style samples.
Create ten new transparent PNG assets in one consistent visual style.
```

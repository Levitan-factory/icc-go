# Basic Intent Cell

Use this pattern when one cell should produce one clear result.

```text
> openai
< cost <= $0.50
< latency <= 2m
@text <1200

Summarize the research note below into:

- core claim
- supporting evidence
- weak assumptions
- next action

Input:
%from c1
```

## Why It Works

- Routing is explicit: `> openai`.
- Cost and latency are bounded before the prompt runs.
- The model is asked to keep visible text within 1200 characters with `@text <1200`.
- The prompt body stays readable and can contain normal markdown.

## Good For

- summarization
- critique
- classification
- extracting fields from a prior cell
- short research passes

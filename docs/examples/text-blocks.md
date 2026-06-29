# Text Blocks

Text blocks are narrative markdown between executable intent cells.

They are useful for:

- section headings
- assumptions
- research context
- manual observations
- explanations for future readers
- separating phases of a workflow

## Example

```markdown
## 3. Run one configuration

Pick parameters you want, then call `run_one(...)`.

Outputs:

- `backtest.info`: text metrics table
- `backtest.png`: PnL and position chart
- `backtest_table.png`: rendered metrics image
```

## Execution Rules

- Text blocks do not receive `cN` aliases.
- Text blocks are ignored by runs.
- Text blocks are ignored by validation and cost estimates.
- Text blocks are included in exports as readable notebook narrative.

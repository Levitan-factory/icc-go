# Workspace Reference

This page covers notebook-level controls, menus, shortcuts, and exports.

## Menus

| Menu | Control | Meaning |
|---|---|---|
| File | New Project | Create a project in the sidebar. |
| File | New Notebook | Create a notebook in the active project. |
| File | Duplicate Notebook | Copy the active notebook into the active project. |
| File | Save | Persist current workspace state to local storage. |
| File | Save Snapshot | Store a named notebook restore point. |
| File | Import Notebook | Import an `.iccgo.json` export into the active project. |
| File | Export Notebook | Download a ZIP package with notebook JSON, Markdown, run history, snapshots, and artifacts. |
| Edit | Copy Notebook as Markdown | Copy the full notebook as Markdown. |
| Edit | Find / Go to Cell | Search aliases, text blocks, prompts, outputs, vars, stale notes, and artifacts. |
| Insert | Intent Cell Below | Insert an executable intent cell after the selected block. |
| Insert | Text Block Below | Insert a non-executable markdown block after the selected block. |
| Run | Run Current Cell | Execute the selected intent cell. |
| Run | Run All | Execute all intent cells in notebook order. |
| Run | Validate Notebook | Validate ICC syntax and common notebook risks. |
| View | Compact / Expanded Mode | Change intent cell density. |
| Tools | Open Syntax Cheat Sheet | Show a compact ICC reference. |
| Tools | Settings | Open full-page workspace settings at `/settings`. |
| Sidebar | Delete Project | Delete a project after confirmation. |
| Help | Documentation | Open the documentation browser at `/docs`. |
| Help | ICC DSL Wiki | Open the latest generated ICC wiki at `/docs#language-reference`. |
| Help | ICC Index | Open the generated A-Z ICC index at `/docs#alphabetical-index`. |
| Help | Intent-Cell Coding | Open the article about the method. |
| Help | Examples | Open copyable workflow examples. |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + S` | Save. |
| `Cmd/Ctrl + Z` | Undo. |
| `Cmd/Ctrl + Shift + Z` | Redo. |
| `Cmd/Ctrl + F` | Find / Go to cell. |
| `Cmd/Ctrl + Enter` | Run current intent cell. |
| `Shift + Enter` | Run current intent cell. |
| `Alt + Enter` | Add intent cell below selected block. |
| `Cmd/Ctrl + D` | Duplicate selected block. |
| `Cmd/Ctrl + E` | Export notebook ZIP. |
| `Cmd/Ctrl + /` | Show keyboard shortcuts. |

## Exports

- `.iccgo.json`: structured notebook data, including intent cells, text blocks, parsed headers, output state, and artifact references.
- `.md`: readable transcript with narrative text blocks and executed cell sections.
- `.zip`: notebook JSON, Markdown, run history, snapshots, and generated artifacts.

## Provider Keys And Fallback Order

- Settings -> API keys lets you add one provider key at a time with `+ Add key`.
- Each key has a provider type, display label, routing alias, masked key reference, health/balance status, and enabled toggle.
- Provider type names the API vendor, such as OpenAI, Anthropic, or OpenRouter. Alias names what you type in ICC.
- Fallback follows the visible order from top to bottom. Move keys with the arrow controls.
- The default Anthropic key can keep alias `claude`, because Claude is the model family. Example: a DeepSeek key can be named `chinese` and called as `> (claude + chinese).best`.
- `Check only` validates the pasted key and, where available, pulls a live balance. It does not link the key. Use `Bind key` to save the masked local reference and the last verified balance.
- OpenRouter is supported as a single-key multi-model provider. The OpenRouter alias names the key, and the model id after `:` names the model inside OpenRouter.
- Routing rule: alias selects the key, `:` selects a concrete model id inside that key, and `.` selects an ICC provider profile such as `.max`, `.fast`, `.cheap`, or `.code`.
- `> openai.max` uses the saved OpenAI key and its max profile.
- `> openrouter.max` uses the saved OpenRouter key and its max profile. The default OpenRouter max model is `openrouter/auto`.
- `> openrouter:openai/gpt-4o` uses the saved OpenRouter key to call the OpenAI model id through OpenRouter.
- `> openrouter:anthropic/claude-sonnet-4.5` and `> openrouter:deepseek/deepseek-chat:free` are valid explicit OpenRouter routes.
- `> openrouter.openai.max` is not ICC syntax. Use `:` for an explicit OpenRouter model id.
- If the OpenRouter alias is renamed to `router`, write `> router.max` or `> router:openai/gpt-4o`.
- `.ensemble` is a group orchestration mode, not a provider profile. Write `> (openai + claude).ensemble`; do not write `> openai.ensemble`.
- OpenRouter native routing can use explicit model ids such as `openrouter:openrouter/auto`. Settings -> Orchestration controls the selector model used by ICC-GO for `.best` groups and the ensemble model used by ICC-GO for `.ensemble` groups when routing is handled by the notebook runtime.
- If a key balance check fails or a provider reports no available balance, ICC-GO shows a notebook-level warning until the setting is corrected or rechecked.

## Maintenance Rule

Whenever ICC-GO adds a menu action, shortcut, settings control, export format, sidebar behavior, or notebook-level capability, update this page in the same change.

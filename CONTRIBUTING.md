# Contributing to ICC-GO

ICC-GO is the local-first notebook for Intent-Cell Coding. Contributions should keep notebooks reproducible, inspectable, and safe to run with user-owned provider keys.

Before opening a pull request:

1. Run `npm test`.
2. Run `npm run build`.
3. Add or update an example notebook when behavior changes.
4. Keep hosted OAuth, telemetry, and deployment infrastructure out of this public repository.
5. State which ICC DSL version the change depends on.

Live provider tests are optional and require local environment variables. Never commit API keys.

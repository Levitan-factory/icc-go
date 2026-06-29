# Release Notes and Compatibility

ICC-GO releases must declare the supported stable ICC DSL version. The current public local-first release targets ICC DSL v1.04.

Release checks:

- Public README starts with a runnable demo.
- Example notebooks parse with the current language runtime.
- Unit tests and build pass.
- Public export excludes hosted OAuth, telemetry, deployment scripts, and secrets.
- Live provider checks are run by maintainers before announcement.

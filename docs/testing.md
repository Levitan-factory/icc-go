# Testing ICC-GO

Run the local deterministic suite:

```bash
npm ci
npm test
npm run build
```

Optional live provider tests require environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, and `OPENROUTER_API_KEY`.

```bash
RUN_LIVE_PROVIDER_TESTS=1 RUN_LIVE_IMAGE_TESTS=1 npm run test -- providerExecution.live
RUN_LIVE_RELEASE_NOTEBOOKS=1 npm run test -- releaseExamples.live
```

Never commit live keys. Live tests are intended for maintainers and local release verification.

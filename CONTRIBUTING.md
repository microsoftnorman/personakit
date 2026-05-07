# Contributing to Personakit

Thanks for your interest! Personakit is an early-stage spec + reference
implementation. The bar is moving fast — please open an issue before sending
large PRs.

## Dev setup

```bash
npm install
npm run build -w personakit-mcp
npm test -w personakit-mcp
```

## Working on the MCP server

The server lives under `packages/personakit-mcp/`. Use the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) for ad-hoc
testing:

```bash
npx @modelcontextprotocol/inspector node packages/personakit-mcp/dist/index.js
```

## Working on skills and agents

Files under `plugins/personakit/skills/` and `plugins/personakit/agents/`
follow the conventions from [github/copilot-plugins](https://github.com/github/copilot-plugins).
Keep `SKILL.md` frontmatter in sync with `.github/plugin/marketplace.json`.

## Style

- TypeScript, ESM, strict mode.
- vitest for tests; mock the LLM client — never hit a real model in unit tests.
- Anything that touches the filesystem must go through `src/store/` so the
  sandbox guard applies.
- Anything that calls a model must go through `src/llm/client.ts` so the audit
  log captures it.

## License

By contributing you agree your contributions are licensed under the [MIT
License](./LICENSE).

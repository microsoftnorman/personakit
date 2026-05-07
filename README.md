# Personakit — Getting Started

> Synthetic customers for GitHub Copilot. Generate market-research-grounded
> persona agents, interview them, run multi-persona panels, and let a Product
> Manager Orchestrator turn the feedback into pricing and a complete
> go-to-market plan.

Personakit is a [GitHub Copilot plugin](https://github.com/github/copilot-plugins)
that turns Copilot into a synthetic-customer engine. This guide gets you from
zero to a first persona conversation in about three minutes.

For internals, the safety model, the full tool catalog, and worked examples,
see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## What you get

- **6 skills** that auto-activate in Copilot Chat (bootstrap, generate
  personas, interview, panel, PM review, go-to-market).
- **3 custom agents** — a `pm-orchestrator`, an `adversarial-pm`, and a
  `persona-template` that's cloned per generated persona so you can chat 1:1.
- **`personakit-mcp`** — an MCP server that owns the sandboxed persona store,
  research ingestion, panel orchestration, scoring, pricing synthesis, and
  GTM plan generation.

---

## Prerequisites

- **git**
- **Node.js ≥ 18** + **npm**
- An LLM credential (any one of):
  - `GITHUB_MODELS_TOKEN` *(recommended for Copilot users — no extra account)*
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
- Copilot host (e.g., VS Code Insiders + GitHub Copilot Chat) for the
  skills/agents experience. The MCP server also runs standalone — see
  [Example 7 in ARCHITECTURE.md](./ARCHITECTURE.md#example-7--direct-mcp-usage-no-copilot-host).

The installer below auto-detects your OS and package manager and prints exact
install commands for anything missing.

---

## 1. Install (one line)

From the root of the project you want Personakit to live in:

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/install.ps1 | iex
```

The installer:

1. Detects your OS + package manager and **dependency-checks** `git`,
   `node ≥ 18`, and `npm`. Missing tools? It prints an OS-specific install
   command and exits without touching your machine.
2. Clones the repo into `./.personakit-plugin/`.
3. Runs `npm install` and builds `personakit-mcp`.
4. Writes `.vscode/mcp.json` registering the MCP server (won't overwrite an
   existing one — prints a merge snippet instead).
5. Reports whether an LLM credential is set.

Optional environment variables before the pipe:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PERSONAKIT_DIR` | `./.personakit-plugin` | Where to clone |
| `PERSONAKIT_REF` | `main` | Git ref to check out |
| `PERSONAKIT_NO_VSCODE` | unset | Set to `1` to skip the `.vscode/mcp.json` write |

> ⚠️ **Read before piping anything into your shell.** Inspect
> [`scripts/install.sh`](./scripts/install.sh) and
> [`scripts/install.ps1`](./scripts/install.ps1) first if your security
> policy requires it.

---

## 2. Set your LLM credential

```bash
# macOS / Linux
export GITHUB_MODELS_TOKEN="<your token>"
```

```powershell
# Windows
$env:GITHUB_MODELS_TOKEN = "<your token>"
```

Reload your editor so it picks up the new MCP server registration.

---

## 3. Try it in Copilot Chat

The skills auto-activate. Just talk to Copilot in plain English. Here's the
canonical first-run sequence using the bundled
[Tessera example](./examples/saas-project-management-tool/) (a fictional
mid-market PM SaaS):

```text
You: Set up personakit using the example project at
     examples/saas-project-management-tool.

You: Generate 5 personas from the research-inputs folder.

You: Interview Maya about an auto-Gantt feature idea.

You: Run a panel with all 5 personas on auto-Gantt.

You: Have the PM orchestrator produce pricing and a GTM plan.
```

Each step writes its artifacts under `./.personakit/` in your workspace
(personas, transcripts, pricing drafts, GTM plans, audit log).

> **What does the output actually look like?** See the seven worked transcripts
> in [`ARCHITECTURE.md → Worked examples`](./ARCHITECTURE.md#worked-examples) —
> they cover bootstrap, single-persona interviews, panel discussions, PM
> orchestrator reviews, the GTM plan with the safety gate, what happens when
> the safety gate fires, and direct MCP usage.

---

## 4. Update later

Re-checks dependencies, fetches `origin/main`, and rebuilds only if there are
new commits. Refuses to run if the plugin directory has uncommitted changes.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.sh | bash
```

```powershell
# Windows
iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/update.ps1 | iex
```

Set `PERSONAKIT_FORCE=1` to rebuild even when already up-to-date.

---

## 5. Health check (`doctor`)

Read-only diagnostic. Reports on dependencies, LLM credentials, plugin clone
state (incl. how many commits behind `origin/main` you are), build output,
`.vscode/mcp.json` registration, and `.personakit/` sandbox stats. Exits 0
when everything is green.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.sh | bash
```

```powershell
# Windows
iwr -useb https://raw.githubusercontent.com/microsoftnorman/personakit/main/scripts/doctor.ps1 | iex
```

---

## Manual install (if you'd rather)

```bash
git clone https://github.com/microsoftnorman/personakit.git
cd personakit
npm install
npm run build -w personakit-mcp
```

Then install the plugin into Copilot the same way you would any
[github/copilot-plugins](https://github.com/github/copilot-plugins) plugin,
and set one of the LLM credential env vars above.

---

## Safety, in one paragraph

Every artifact lives under `<workspace>/.personakit/` (the MCP server refuses
writes outside it). Research is PII-anonymized before storage. Personas use
demographic *ranges*, never real individuals. **No GTM plan is presented
without surviving an adversarial-review gate** — and if every critic agrees,
Personakit refuses to ship the plan ("if every POC survives, your filter is
broken"). Every tool call is appended to a daily JSONL audit log with secrets
scrubbed. None of these are flags; there is no "unsafe mode". Full design
rationale in [`ARCHITECTURE.md → Safety guardrails`](./ARCHITECTURE.md#safety-guardrails).

---

## Where to next

| Want to… | Read |
| --- | --- |
| See realistic Copilot transcripts of the full flow | [`ARCHITECTURE.md → Worked examples`](./ARCHITECTURE.md#worked-examples) |
| Understand the skill / agent / MCP-server split | [`ARCHITECTURE.md → System diagram`](./ARCHITECTURE.md#system-diagram) |
| Browse the 11 tools and their schemas | [`ARCHITECTURE.md → Tool catalog`](./ARCHITECTURE.md#tool-catalog) |
| See exactly what gets written to `.personakit/` | [`ARCHITECTURE.md → The .personakit/ sandbox`](./ARCHITECTURE.md#the-personakit-sandbox) |
| Add a tool, skill, or agent | [`ARCHITECTURE.md → Extending Personakit`](./ARCHITECTURE.md#extending-personakit) |
| Read the source pattern this plugin implements | [*One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/) |

---

## License

[MIT](./LICENSE).

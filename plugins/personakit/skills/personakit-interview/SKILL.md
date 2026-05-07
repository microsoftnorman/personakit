---
name: personakit-interview
description: Interview a single synthetic persona 1:1, sustained across turns via a session id. USE THIS SKILL when the user wants to talk to ONE persona by name - "ask Maya about X", "interview Devin about Y", "what would Priya say about Z", "talk to <persona>", "let me chat with <persona>". For multi-persona discussions, use the personakit-panel skill instead.
allowed-tools: Read
---

# Personakit Interview Skill

## Overview

This skill calls the `interview_persona` MCP tool to ask one persona a question
in their voice. Pass the same `sessionId` across calls to maintain conversation
history; the tool appends each turn to `.personakit/transcripts/<sessionId>.md`.

For users who want to drop into a sustained 1:1 chat, hand off to the
persona's custom Copilot agent (`persona-<id>.agent.md` under
`.personakit/agents/`). The agent uses the same dossier as its system prompt.

**Important**: Personas are SYNTHETIC ARCHETYPES. They speak in first person
but are not real people. Do not treat their answers as ground truth — treat
them as well-grounded hypotheses to validate with real customers.

## When to use

| User says | Action |
| --------- | ------ |
| "Ask Maya whether she'd use auto-Gantt" | `interview_persona` with `personaId: "maya"`, single turn |
| "Let me have a conversation with Devin about API design" | Hand off to the `persona-devin` agent OR call `interview_persona` repeatedly with the same `sessionId` |
| "What would Priya think of our $50/seat tier?" | `interview_persona`, with `context` set to the pricing brief |

## Common Scenarios

| User goal | How to respond | Tools needed |
| --------- | -------------- | ------------ |
| Single quick question | One `interview_persona` call, no `sessionId` (auto-generated) | MCP |
| Sustained conversation | First call returns a `sessionId`; reuse it on follow-ups | MCP |
| Question grounded in a feature brief | Pass the brief in `context` | MCP |
| Drop into the persona's voice for a long chat | Suggest user invoke the `persona-<id>` agent directly | Agent handoff |

## Steps

1. Identify the persona by name. If ambiguous, call `list_personas` and ask
   the user to pick.
2. Decide single-turn vs sustained:
   - Single turn → one `interview_persona` call.
   - Sustained → first call generates a `sessionId`; tell the user, and use
     the same id on follow-ups.
3. If the user is asking about a specific feature/idea, pass the description
   in `context`.
4. Render the persona's answer to the user. Note the transcript path.

## Example

```
User: Ask Maya whether she'd use auto-Gantt.

Agent: Calling interview_persona for Maya…

  Maya (Mid-market Ops Director):
  > Honestly? Maybe. My team already lives in spreadsheets and we tried
  > four Gantt tools in the last two years. The reason none stuck was
  > onboarding — if I have to ask my PMs to learn another view, they'll
  > revolt. If your auto-Gantt populates from the data we already enter
  > and I can ship it without training, I'll pilot it. If it's a separate
  > module, no.

  Transcript: .personakit/transcripts/int-maya-20260507-141233-a8f2k1.md
  Session id: int-maya-20260507-141233-a8f2k1

  To follow up with the same context, say:
    "Ask Maya a follow-up in session int-maya-20260507-141233-a8f2k1: ..."
```

## Safety notes

- The persona's response is a synthesized hypothesis, not real customer
  testimony. Label it as such when sharing externally.
- The transcript is sandboxed under `.personakit/transcripts/`.

## Learn more

- [Personakit README](../../README.md)

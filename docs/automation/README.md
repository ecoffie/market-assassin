# Operations Automation Blueprint

> Internal Codex/agent automation plan for GovCon Giants and Market Assassin operations.

This folder turns recurring work into reusable assets:

- [Skills](./skills.md) - reusable thinking/writing workflows.
- [Tools & Plugins](./tools-plugins.md) - integrations and APIs needed for reliable execution.
- [Agents](./agents.md) - autonomous multi-step operators.
- [Missing Markdown Sections](./missing-md-sections.md) - doc sections to add to canonical runbooks.
- [Build Plan](./build-plan.md) - recommended implementation order.

## Asset Types

| Type | Use When | Example |
|---|---|---|
| Skill | The work is mostly reasoning, writing, QA, or a repeatable checklist | Campaign packet builder |
| Tool/plugin | The work needs external systems, database access, APIs, or deterministic execution | Supabase ops tool |
| Agent | The work needs autonomy, scheduling, orchestration, and decisions across multiple steps | Daily briefings operations agent |

## Rule Of Thumb

- If a person can do it by reading docs and producing structured output, make it a skill.
- If Codex needs live data or mutation, make it a tool/plugin.
- If it needs to run end-to-end with monitoring, branching, retries, and reporting, make it an agent.


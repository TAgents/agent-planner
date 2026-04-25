# BUGS

Tracker for bugs and rough edges in agent-planner-api that aren't yet captured as plans or PRs. Add new entries to the top.

## Open

### `import_plan_markdown` MCP tool throws "Cannot read properties of undefined (reading 'id')"

- **Reported:** 2026-04-26
- **Reporter:** Claude Code session, after a different agent failed to use the tool to create a plan from a markdown outline
- **Severity:** Medium — agents fall back to `create_plan` + many `create_node` calls (slow + fragile), but the well-known MCP tool advertised in the older surface is unusable

**Repro:** Call `import_plan_markdown` with a structured markdown body and either a `goal_id` or no goal:

```
import_plan_markdown({
  markdown: "# Test Import\n\nQuick test plan.\n\n## Phase 1\n\n- Task A\n- Task B\n\n## Phase 2\n\n- Task C\n"
})
→ Error: Cannot read properties of undefined (reading 'id')
```

A markdown body with no `##` phases / `-` tasks returns the (correct) error `No phases or tasks found`, so the parser at least runs. The `undefined.id` failure happens with the structure the tool's own schema documents (`# title`, `## phase`, `- task`).

**Context — the tool was deliberately removed in v0.9.0 BDI redesign.** From `agent-planner-mcp/docs/MIGRATION_v0.9.md` § "Tools removed (no replacement in v0.9.0)": *"These are admin-shaped and meant for humans editing structure manually. They are scheduled to return as `ap_admin_*` namespace in v1.0.0."* Newer MCP clients running v0.9.0+ won't see this tool. But:

1. Hosted/older deployments still expose the legacy tool surface.
2. When called against any deployment that still serves it, it crashes — so the fallback path *for users on the old surface* is broken.
3. There's no REST equivalent (`grep -r importMarkdown agent-planner/src/routes` → no matches), so REST fallback isn't an option either.

**Suspected cause:** The legacy v0.8.x handler likely calls `create_plan` then dereferences something like `plan.id` on a response shape that changed (e.g., the API now returns `{plan: {...}}` instead of the plan object directly, or returns nothing on validation failure). The shape drift between the legacy handler and the current API is the most likely culprit.

**Workaround:** `create_plan` followed by `create_node` per phase + per task. The other agent in this thread did exactly that and it worked, just verbosely.

**Resolution path:**

1. Short term: confirm no v0.9.0+ deployment still advertises this tool (it shouldn't).
2. v1.0.0: implement under the planned `ap_admin_*` namespace with a server-side parser + a single batch-create call to avoid N round-trips.
3. Consider adding a REST endpoint (`POST /api/plans/import-markdown`) so non-MCP clients can use it too.

**Where to look first:**
- Whatever deployment is serving the failing tool — the legacy handler that wraps `create_plan` and then reads `.id` from the response
- `agent-planner-mcp/docs/MIGRATION_v0.9.md` for the official migration guidance
- Whether to even keep the legacy tool advertised on hosted deployments while v0.9.x rolls out

---

### `quick_log` MCP tool returns 400 where `add_log` succeeds with equivalent payload

- **Reported:** 2026-04-25
- **Reporter:** Claude Code session (during ap CLI BDI integration on agent-planner-mcp branch `feat/ap-cli-v1-core-loop`)
- **Severity:** Low — workaround available

**Repro:** Call `quick_log` via MCP with a valid `plan_id`, `task_id`, `log_type: "progress"`, and a `message` string. Server responds 400.

```
quick_log({
  plan_id: "d1d3fba5-8d92-40e9-861f-f2ca4cea65be",
  task_id: "638eb366-4ea1-4534-979e-6911c24bde03",
  log_type: "progress",
  message: "..."
})
→ Error: Request failed with status code 400
```

The same data sent through `add_log` (with `node_id` instead of `task_id` and `content` instead of `message`) succeeds and creates the log entry — see entry `6e1d95eb-eda5-4082-8252-0f0e71a134d8` on the dogfood task.

**Suspected cause:** Field-name mismatch between the `quick_log` MCP wrapper and the underlying log endpoint, OR the `progress` log_type is not accepted by the route `quick_log` calls. Reproduced twice with different message lengths — content size is not the trigger.

**Workaround:** Use `add_log` directly. Same effect, same `log_type` enum.

**Where to look first:**
- `agent-planner-mcp/src/tools.js` — the `quick_log` handler and how it shapes the request
- `agent-planner/src/routes/*.routes.js` and `*.controller.v2.js` — the log endpoint validation (likely Zod schema in `validation/`)
- Compare with how `add_log` formats its payload to the same backend

---

## Closed

_(none yet)_

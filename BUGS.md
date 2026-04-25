# BUGS

Tracker for bugs and rough edges in agent-planner-api that aren't yet captured as plans or PRs. Add new entries to the top.

## Open

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

#!/usr/bin/env bash
# Smoke test for the local AgentPlanner stack.
#
# Verifies: API, Frontend, MCP healthchecks; creates a throwaway plan via the
# REST API; confirms the ap CLI can read its context. Intended to be run after
# `docker compose -f docker-compose.local.yml up`.
#
# Usage:
#   ./scripts/smoke-localhost.sh <api-token>
#
# Pass an API token created in the local UI (Settings → API Tokens). The token
# is sent as `Authorization: ApiKey <token>` to all REST calls.
#
# Exit code 0 = all checks passed. Non-zero = something is wrong; check the
# preceding log lines for the failing step.

set -uo pipefail

API_URL="${API_URL:-http://localhost:3000}"
UI_URL="${UI_URL:-http://localhost:3001}"
MCP_URL="${MCP_URL:-http://localhost:3100}"
TOKEN="${1:-}"

PASS=0
FAIL=0

ok()   { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }
info() { echo "       $1"; }

if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <api-token>"
  echo "  Create a token in the local UI at $UI_URL → Settings → API Tokens"
  exit 2
fi

# Strip trailing slashes from URLs so url-joins are predictable.
API_URL="${API_URL%/}"
UI_URL="${UI_URL%/}"
MCP_URL="${MCP_URL%/}"

echo "Smoke test against:"
echo "  API : $API_URL"
echo "  UI  : $UI_URL"
echo "  MCP : $MCP_URL"
echo

# ── 1. Healthchecks ──────────────────────────────────────────────────
api_health=$(curl -sS -o /dev/null -w '%{http_code}' "$API_URL/health" || echo 000)
if [ "$api_health" = "200" ]; then ok "API /health → 200"; else fail "API /health → $api_health (expected 200)"; fi

ui_health=$(curl -sS -o /dev/null -w '%{http_code}' "$UI_URL/" || echo 000)
if [ "$ui_health" = "200" ]; then ok "Frontend / → 200"; else fail "Frontend / → $ui_health (expected 200)"; fi

# MCP exposes /.well-known/mcp.json or /health depending on transport. Try /health first.
mcp_health=$(curl -sS -o /dev/null -w '%{http_code}' "$MCP_URL/health" || echo 000)
if [ "$mcp_health" = "200" ]; then
  ok "MCP /health → 200"
else
  mcp_disc=$(curl -sS -o /dev/null -w '%{http_code}' "$MCP_URL/.well-known/mcp.json" || echo 000)
  if [ "$mcp_disc" = "200" ]; then
    ok "MCP /.well-known/mcp.json → 200"
  else
    fail "MCP /health and /.well-known/mcp.json both unreachable (last codes: $mcp_health / $mcp_disc)"
  fi
fi

# ── 2. Auth: token works against the API ─────────────────────────────
auth_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: ApiKey $TOKEN" "$API_URL/plans" || echo 000)
if [ "$auth_status" = "200" ]; then
  ok "API /plans with token → 200"
else
  fail "API /plans with token → $auth_status (expected 200)"
  info "Likely cause: token created in a different backend (e.g. agentplanner.io) or token expired."
  echo
  echo "Stopping early — fix auth before continuing."
  exit 1
fi

# ── 3. Create a throwaway plan via REST ──────────────────────────────
plan_response=$(curl -sS \
  -H "Authorization: ApiKey $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST "$API_URL/plans" \
  -d '{"title":"smoke-test plan","description":"created by smoke-localhost.sh; safe to delete"}' || echo '')

plan_id=$(echo "$plan_response" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n1)

if [ -n "$plan_id" ]; then
  ok "Created throwaway plan: $plan_id"
else
  fail "Plan creation returned no id"
  info "Raw response: $plan_response"
fi

# ── 4. Read the plan back to confirm persistence ─────────────────────
if [ -n "$plan_id" ]; then
  read_status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: ApiKey $TOKEN" "$API_URL/plans/$plan_id" || echo 000)
  if [ "$read_status" = "200" ]; then
    ok "GET /plans/$plan_id → 200"
  else
    fail "GET /plans/$plan_id → $read_status"
  fi
fi

# ── 5. CLI can pull context (only if ap binary is on PATH) ───────────
if command -v agent-planner-mcp >/dev/null 2>&1; then
  cli_dir=$(mktemp -d)
  pushd "$cli_dir" >/dev/null

  # The CLI reads the saved config from `ap login`; just check that ap context
  # works against this throwaway plan with the token in env.
  if [ -n "$plan_id" ]; then
    ctx_output=$(USER_API_TOKEN="$TOKEN" API_URL="$API_URL" \
      agent-planner-mcp context --plan-id "$plan_id" --dir "$cli_dir" 2>&1) || true
    if [ -f "$cli_dir/.agentplanner/context.json" ]; then
      ok "CLI wrote .agentplanner/context.json"
    else
      fail "CLI did not produce .agentplanner/context.json"
      info "Note: the CLI uses ~/.agentplanner/config.json from \`ap login\`, not env vars."
      info "Run: agent-planner-mcp login --api-url $API_URL --token \$TOKEN"
      info "Output: $ctx_output"
    fi
  fi

  popd >/dev/null
  rm -rf "$cli_dir"
else
  info "agent-planner-mcp not on PATH — skipping CLI context check."
  info "Install with: npm install -g agent-planner-mcp"
fi

# ── 6. Cleanup: delete the throwaway plan ────────────────────────────
if [ -n "$plan_id" ]; then
  del_status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: ApiKey $TOKEN" \
    -X DELETE "$API_URL/plans/$plan_id" || echo 000)
  if [ "$del_status" = "200" ] || [ "$del_status" = "204" ]; then
    ok "Deleted throwaway plan"
  else
    info "Could not delete throwaway plan $plan_id (status $del_status). Delete it via the UI when convenient."
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────
echo
echo "Result: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

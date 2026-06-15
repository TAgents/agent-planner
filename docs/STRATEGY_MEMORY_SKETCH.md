# Strategy Memory (Ideas) — Design Sketch

**Status:** proposal / pre-implementation. Reviewable before any code.

## The reframe

The product is **agent strategy memory** — the system of record for human–agent *strategic intent before execution*. The pain it removes: agents jump from vague intent straight to expensive execution, and the reasoning in between is invisible and non-reusable. Ideas are the durable strategy layer that holds that reasoning — **not** another backlog object.

This is a stronger market position than "AI planning tool": *AgentPlanner produces better plans because it reasons through persistent, knowledge-grounded directions first.*

## Conceptual model

A clean three-tier hierarchy that keeps Plans from becoming the dumping ground for half-formed strategy:

> **Goal** (*why* — the outcome) → **Idea** (*which direction* — the strategy memory) → **Plan** (*how* — committed execution)

```
Workspace / Goal Knowledge
        │ generates / supports
        ▼
      IDEAS  ──researched & refined──▶  Planning Prompt (refined_prompt)
        │                                       │
        │                                gated by Commit Decision
        │                                       ▼
        │                              Plan / RPI planning run
        │                                       │
        └────────── outcome feeds back ◀────────┘
                 (idea quality + future blueprint candidates)
```

Knowledge feeds Ideas; Ideas crystallize into Plans (or Goals); plan outcomes feed back into idea quality. The loop is the point.

## The `idea` entity

Scoped to a **workspace** (required), optionally to a **goal**.

```
idea {
  id
  workspace_id        NOT NULL            -- always lives in a workspace
  goal_id             NULLABLE            -- set → graduates to a Plan; null → can graduate to a Goal
  title
  body                                    -- the direction, human-readable
  rationale                               -- why it matters (agent-authored, human-editable)
  refined_prompt      NULLABLE            -- the sharp planning prompt; required to reach `refined`
  status              -- captured | researching | refined | committed | parked | discarded
  score               NULLABLE            -- advisory triage signal (0..1)
  score_source        -- agent | human
  source              -- agent | human | seeded
  created_by
  stale_at            NULLABLE            -- set when staleness decay flags it
  spawned_plan_id     NULLABLE            -- provenance once a planning run produces a plan
  spawned_goal_id     NULLABLE            -- (fast-follow) if it graduated to a goal
  created_at, updated_at
}

idea_knowledge_ref { idea_id, episode_id, note }   -- evidence the idea is grounded in
```

No prompt-library / blueprint fields yet — see Deferred.

## Lifecycle

```
captured ──(research: attach knowledge)──▶ researching ──(refine: write refined_prompt)──▶ refined
                                                                                              │
                                                              commit (creates a Decision) ────┤
                                                                                              ▼
                                                                                          committed
                                                                                              │
                                                              decision approved → planning run → plan
   any active state ──park──▶ parked        any active state ──discard(reason)──▶ discarded
   parked/discarded ──revive──▶ captured
```

- **captured → researching/refined requires evidence** — ≥1 `knowledge_ref`, or an explicit "no relevant knowledge; hypothesis X" note. Refinement must cite what it's grounded in.
- **refined → committed is the gate** (see below). Commit-readiness = `refined` (has `refined_prompt` + evidence + rationale). Score is triage only, never the gate.
- **parked** leaves the active board but is kept; **discarded** carries a reason. Nothing is hard-deleted — the graveyard of considered directions is itself strategy memory.

## The commit gate: an Idea action that *creates* a Decision

Do **not** model "Ideas are Decisions" — that overloads the decision system. Model `commit` as an **Idea action that creates a Decision** referencing the idea:

```
commit_idea(idea_id):
  create Decision { type: 'commit_idea', ref_idea_id, title, options: [approve, reject] }
  idea.status = committed            -- pending the decision's resolution
resolve Decision:
  approve → start RPI/planning run with idea.refined_prompt → on completion set idea.spawned_plan_id
  reject  → idea.status = refined (or parked, with reason)
```

The Decision Queue stays the human steering inbox (reuse its UX), but the Idea owns the transition and the lifecycle. **Commit creates a planning *run*, not a finished plan** — the plan is the run's output (as draft for review).

## UI: a strategy board, not a task board

Surface name: **Strategy** (Ideas are the cards inside it). "Ideas" alone sounds lightweight; the feature is "before we spend agent time, decide what direction is worth pursuing."

- **Goal detail → Strategy tab** — the idea board for this goal, columns by lifecycle (Captured · Researching · Refined · Committed · Parked/Discarded). Cards show the prompt, score, **knowledge chips** (evidence), age/staleness.
- **Workspace → Strategy board** — cross-goal directions; can graduate to a Goal or a Plan.
- **Commit gate appears in the existing Decision Queue** (Mission/Dashboard) — humans steer where they already look.
- History/stale/discarded are filters on the same board — nothing lost, revivable.
- Agent-first: agents populate + refine; humans steer via commit / park / "research this".

## Autopilot integration

Two beats in the goal-pursuit loop:
- **Ideate** — for a goal lacking direction: `recall_knowledge(scope)` → generate 1–3 ideas (captured) with `knowledge_refs` → refine the strongest → `commit_idea` (queues the gate). Replaces "jump straight to a full plan."
- **Groom** — flag stale ideas, enforce the active-idea cap, fold plan outcomes back into idea scores. Keeps the board from rotting without human weeding.

## MVP scope

1. `idea` entity + `idea_knowledge_ref` (migration, DAL, repository).
2. Lifecycle + actions: `propose_idea`, `research_idea` (attach knowledge), `refine_idea` (set `refined_prompt`), `commit_idea` (creates Decision), `park`/`discard`/`revive`. REST + MCP tools.
3. **Goal → Strategy tab** and **Workspace → Strategy board** (read-mostly, agent-populated, human-steered).
4. Commit → Decision → on approve, run the **existing** planning flow (`form_intention`/RPI) with `refined_prompt`.
5. Dogfood on `Ship AgentPlanner Publicly`.

**First milestone proves:** AgentPlanner creates better plans because it reasons through persistent, knowledge-grounded directions first.

## Resolved design questions

1. **Goal-tied vs becomes-a-goal** — workspace-scoped, optional `goal_id`; goal-idea→Plan, workspace-idea→Goal. MVP ships idea→Plan; idea→Goal is fast-follow (schema ready).
2. **"Good enough" to commit** — structural bar (`refined_prompt` + evidence + rationale), not a score threshold. Human commit is the judgment.
3. **Score/rationale ownership** — agent proposes (score + rationale), human overrides at the gate; `score_source`/`created_by` recorded.
4. **Commit → plan vs run** — a planning **run**; the plan is its output.
5. **Evidence before refine** — ≥1 `knowledge_ref` or an explicit no-evidence hypothesis note.
6. **Anti-graveyard** — staleness decay + active-idea cap (forcing function) + park/discard-with-reason + outcome feedback + an autopilot groom beat.

## Deferred (do not build yet)

- **Generative blueprints / prompt library.** A second-order win. First prove captured→refined→committed ideas produce better plans; *then* promote successful prompts into a library. Building prompt-management software before knowing which prompts are worth managing is premature.
- **idea→goal graduation UI** (schema ready; surface later).
- **Cross-workspace idea templates.**

## Open forks for review

- **Surface name:** "Strategy" vs "Directions" vs "Ideas".
- **Active-idea cap** default (per goal? per workspace? what number?).
- **Staleness TTL** default (14 vs 30 days).
- **Should `refine` be a human-gated step too**, or fully agent-autonomous (with the commit gate as the only human checkpoint)?

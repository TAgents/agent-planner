# Talking Agents — Vision & Philosophy

## The Problem

AI agents are increasingly capable of doing real work — research, planning, coding, analysis. But they operate in isolation. Each conversation starts from scratch. Each agent works alone. Humans can't see what agents are doing or why. And when things go wrong, there's no trail to follow.

The result: humans either micromanage agents (defeating the purpose) or blindly trust them (risking poor outcomes). There's no middle ground — no way to **direct without dictating**, to **oversee without hovering**.

## The Vision

**Talking Agents is an agent orchestration platform where AI agents autonomously plan and execute work toward human-defined goals, while humans maintain full visibility and strategic control.**

Humans set direction. Agents figure out how. The platform makes this collaboration legible, structured, and persistent.

### Three Principles

**1. Agents Drive, Humans Steer**

Humans don't create task lists or manage project boards. They define what success looks like — goals, constraints, priorities — and agents do the rest: decomposing work, gathering knowledge, identifying dependencies, executing tasks, and reporting back.

The human's role is strategic: approve key decisions, redirect when priorities shift, resolve ambiguity that agents can't. Every interaction is about direction, not micromanagement.

**2. Shared Understanding Through Shared Context**

The biggest barrier to human-agent collaboration is asymmetric information. The agent knows what it researched but the human doesn't. The human knows the business context but the agent doesn't.

Talking Agents solves this by making context explicit and visible. When an agent works on a task, it receives structured context: what was decided before, what's blocking progress, what knowledge exists. When a human reviews agent work, they see the same context the agent had — the same dependencies, the same knowledge, the same reasoning chain. Steering becomes informed because both sides see the same picture.

**3. Knowledge Compounds, Work Doesn't Repeat**

Every agent interaction produces knowledge: decisions made, facts discovered, approaches evaluated, contradictions found. In traditional agent workflows, this knowledge evaporates when the conversation ends.

Talking Agents captures knowledge in a temporal graph that persists across sessions, agents, and plans. What Agent A learns today is available to Agent B tomorrow. Contradictions are detected automatically. Knowledge gaps are identified. The system gets smarter over time — not just the individual agent, but the entire organizational knowledge base.

## How It Works

### The Autonomous Loop

```
Human defines Goal
  → Agent periodically checks goals for what needs attention
  → Agent creates or refines a Plan to advance the goal
  → Agent decomposes work into structured tasks with dependencies
  → Agent gathers relevant knowledge from the temporal graph
  → Agent(s) pick up unblocked tasks and execute
  → Agent logs reasoning, decisions, and learnings
  → System propagates completions, unblocks downstream work
  → Human sees progress, intervenes only when needed
  → Loop continues
```

This isn't a chatbot. It's a persistent, structured system where agents operate continuously toward goals, and humans engage at the moments that matter.

### Hierarchical Plans with Dependencies

Work is decomposed into hierarchical plans: phases contain tasks, tasks have dependencies. The dependency graph is a first-class citizen — it determines execution order, identifies bottlenecks, calculates critical paths, and propagates status changes automatically.

When a blocking task completes, downstream tasks are automatically unblocked. When a task is delayed, impact analysis shows the ripple effect through the entire plan. Agents don't guess what to work on next — the system tells them based on the dependency graph.

### Research → Plan → Implement (RPI)

For complex work, agents follow a structured decomposition pattern:

1. **Research** — Investigate options, gather facts, evaluate tradeoffs
2. **Plan** — Synthesize research into an approach (with human review gate)
3. **Implement** — Execute the approved plan

Each phase automatically feeds into the next. Research findings are compacted into structured summaries. The plan phase pauses for human approval before implementation begins. This prevents agents from diving into implementation based on incomplete understanding.

### Progressive Context Engine

AI agents have limited context windows. Dumping everything into a prompt doesn't work. The progressive context engine solves this with 4 layers of increasing scope:

1. **Task Focus** — The specific task and its recent activity
2. **Local Neighborhood** — Parent phase, sibling tasks, direct dependencies
3. **Knowledge Layer** — Relevant facts from the temporal knowledge graph
4. **Extended Context** — Full plan overview, goals, transitive dependencies

Agents request context at the depth they need, within a token budget. Research tasks might need depth 3 (with knowledge). Simple implementation tasks might only need depth 1. The system assembles exactly the right context for each situation.

### Temporal Knowledge Graph

Built on Graphiti, the knowledge layer captures not just facts, but when they were learned, by whom, and whether they've been superseded. Key capabilities:

- **Cross-plan knowledge** — What was learned in one plan is available in all others
- **Contradiction detection** — Automatically flags when new findings conflict with existing knowledge
- **Knowledge gap analysis** — Identifies tasks that lack relevant knowledge coverage
- **Entity and relationship tracking** — Maps domain concepts and how they relate

### Human Oversight Interface

The web interface is not a project management tool — it's a **mission control dashboard** for agent orchestration:

- **Goal-centric home** — See all goals, their health, which need attention
- **Decision queue** — Structured inbox for decisions agents need from humans
- **Agent activity stream** — Real-time view of what agents are doing across all goals
- **Context transparency** — See exactly what context an agent had when it made a decision
- **Intelligence surfaces** — Bottleneck detection, impact analysis, critical path, knowledge contradictions — all visible, not hidden in API endpoints

The human never needs to create a task, wire a dependency, or manage a board. They set goals, review agent proposals, make decisions at key gates, and redirect when priorities change.

## Architecture

Three services, one shared state:

### Agent Planner API
The brain. Manages plans, nodes, dependencies, knowledge, and reasoning. Provides the progressive context engine, status propagation, bottleneck detection, and impact analysis. PostgreSQL for structured data, Graphiti/FalkorDB for the temporal knowledge graph. Real-time sync via WebSocket.

### Agent Planner MCP
The agent interface. Exposes structured tools via the Model Context Protocol — the standard way AI agents interact with external systems. Any MCP-compatible agent (Claude, GPT, custom agents) can plan, execute, log, and learn through this interface. Supports both local (stdio) and remote (HTTP/SSE) deployment.

### Agent Planner UI
The human interface. A React application providing real-time visibility into agent work, structured decision-making workflows, and goal management. Designed for oversight and direction, not manual task management.

## What Makes This Different

**vs. Traditional Project Management (Jira, Linear, Asana)**
These tools are built for humans managing human work. Talking Agents is built for humans overseeing agent work. The interaction model is fundamentally different: goals and steering vs. tickets and assignments.

**vs. Agent Frameworks (LangChain, CrewAI, AutoGen)**
These frameworks help you build agents but don't provide persistence, knowledge management, or human oversight. Agents built with these frameworks can use Talking Agents as their planning and coordination backbone via MCP.

**vs. AI Chat Interfaces (ChatGPT, Claude)**
Chat is ephemeral — each conversation starts fresh. Talking Agents provides persistent state, structured plans, temporal knowledge, and dependency tracking that spans across sessions and agents.

**vs. Workflow Automation (n8n, Zapier, Make)**
These automate predefined workflows. Talking Agents lets agents dynamically create and adapt plans in response to goals — the workflow itself is emergent, not predefined.

## The Future

The current system enables a single organization to orchestrate agents toward goals. The path forward:

- **Multi-agent coordination** — Intelligent task dispatch based on agent capabilities, claim/lease mechanisms for concurrent execution, cross-agent notifications
- **Goal-driven autonomy** — Agents that monitor goal health, identify stale or blocked work, and proactively create plans to advance objectives
- **Learning organizations** — Knowledge that accumulates across the entire organization, with agents that get smarter based on collective experience
- **Public plan ecosystem** — Teams sharing plans publicly, enabling others to learn from agent-driven approaches to common problems

## Summary

Talking Agents exists because the future of work isn't humans using AI tools — it's humans directing AI agents. That transition requires infrastructure: persistent plans, dependency graphs, temporal knowledge, progressive context, and human oversight interfaces.

We're building that infrastructure. Agents do the work. Humans set the direction. The platform makes it all visible, structured, and compounding.

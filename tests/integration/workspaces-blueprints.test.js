/**
 * Integration Tests — Workspaces + Blueprints
 *
 * Covers:
 *  - Workspace CRUD + archive/restore
 *  - Default-workspace guard
 *  - Blueprint snapshot from a live plan (save_as)
 *  - Plan-scope blueprint fork into a workspace
 *  - fork_count increments on fork
 *
 * Prerequisites:
 *   docker compose -f docker-compose.local.yml up -d
 *   export API_TOKEN=<JWT or API key>
 *
 * Run:
 *   npx jest tests/integration/workspaces-blueprints.test.js --runInBand
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_TOKEN}`,
  };
}

async function api(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const describeIfToken = API_TOKEN ? describe : describe.skip;
const testId = Date.now().toString(36);

describeIfToken('Workspaces + Blueprints', () => {
  let organizationId;
  let workspaceId;
  let secondaryWorkspaceId;
  let planId;
  let blueprintId;
  let forkedPlanId;

  beforeAll(async () => {
    const { data: orgs } = await api('/organizations');
    if (!orgs?.organizations?.length) {
      throw new Error('Test user has no organizations — cannot run workspace tests');
    }
    organizationId = orgs.organizations[0].id;
  });

  afterAll(async () => {
    if (forkedPlanId) await api(`/plans/${forkedPlanId}`, { method: 'DELETE' });
    if (blueprintId) await api(`/blueprints/${blueprintId}`, { method: 'DELETE' });
    if (planId) await api(`/plans/${planId}`, { method: 'DELETE' });
    if (secondaryWorkspaceId) await api(`/workspaces/${secondaryWorkspaceId}`, { method: 'DELETE' });
    if (workspaceId) await api(`/workspaces/${workspaceId}`, { method: 'DELETE' });
  });

  describe('Workspace CRUD', () => {
    it('POST /workspaces creates a workspace → 201', async () => {
      const { status, data } = await api('/workspaces', {
        method: 'POST',
        body: {
          organization_id: organizationId,
          title: `Test Workspace ${testId}`,
          description: 'integration test',
        },
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.organizationId).toBe(organizationId);
      expect(data.slug).toMatch(/test-workspace/);
      expect(data.isDefault).toBe(false);
      workspaceId = data.id;
    });

    it('POST /workspaces requires organization_id and title → 400', async () => {
      const { status: s1 } = await api('/workspaces', { method: 'POST', body: { title: 'x' } });
      expect(s1).toBe(400);
      const { status: s2 } = await api('/workspaces', { method: 'POST', body: { organization_id: organizationId } });
      expect(s2).toBe(400);
    });

    it('GET /workspaces?organization_id=… lists workspaces → 200', async () => {
      const { status, data } = await api(`/workspaces?organization_id=${organizationId}`);
      expect(status).toBe(200);
      expect(Array.isArray(data.workspaces)).toBe(true);
      expect(data.workspaces.some((w) => w.id === workspaceId)).toBe(true);
    });

    it('GET /workspaces/:id includes goalCount + planCount → 200', async () => {
      const { status, data } = await api(`/workspaces/${workspaceId}`);
      expect(status).toBe(200);
      expect(data.id).toBe(workspaceId);
      expect(data).toHaveProperty('goalCount');
      expect(data).toHaveProperty('planCount');
    });

    it('PATCH /workspaces/:id updates title → 200', async () => {
      const { status, data } = await api(`/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: { title: `Updated Workspace ${testId}` },
      });
      expect(status).toBe(200);
      expect(data.title).toBe(`Updated Workspace ${testId}`);
    });

    it('POST /workspaces/:id/archive then /restore → 200', async () => {
      const { status: archiveStatus, data: archived } = await api(`/workspaces/${workspaceId}/archive`, {
        method: 'POST',
      });
      expect(archiveStatus).toBe(200);
      expect(archived.archivedAt).toBeTruthy();

      const { status: restoreStatus, data: restored } = await api(`/workspaces/${workspaceId}/restore`, {
        method: 'POST',
      });
      expect(restoreStatus).toBe(200);
      expect(restored.archivedAt).toBeNull();
    });

    it('Creating a second is_default fails when one already exists → 409', async () => {
      // First, find any existing default in this org (the backfill may have created one)
      const { data } = await api(`/workspaces?organization_id=${organizationId}`);
      const hasDefault = data.workspaces.some((w) => w.isDefault);

      const { status } = await api('/workspaces', {
        method: 'POST',
        body: {
          organization_id: organizationId,
          title: `Conflicting Default ${testId}`,
          is_default: true,
        },
      });
      if (hasDefault) {
        expect(status).toBe(409);
      } else {
        // No default existed — this would have created one; clean up.
        const { data: created } = await api(`/workspaces?organization_id=${organizationId}`);
        const newDefault = created.workspaces.find((w) => w.isDefault && w.title === `Conflicting Default ${testId}`);
        if (newDefault) await api(`/workspaces/${newDefault.id}`, { method: 'DELETE' });
        expect([201, 409]).toContain(status);
      }
    });

    it('Slug auto-deduplicates on collision → 201', async () => {
      const { status, data } = await api('/workspaces', {
        method: 'POST',
        body: {
          organization_id: organizationId,
          title: `Updated Workspace ${testId}`, // same title as the patched one above
        },
      });
      expect(status).toBe(201);
      expect(data.slug).not.toBe('updated-workspace'); // suffix appended
      secondaryWorkspaceId = data.id;
    });
  });

  describe('Blueprint snapshot + fork', () => {
    let phaseId;
    let taskAId;
    let taskBId;

    beforeAll(async () => {
      // Create a plan inside the workspace so we have something to snapshot
      const { data: plan } = await api('/plans', {
        method: 'POST',
        body: {
          title: `Blueprint Source Plan ${testId}`,
          description: 'source for blueprint snapshot',
          status: 'draft',
        },
      });
      planId = plan.id;

      // Get the root, build a small tree
      const { data: tree } = await api(`/plans/${planId}/nodes`);
      const rootId = tree[0]?.id;

      const { data: phase } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'phase', title: `Phase ${testId}`, parent_id: rootId },
      });
      phaseId = phase.id;

      const { data: a } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'task', title: `Task A ${testId}`, parent_id: phaseId },
      });
      taskAId = a.id;

      const { data: b } = await api(`/plans/${planId}/nodes`, {
        method: 'POST',
        body: { node_type: 'task', title: `Task B ${testId}`, parent_id: phaseId },
      });
      taskBId = b.id;

      // Add a blocking dependency A → B
      await api(`/plans/${planId}/dependencies`, {
        method: 'POST',
        body: { source_node_id: taskAId, target_node_id: taskBId, dependency_type: 'blocks' },
      });
    });

    it('POST /blueprints/from_plan/:planId snapshots plan → 201', async () => {
      const { status, data } = await api(`/blueprints/from_plan/${planId}`, {
        method: 'POST',
        body: { title: `Source Blueprint ${testId}`, visibility: 'private' },
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.scope).toBe('plan');
      expect(data.payload).toBeDefined();
      expect(Array.isArray(data.payload.nodes)).toBe(true);
      expect(data.payload.nodes.length).toBeGreaterThanOrEqual(4); // root + phase + 2 tasks
      expect(Array.isArray(data.payload.dependencies)).toBe(true);
      expect(data.payload.dependencies.length).toBe(1);
      expect(data.forkCount).toBe(0);
      blueprintId = data.id;
    });

    it('Snapshot excludes status field on nodes', async () => {
      const { data: bp } = await api(`/blueprints/${blueprintId}`);
      for (const n of bp.payload.nodes) {
        expect(n).not.toHaveProperty('status');
        expect(n).not.toHaveProperty('assigned_agent_id');
        expect(n).not.toHaveProperty('quality_score');
      }
    });

    it('GET /blueprints lists user-visible blueprints', async () => {
      const { status, data } = await api('/blueprints?owner_only=true');
      expect(status).toBe(200);
      expect(data.blueprints.some((b) => b.id === blueprintId)).toBe(true);
    });

    it('POST /blueprints/:id/fork without workspace_id → 400', async () => {
      const { status } = await api(`/blueprints/${blueprintId}/fork`, { method: 'POST', body: {} });
      expect(status).toBe(400);
    });

    it('POST /blueprints/:id/fork creates a new plan in target workspace → 201', async () => {
      const { status, data } = await api(`/blueprints/${blueprintId}/fork`, {
        method: 'POST',
        body: { workspace_id: workspaceId, title: `Forked Plan ${testId}` },
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.id).not.toBe(planId);
      expect(data.workspaceId).toBe(workspaceId);
      expect(data.forkedFromBlueprintId).toBe(blueprintId);
      forkedPlanId = data.id;
    });

    it('Forked plan tree mirrors original structure (count + types)', async () => {
      const { data: original } = await api(`/plans/${planId}/nodes`);
      const { data: forked } = await api(`/plans/${forkedPlanId}/nodes`);

      const flatten = (n) => {
        const out = [];
        const walk = (x) => {
          out.push(x);
          (x.children || []).forEach(walk);
        };
        n.forEach(walk);
        return out;
      };
      const o = flatten(original);
      const f = flatten(forked);
      expect(f.length).toBe(o.length);

      // All forked tasks start at not_started
      for (const n of f) {
        if (n.node_type !== 'root') expect(n.status).toBe('not_started');
      }
    });

    it('Fork preserves dependency edges', async () => {
      const { data: deps } = await api(`/plans/${forkedPlanId}/dependencies`);
      expect(Array.isArray(deps)).toBe(true);
      expect(deps.length).toBe(1);
      expect(deps[0].dependency_type).toBe('blocks');
    });

    it('fork_count increments on the blueprint after fork', async () => {
      const { data } = await api(`/blueprints/${blueprintId}`);
      expect(data.forkCount).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /blueprints/:id updates title → 200', async () => {
      const { status, data } = await api(`/blueprints/${blueprintId}`, {
        method: 'PATCH',
        body: { title: `Renamed Blueprint ${testId}` },
      });
      expect(status).toBe(200);
      expect(data.title).toBe(`Renamed Blueprint ${testId}`);
    });

    it('PATCH /blueprints/:id rejects scope changes', async () => {
      const { data } = await api(`/blueprints/${blueprintId}`, {
        method: 'PATCH',
        body: { scope: 'workspace' },
      });
      // scope is stripped silently — must remain 'plan'
      expect(data.scope).toBe('plan');
    });
  });

  describe('Workspace deletion guards', () => {
    it('Cannot delete a default workspace → 409', async () => {
      const { data } = await api(`/workspaces?organization_id=${organizationId}`);
      const def = data.workspaces.find((w) => w.isDefault);
      if (!def) return; // backfill not yet run; skip
      const { status } = await api(`/workspaces/${def.id}`, { method: 'DELETE' });
      expect(status).toBe(409);
    });
  });
});

/**
 * Unit tests for plan.service.js
 *
 * All repository calls are mocked — tests verify business logic only.
 */

// Mock repository
jest.mock('../../../src/domains/plan/repositories/plan.repository', () => ({
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  listForUser: jest.fn(),
  listPublic: jest.fn(),
  incrementViewCount: jest.fn(),
  listNodesByPlan: jest.fn(),
  createNode: jest.fn(),
  getNodeTree: jest.fn(),
  listCollaborators: jest.fn(),
  addCollaborator: jest.fn(),
  removeCollaborator: jest.fn(),
  findUserById: jest.fn(),
  findUserByEmail: jest.fn(),
}));

// Mock planAccess middleware
jest.mock('../../../src/middleware/planAccess.middleware', () => ({
  checkPlanAccess: jest.fn(),
}));

// Mock broadcast
jest.mock('../../../src/websocket/broadcast', () => ({
  broadcastPlanUpdate: jest.fn(),
  broadcastToAll: jest.fn(),
}));

// Mock message-schema
jest.mock('../../../src/websocket/message-schema', () => ({
  createPlanCreatedMessage: jest.fn(() => ({ type: 'plan_created' })),
  createPlanUpdatedMessage: jest.fn(() => ({ type: 'plan_updated' })),
  createPlanDeletedMessage: jest.fn(() => ({ type: 'plan_deleted' })),
}));

const repo = require('../../../src/domains/plan/repositories/plan.repository');
const { checkPlanAccess } = require('../../../src/middleware/planAccess.middleware');
const planService = require('../../../src/domains/plan/services/plan.service');

const PLAN_ID = 'plan-1';
const USER_ID = 'user-1';
const USER_NAME = 'Test User';

const makePlan = (overrides = {}) => ({
  id: PLAN_ID,
  title: 'Test Plan',
  description: 'A test plan',
  ownerId: USER_ID,
  organizationId: 'org-1',
  status: 'draft',
  visibility: 'private',
  isPublic: false,
  viewCount: 0,
  githubRepoOwner: null,
  githubRepoName: null,
  githubRepoUrl: null,
  githubRepoFullName: null,
  metadata: {},
  qualityScore: null,
  qualityAssessedAt: null,
  qualityRationale: null,
  coherenceCheckedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastViewedAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  checkPlanAccess.mockResolvedValue(true);
});

describe('Plan Service', () => {
  // ── createPlan ─────────────────────────────────────────

  describe('createPlan', () => {
    it('should create a plan with root node', async () => {
      const plan = makePlan();
      repo.create.mockResolvedValue(plan);
      repo.createNode.mockResolvedValue({});

      const result = await planService.createPlan(USER_ID, USER_NAME, {
        title: 'Test Plan',
      });

      expect(result.title).toBe('Test Plan');
      expect(result.owner_id).toBe(USER_ID);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test Plan',
        ownerId: USER_ID,
        status: 'draft',
        visibility: 'private',
      }));
      expect(repo.createNode).toHaveBeenCalledWith(expect.objectContaining({
        planId: PLAN_ID,
        nodeType: 'root',
      }));
    });

    it('should reject missing title', async () => {
      await expect(planService.createPlan(USER_ID, USER_NAME, {}))
        .rejects.toThrow('Plan title is required');
    });
  });

  // ── getPlan ────────────────────────────────────────────

  describe('getPlan', () => {
    it('should return plan with progress and owner', async () => {
      repo.findById.mockResolvedValue(makePlan());
      repo.listNodesByPlan.mockResolvedValue([
        { status: 'completed' },
        { status: 'not_started' },
        { status: 'completed' },
        { status: 'in_progress' },
      ]);
      repo.findUserById.mockResolvedValue({ id: USER_ID, name: 'Test', email: 'test@test.com' });

      const result = await planService.getPlan(PLAN_ID, USER_ID);

      expect(result.id).toBe(PLAN_ID);
      expect(result.progress).toBe(50); // 2/4
      expect(result.owner.name).toBe('Test');
    });

    it('should throw 404 if plan not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(planService.getPlan(PLAN_ID, USER_ID))
        .rejects.toThrow('Plan not found');
    });

    it('should throw 403 if user lacks access', async () => {
      checkPlanAccess.mockResolvedValue(false);

      await expect(planService.getPlan(PLAN_ID, USER_ID))
        .rejects.toThrow('You do not have access to this plan');
    });
  });

  // ── updatePlan ─────────────────────────────────────────

  describe('updatePlan', () => {
    it('should update and return plan', async () => {
      repo.update.mockResolvedValue(makePlan({ title: 'Updated' }));

      const result = await planService.updatePlan(PLAN_ID, USER_ID, USER_NAME, {
        title: 'Updated',
      });

      expect(result.title).toBe('Updated');
    });

    it('should reject invalid quality_score', async () => {
      await expect(planService.updatePlan(PLAN_ID, USER_ID, USER_NAME, { qualityScore: 2.0 }))
        .rejects.toThrow('quality_score must be a number between 0.0 and 1.0');
    });

    it('should throw 404 if plan not found after update', async () => {
      repo.update.mockResolvedValue(null);

      await expect(planService.updatePlan(PLAN_ID, USER_ID, USER_NAME, { title: 'X' }))
        .rejects.toThrow('Plan not found');
    });
  });

  // ── deletePlan ─────────────────────────────────────────

  describe('deletePlan', () => {
    it('should delete plan if owner', async () => {
      repo.findById.mockResolvedValue(makePlan({ ownerId: USER_ID }));
      repo.delete.mockResolvedValue();

      await planService.deletePlan(PLAN_ID, USER_ID, USER_NAME);

      expect(repo.delete).toHaveBeenCalledWith(PLAN_ID);
    });

    it('should reject non-owner', async () => {
      repo.findById.mockResolvedValue(makePlan({ ownerId: 'other-user' }));

      await expect(planService.deletePlan(PLAN_ID, USER_ID, USER_NAME))
        .rejects.toThrow('Only the plan owner can delete it');
    });

    it('should throw 404 if plan not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(planService.deletePlan(PLAN_ID, USER_ID, USER_NAME))
        .rejects.toThrow('Plan not found');
    });
  });

  // ── calculatePlanProgress ──────────────────────────────

  describe('calculatePlanProgress', () => {
    it('should return 0 for empty plan', async () => {
      repo.listNodesByPlan.mockResolvedValue([]);

      const progress = await planService.calculatePlanProgress(PLAN_ID);
      expect(progress).toBe(0);
    });

    it('should calculate percentage correctly', async () => {
      repo.listNodesByPlan.mockResolvedValue([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'not_started' },
      ]);

      const progress = await planService.calculatePlanProgress(PLAN_ID);
      expect(progress).toBe(67); // 2/3 = 66.7 → rounded to 67
    });
  });

  // ── collaborators ──────────────────────────────────────

  describe('addCollaborator', () => {
    it('should add collaborator by user_id', async () => {
      repo.addCollaborator.mockResolvedValue({ id: 'collab-1' });

      const result = await planService.addCollaborator(PLAN_ID, USER_ID, {
        targetUserId: 'target-user',
        role: 'editor',
      });

      expect(repo.addCollaborator).toHaveBeenCalledWith(PLAN_ID, 'target-user', 'editor');
    });

    it('should resolve user by email if no user_id', async () => {
      repo.findUserByEmail.mockResolvedValue({ id: 'resolved-id' });
      repo.addCollaborator.mockResolvedValue({ id: 'collab-1' });

      await planService.addCollaborator(PLAN_ID, USER_ID, {
        email: 'test@test.com',
        role: 'viewer',
      });

      expect(repo.addCollaborator).toHaveBeenCalledWith(PLAN_ID, 'resolved-id', 'viewer');
    });

    it('should throw 404 if user not found', async () => {
      repo.findUserByEmail.mockResolvedValue(null);

      await expect(planService.addCollaborator(PLAN_ID, USER_ID, {
        email: 'unknown@test.com',
      })).rejects.toThrow('User not found');
    });
  });

  // ── visibility ─────────────────────────────────────────

  describe('updatePlanVisibility', () => {
    it('should update visibility to public', async () => {
      repo.update.mockResolvedValue(makePlan({ visibility: 'public', isPublic: true }));

      const result = await planService.updatePlanVisibility(PLAN_ID, USER_ID, 'public');

      expect(repo.update).toHaveBeenCalledWith(PLAN_ID, { visibility: 'public', isPublic: true });
      expect(result.visibility).toBe('public');
    });

    it('should reject invalid visibility', async () => {
      await expect(planService.updatePlanVisibility(PLAN_ID, USER_ID, 'invalid'))
        .rejects.toThrow('Invalid visibility');
    });

    it('should reject non-owner', async () => {
      checkPlanAccess.mockResolvedValue(false);

      await expect(planService.updatePlanVisibility(PLAN_ID, USER_ID, 'public'))
        .rejects.toThrow('Only the plan owner can change visibility');
    });
  });

  // ── getPlanProgress ────────────────────────────────────

  describe('getPlanProgress', () => {
    it('should return status breakdown', async () => {
      repo.listNodesByPlan.mockResolvedValue([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'in_progress' },
        { status: 'not_started' },
        { status: 'blocked' },
      ]);

      const result = await planService.getPlanProgress(PLAN_ID, USER_ID);

      expect(result.total).toBe(5);
      expect(result.completed).toBe(2);
      expect(result.in_progress).toBe(1);
      expect(result.not_started).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.progress_percentage).toBe(40);
    });
  });

  // ── getPublicPlan ──────────────────────────────────────

  describe('getPublicPlan', () => {
    it('should return public plan with nodes and owner', async () => {
      repo.findById.mockResolvedValue(makePlan({ visibility: 'public', isPublic: true }));
      repo.getNodeTree.mockResolvedValue([{ id: 'n1' }]);
      repo.findUserById.mockResolvedValue({ id: USER_ID, name: 'Owner' });

      const result = await planService.getPublicPlan(PLAN_ID);

      expect(result.id).toBe(PLAN_ID);
      expect(result.nodes).toHaveLength(1);
      expect(result.owner.name).toBe('Owner');
    });

    it('should throw 404 for private plan', async () => {
      repo.findById.mockResolvedValue(makePlan({ visibility: 'private', isPublic: false }));

      await expect(planService.getPublicPlan(PLAN_ID))
        .rejects.toThrow('Plan not found');
    });

    it('should throw 404 if plan does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(planService.getPublicPlan(PLAN_ID))
        .rejects.toThrow('Plan not found');
    });
  });

  // ── linkGitHubRepo ─────────────────────────────────────

  describe('linkGitHubRepo', () => {
    it('should link repo and return updated plan', async () => {
      repo.update.mockResolvedValue(makePlan({
        githubRepoOwner: 'org', githubRepoName: 'repo',
        githubRepoUrl: null, githubRepoFullName: 'org/repo',
      }));

      const result = await planService.linkGitHubRepo(PLAN_ID, USER_ID, {
        owner: 'org', repo: 'repo',
      });

      expect(result.github_repo_full_name).toBe('org/repo');
      expect(repo.update).toHaveBeenCalledWith(PLAN_ID, expect.objectContaining({
        githubRepoOwner: 'org',
        githubRepoName: 'repo',
        githubRepoFullName: 'org/repo',
      }));
    });
  });
});

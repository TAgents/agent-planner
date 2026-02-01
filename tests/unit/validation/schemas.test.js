/**
 * Unit Tests for Validation Schemas
 */

const { schemas } = require('../../../src/validation');

describe('Validation Schemas', () => {
  describe('Plan Schemas', () => {
    describe('createPlan', () => {
      const schema = schemas.plan.createPlan;

      it('should accept valid plan data', () => {
        const result = schema.safeParse({
          title: 'My Plan',
          description: 'A test plan',
          status: 'draft'
        });

        expect(result.success).toBe(true);
        expect(result.data.title).toBe('My Plan');
      });

      it('should require title', () => {
        const result = schema.safeParse({
          description: 'No title provided'
        });

        expect(result.success).toBe(false);
        expect(result.error.issues[0].path).toContain('title');
      });

      it('should reject empty title', () => {
        const result = schema.safeParse({
          title: ''
        });

        expect(result.success).toBe(false);
      });

      it('should default status to draft', () => {
        const result = schema.safeParse({
          title: 'My Plan'
        });

        expect(result.success).toBe(true);
        expect(result.data.status).toBe('draft');
      });

      it('should validate status enum values', () => {
        const validStatuses = ['draft', 'active', 'completed', 'archived'];
        
        for (const status of validStatuses) {
          const result = schema.safeParse({ title: 'Test', status });
          expect(result.success).toBe(true);
        }

        const result = schema.safeParse({ title: 'Test', status: 'invalid' });
        expect(result.success).toBe(false);
      });

      it('should reject unknown fields in strict mode', () => {
        const result = schema.safeParse({
          title: 'Test',
          unknownField: 'should fail'
        });

        expect(result.success).toBe(false);
      });

      it('should reject title exceeding max length', () => {
        const result = schema.safeParse({
          title: 'a'.repeat(300)
        });

        expect(result.success).toBe(false);
      });
    });

    describe('updatePlan', () => {
      const schema = schemas.plan.updatePlan;

      it('should accept partial updates', () => {
        const result = schema.safeParse({
          title: 'Updated Title'
        });

        expect(result.success).toBe(true);
      });

      it('should accept empty object (no updates)', () => {
        const result = schema.safeParse({});

        expect(result.success).toBe(true);
      });

      it('should validate status if provided', () => {
        const result = schema.safeParse({
          status: 'invalid'
        });

        expect(result.success).toBe(false);
      });
    });

    describe('updateVisibility', () => {
      const schema = schemas.plan.updateVisibility;

      it('should accept visibility parameter', () => {
        const result = schema.safeParse({
          visibility: 'public'
        });

        expect(result.success).toBe(true);
      });

      it('should accept is_public for backward compatibility', () => {
        const result = schema.safeParse({
          is_public: true
        });

        expect(result.success).toBe(true);
      });

      it('should require either visibility or is_public', () => {
        const result = schema.safeParse({
          github_repo_owner: 'test'
        });

        expect(result.success).toBe(false);
      });

      it('should accept GitHub repo info with visibility', () => {
        const result = schema.safeParse({
          visibility: 'public',
          github_repo_owner: 'testorg',
          github_repo_name: 'testrepo'
        });

        expect(result.success).toBe(true);
      });
    });

    describe('addCollaborator', () => {
      const schema = schemas.plan.addCollaborator;

      it('should accept valid collaborator data', () => {
        const result = schema.safeParse({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          role: 'editor'
        });

        expect(result.success).toBe(true);
      });

      it('should require valid UUID for user_id', () => {
        const result = schema.safeParse({
          user_id: 'not-a-uuid',
          role: 'editor'
        });

        expect(result.success).toBe(false);
      });

      it('should validate role enum', () => {
        const validRoles = ['admin', 'editor', 'viewer'];
        
        for (const role of validRoles) {
          const result = schema.safeParse({
            user_id: '550e8400-e29b-41d4-a716-446655440000',
            role
          });
          expect(result.success).toBe(true);
        }

        const result = schema.safeParse({
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          role: 'superadmin'
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Node Schemas', () => {
    describe('createNode', () => {
      const schema = schemas.node.createNode;

      it('should accept valid node data', () => {
        const result = schema.safeParse({
          node_type: 'task',
          title: 'My Task',
          description: 'Task description'
        });

        expect(result.success).toBe(true);
        expect(result.data.status).toBe('not_started');
      });

      it('should require node_type', () => {
        const result = schema.safeParse({
          title: 'Missing Type'
        });

        expect(result.success).toBe(false);
      });

      it('should require title', () => {
        const result = schema.safeParse({
          node_type: 'task'
        });

        expect(result.success).toBe(false);
      });

      it('should validate node_type enum', () => {
        const validTypes = ['root', 'phase', 'task', 'milestone'];
        
        for (const node_type of validTypes) {
          const result = schema.safeParse({ node_type, title: 'Test' });
          expect(result.success).toBe(true);
        }

        const result = schema.safeParse({ node_type: 'invalid', title: 'Test' });
        expect(result.success).toBe(false);
      });

      it('should validate status enum', () => {
        const validStatuses = ['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'];
        
        for (const status of validStatuses) {
          const result = schema.safeParse({ node_type: 'task', title: 'Test', status });
          expect(result.success).toBe(true);
        }
      });

      it('should accept optional parent_id as UUID', () => {
        const result = schema.safeParse({
          node_type: 'task',
          title: 'Test',
          parent_id: '550e8400-e29b-41d4-a716-446655440000'
        });

        expect(result.success).toBe(true);
      });

      it('should accept null parent_id', () => {
        const result = schema.safeParse({
          node_type: 'task',
          title: 'Test',
          parent_id: null
        });

        expect(result.success).toBe(true);
      });
    });

    describe('updateNode', () => {
      const schema = schemas.node.updateNode;

      it('should accept partial updates', () => {
        const result = schema.safeParse({
          title: 'Updated Title'
        });

        expect(result.success).toBe(true);
      });

      it('should accept status update', () => {
        const result = schema.safeParse({
          status: 'completed'
        });

        expect(result.success).toBe(true);
      });

      it('should accept empty object', () => {
        const result = schema.safeParse({});

        expect(result.success).toBe(true);
      });
    });

    describe('moveNode', () => {
      const schema = schemas.node.moveNode;

      it('should require parent_id', () => {
        const result = schema.safeParse({
          order_index: 0
        });

        expect(result.success).toBe(false);
      });

      it('should accept valid move data', () => {
        const result = schema.safeParse({
          parent_id: '550e8400-e29b-41d4-a716-446655440000',
          order_index: 2
        });

        expect(result.success).toBe(true);
      });
    });

    describe('addLog', () => {
      const schema = schemas.node.addLog;

      it('should require content', () => {
        const result = schema.safeParse({});

        expect(result.success).toBe(false);
      });

      it('should accept valid log entry', () => {
        const result = schema.safeParse({
          content: 'This is a progress update',
          log_type: 'progress'
        });

        expect(result.success).toBe(true);
      });

      it('should default log_type to comment', () => {
        const result = schema.safeParse({
          content: 'A comment'
        });

        expect(result.success).toBe(true);
        expect(result.data.log_type).toBe('comment');
      });

      it('should validate log_type enum', () => {
        const validTypes = ['comment', 'progress', 'reasoning', 'decision', 'blocker', 'resolution'];
        
        for (const log_type of validTypes) {
          const result = schema.safeParse({ content: 'Test', log_type });
          expect(result.success).toBe(true);
        }
      });
    });

    describe('planNodeParams', () => {
      const schema = schemas.node.planNodeParams;

      it('should require valid UUIDs for both params', () => {
        const result = schema.safeParse({
          id: '550e8400-e29b-41d4-a716-446655440000',
          nodeId: '550e8400-e29b-41d4-a716-446655440001'
        });

        expect(result.success).toBe(true);
      });

      it('should reject invalid UUIDs', () => {
        const result = schema.safeParse({
          id: 'not-uuid',
          nodeId: 'also-not-uuid'
        });

        expect(result.success).toBe(false);
        expect(result.error.issues.length).toBe(2);
      });
    });
  });

  describe('Common Schemas', () => {
    describe('uuid', () => {
      const uuid = schemas.common.uuid;

      it('should accept valid UUIDs', () => {
        const validUuids = [
          '550e8400-e29b-41d4-a716-446655440000',
          '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          'f47ac10b-58cc-4372-a567-0e02b2c3d479'
        ];

        for (const id of validUuids) {
          expect(uuid.safeParse(id).success).toBe(true);
        }
      });

      it('should reject invalid UUIDs', () => {
        const invalidUuids = [
          'not-a-uuid',
          '12345',
          '',
          'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
        ];

        for (const id of invalidUuids) {
          expect(uuid.safeParse(id).success).toBe(false);
        }
      });
    });

    describe('paginationParams', () => {
      const pagination = schemas.common.paginationParams;

      it('should apply defaults', () => {
        const result = pagination.safeParse({});

        expect(result.success).toBe(true);
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(12);
        expect(result.data.sort).toBe('recent');
      });

      it('should coerce string numbers', () => {
        const result = pagination.safeParse({
          page: '5',
          limit: '25'
        });

        expect(result.success).toBe(true);
        expect(result.data.page).toBe(5);
        expect(result.data.limit).toBe(25);
      });

      it('should enforce limit max of 100', () => {
        const result = pagination.safeParse({
          limit: '200'
        });

        expect(result.success).toBe(false);
      });
    });
  });
});

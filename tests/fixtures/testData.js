/**
 * Test Data Fixtures
 * Provides factory functions for creating test data
 */

const { v4: uuidv4 } = require('uuid');
const { faker } = require('@faker-js/faker');

/**
 * Create a mock user object
 */
const createMockUser = (overrides = {}) => ({
  id: uuidv4(),
  email: faker.internet.email(),
  name: faker.person.fullName(),
  created_at: new Date().toISOString(),
  ...overrides
});

/**
 * Create a mock plan object
 */
const createMockPlan = (overrides = {}) => ({
  id: uuidv4(),
  title: faker.lorem.sentence(3),
  description: faker.lorem.paragraph(),
  owner_id: uuidv4(),
  status: 'draft',
  visibility: 'private',
  is_public: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  view_count: 0,
  ...overrides
});

/**
 * Create a mock plan node object
 */
const createMockNode = (overrides = {}) => ({
  id: uuidv4(),
  plan_id: uuidv4(),
  parent_id: null,
  node_type: 'task',
  title: faker.lorem.sentence(3),
  description: faker.lorem.paragraph(),
  status: 'not_started',
  order_index: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  context: '',
  agent_instructions: '',
  acceptance_criteria: '',
  metadata: {},
  ...overrides
});

/**
 * Create a mock root node for a plan
 */
const createMockRootNode = (planId, title, overrides = {}) => createMockNode({
  plan_id: planId,
  parent_id: null,
  node_type: 'root',
  title: title,
  order_index: 0,
  ...overrides
});

/**
 * Create a mock phase node
 */
const createMockPhaseNode = (planId, parentId, overrides = {}) => createMockNode({
  plan_id: planId,
  parent_id: parentId,
  node_type: 'phase',
  ...overrides
});

/**
 * Create a mock task node
 */
const createMockTaskNode = (planId, parentId, overrides = {}) => createMockNode({
  plan_id: planId,
  parent_id: parentId,
  node_type: 'task',
  ...overrides
});

/**
 * Create a mock milestone node
 */
const createMockMilestoneNode = (planId, parentId, overrides = {}) => createMockNode({
  plan_id: planId,
  parent_id: parentId,
  node_type: 'milestone',
  ...overrides
});

/**
 * Create a mock activity log entry
 */
const createMockActivityLog = (overrides = {}) => ({
  id: uuidv4(),
  plan_id: uuidv4(),
  node_id: uuidv4(),
  user_id: uuidv4(),
  activity_type: 'comment',
  content: faker.lorem.paragraph(),
  created_at: new Date().toISOString(),
  metadata: {},
  ...overrides
});

/**
 * Create a mock artifact
 */
const createMockArtifact = (overrides = {}) => ({
  id: uuidv4(),
  plan_id: uuidv4(),
  node_id: uuidv4(),
  user_id: uuidv4(),
  name: faker.system.fileName(),
  artifact_type: 'file',
  content_type: 'text/plain',
  content: faker.lorem.paragraphs(2),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  metadata: {},
  ...overrides
});

/**
 * Create a mock Express request object
 */
const createMockRequest = (overrides = {}) => ({
  params: {},
  query: {},
  body: {},
  user: createMockUser(),
  headers: {
    'content-type': 'application/json'
  },
  ...overrides
});

/**
 * Create a mock Express response object
 */
const createMockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};

/**
 * Create a mock next function
 */
const createMockNext = () => jest.fn();

module.exports = {
  createMockUser,
  createMockPlan,
  createMockNode,
  createMockRootNode,
  createMockPhaseNode,
  createMockTaskNode,
  createMockMilestoneNode,
  createMockActivityLog,
  createMockArtifact,
  createMockRequest,
  createMockResponse,
  createMockNext
};

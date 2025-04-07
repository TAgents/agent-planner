# Agent Planner API Refactoring Tasks

This document outlines the necessary API enhancements to address the gaps identified in the agent-planner API. These improvements will enable better planning functionality and support the enhanced MCP tools.

## New API Endpoints

### 1. Plan Structure Endpoint

```
GET /plans/{planId}/structure
```

**Description:** Retrieve the complete hierarchical structure of a plan with preserved parent-child relationships.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/plan.controller.js`
- [ ] Implement efficient querying of the hierarchical structure (consider recursive CTEs in SQL)
- [ ] Add support for query parameters:
  - [ ] `include_details`: Boolean to include full node details or basic info
  - [ ] `max_depth`: Integer to limit hierarchy depth for large plans
- [ ] Create a response mapper to transform flat database results into a nested structure
- [ ] Add appropriate route in `src/routes/plan.routes.js`
- [ ] Create unit and integration tests

**Expected Response:**
```json
{
  "plan_id": "123",
  "title": "Plan Title",
  "nodes": [
    {
      "id": "node1",
      "title": "Root Node",
      "node_type": "root",
      "status": "in_progress",
      "children": [
        {
          "id": "node2",
          "title": "Child Node",
          "node_type": "phase",
          "status": "not_started",
          "children": [...]
        }
      ]
    }
  ]
}
```

### 2. Advanced Node Search

```
GET /plans/{planId}/nodes/search
```

**Description:** Advanced search with multiple filters for finding nodes within a plan.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/node.controller.js`
- [ ] Implement a flexible search query builder supporting:
  - [ ] Text search across titles and descriptions
  - [ ] Filtering by node type, status, parent_id
  - [ ] Date range filtering for creation/updates
- [ ] Add support for pagination
- [ ] Support response format customization
- [ ] Add route in `src/routes/node.routes.js`
- [ ] Create unit and integration tests

**Expected Query Parameters:**
```
query=planning
node_type=task
status=in_progress
parent_id=abc123
created_after=2024-01-01
created_before=2024-12-31
page=1
limit=20
```

### 3. Plan Statistics Endpoint

```
GET /plans/{planId}/stats
```

**Description:** Aggregate statistics about plan progress and composition.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/plan.controller.js`
- [ ] Implement aggregation queries for:
  - [ ] Counts by status (not_started, in_progress, completed, blocked)
  - [ ] Counts by node type (root, phase, task, milestone)
  - [ ] Completion percentage calculation
  - [ ] Due date statistics (overdue, due soon, etc.)
- [ ] Add route in `src/routes/plan.routes.js`
- [ ] Create unit and integration tests

**Expected Response:**
```json
{
  "by_status": {
    "not_started": 10,
    "in_progress": 5,
    "completed": 3,
    "blocked": 1
  },
  "by_type": {
    "root": 1,
    "phase": 4,
    "task": 12,
    "milestone": 2
  },
  "completion_percentage": 15.8,
  "due_date_summary": {
    "overdue": 2,
    "due_this_week": 3,
    "due_next_week": 5
  }
}
```

### 4. Node Children Endpoint

```
GET /plans/{planId}/nodes/{nodeId}/children
```

**Description:** Get direct or all descendant children of a specific node.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/node.controller.js`
- [ ] Implement query logic supporting:
  - [ ] Direct children retrieval
  - [ ] Recursive descendant retrieval
  - [ ] Filtering by node type and status
- [ ] Add pagination support
- [ ] Add route in `src/routes/node.routes.js`
- [ ] Create unit and integration tests

**Expected Query Parameters:**
```
recursive=true
node_type=task
status=blocked
page=1
limit=20
```

### 5. Bulk Node Creation

```
POST /plans/{planId}/nodes/bulk
```

**Description:** Create multiple nodes in a single request.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/node.controller.js`
- [ ] Implement transaction support to ensure atomic operation
- [ ] Add validation for the array of node objects
- [ ] Implement efficient bulk insertion
- [ ] Add route in `src/routes/node.routes.js`
- [ ] Create unit and integration tests

**Expected Request:**
```json
{
  "nodes": [
    {
      "title": "Phase 1",
      "node_type": "phase",
      "parent_id": "root_node_id"
    },
    {
      "title": "Task 1",
      "node_type": "task",
      "parent_id": "{reference_to_phase_1}",
      "description": "First task description"
    }
  ]
}
```

## API Enhancements

### 1. Enhanced Node Update

```
PATCH /plans/{planId}/nodes/{nodeId}
```

**Description:** Enhance the existing node update endpoint to support moving nodes and reordering.

**Tasks:**
- [ ] Modify the existing controller method in `src/controllers/node.controller.js`
- [ ] Add support for:
  - [ ] Changing parent (moving node to a different parent)
  - [ ] Updating order_index (position among siblings)
  - [ ] Preserving or moving children with the parent node
- [ ] Implement transaction support for safe hierarchy modifications
- [ ] Add appropriate validations
- [ ] Update unit and integration tests

**Expected Request Additions:**
```json
{
  "parent_id": "new_parent_id",
  "order_index": 2,
  "preserve_children": true
}
```

### 2. Node Reordering Endpoint

```
PUT /plans/{planId}/nodes/reorder
```

**Description:** Reorder multiple nodes in a single operation.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/node.controller.js`
- [ ] Implement transaction support
- [ ] Add validation for node IDs and order indices
- [ ] Add route in `src/routes/node.routes.js`
- [ ] Create unit and integration tests

**Expected Request:**
```json
{
  "node_orders": [
    { "node_id": "node1", "order_index": 0 },
    { "node_id": "node2", "order_index": 1 },
    { "node_id": "node3", "order_index": 2 }
  ]
}
```

### 3. Find Nodes by Name

```
GET /plans/{planId}/nodes/by-name/{name}
```

**Description:** Find nodes by exact or partial name match.

**Tasks:**
- [ ] Create a new controller method in `src/controllers/node.controller.js`
- [ ] Implement search logic supporting:
  - [ ] Exact or partial name matching
  - [ ] Filtering by node type
- [ ] Add route in `src/routes/node.routes.js`
- [ ] Create unit and integration tests

**Expected Query Parameters:**
```
exact=false
node_type=task
```

### 4. Enhanced Global Search

```
GET /plans/search
```

**Description:** Improve the existing search to support more advanced features.

**Tasks:**
- [ ] Enhance the existing search functionality in `src/controllers/search.controller.js`
- [ ] Implement more sophisticated text matching
- [ ] Add support for faceted search with multiple filters
- [ ] Implement relevance scoring
- [ ] Add ability to search within specific plan sections
- [ ] Update unit and integration tests

**Expected Query Parameters:**
```
q=project planning
plan_id=optional_plan_id
node_types=task,milestone
statuses=not_started,in_progress
date_range=2024-01-01,2024-12-31
sort_by=relevance
```

## Database and Infrastructure Changes

### 1. Optimized Database Structure

**Tasks:**
- [ ] Review and update database indexes for efficient hierarchical queries
- [ ] Consider adding materialized paths or closure tables for faster tree traversal
- [ ] Add indexes to support text search operations
- [ ] Implement/review row-level security policies

### 2. API Versioning

**Tasks:**
- [ ] Implement API versioning strategy (URL, header, or content negotiation)
- [ ] Update routing and controller structure to support versioned endpoints
- [ ] Create documentation for version differences

### 3. Performance Optimizations

**Tasks:**
- [ ] Implement query optimizations for large plans
- [ ] Add result caching where appropriate
- [ ] Add pagination to all list endpoints that might return large result sets
- [ ] Implement query timeouts to prevent long-running operations

## Documentation and Testing

### 1. API Documentation

**Tasks:**
- [ ] Update OpenAPI/Swagger documentation
- [ ] Add examples for all new endpoints
- [ ] Create usage guides for complex operations
- [ ] Document potential performance considerations

### 2. Comprehensive Testing

**Tasks:**
- [ ] Create unit tests for all new controller methods
- [ ] Implement integration tests for new endpoints
- [ ] Add performance tests for tree operations on large plans
- [ ] Create test fixtures for hierarchical data

## Implementation Timeline

**Phase 1: Core Hierarchy Functions**
- Plan Structure Endpoint
- Node Children Endpoint
- Enhanced Node Update

**Phase 2: Search and Discovery**
- Advanced Node Search
- Find Nodes by Name
- Enhanced Global Search

**Phase 3: Bulk Operations and Statistics**
- Bulk Node Creation
- Node Reordering Endpoint
- Plan Statistics Endpoint

**Phase 4: Optimization and Documentation**
- Database Optimizations
- API Versioning
- Documentation and Testing

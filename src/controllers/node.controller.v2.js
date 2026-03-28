/**
 * Node Controller v2 — Thin HTTP layer
 *
 * Parses requests, delegates to node.service, returns responses.
 * All business logic lives in src/domains/node/services/node.service.js
 */
const nodeService = require('../domains/node/services/node.service');

const getNodes = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const { include_details, coherence_status, flat, include_root } = req.query;

    const result = await nodeService.listNodes(planId, req.user.id, {
      includeDetails: include_details === 'true',
      coherenceStatus: coherence_status,
      flat: flat === 'true',
      includeRoot: include_root === 'true',
    });

    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getNode = async (req, res, next) => {
  try {
    const result = await nodeService.getNode(req.params.id, req.params.nodeId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const createNode = async (req, res, next) => {
  try {
    const { id: planId } = req.params;
    const userName = req.user.name || req.user.email;

    const { result, created } = await nodeService.createNode(planId, req.user.id, userName, {
      parentId: req.body.parent_id,
      nodeType: req.body.node_type,
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      orderIndex: req.body.order_index,
      dueDate: req.body.due_date,
      context: req.body.context,
      agentInstructions: req.body.agent_instructions,
      metadata: req.body.metadata,
      taskMode: req.body.task_mode,
    });

    res.status(created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const updateNode = async (req, res, next) => {
  try {
    const { id: planId, nodeId } = req.params;
    const userName = req.user.name || req.user.email;

    const result = await nodeService.updateNode(planId, nodeId, req.user.id, userName, {
      nodeType: req.body.node_type,
      title: req.body.title,
      description: req.body.description,
      status: req.body.status,
      orderIndex: req.body.order_index,
      dueDate: req.body.due_date,
      context: req.body.context,
      agentInstructions: req.body.agent_instructions,
      metadata: req.body.metadata,
      taskMode: req.body.task_mode,
      coherenceStatus: req.body.coherence_status,
      qualityScore: req.body.quality_score,
      qualityAssessedAt: req.body.quality_assessed_at,
      qualityRationale: req.body.quality_rationale,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const deleteNode = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    await nodeService.deleteNode(req.params.id, req.params.nodeId, req.user.id, userName);
    res.status(204).send();
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

/** Deprecated */
const addComment = async (req, res) => {
  res.status(410).json({ error: 'Comments removed. Use logs endpoint.' });
};
const getComments = async (req, res) => {
  res.status(410).json({ error: 'Comments removed. Use logs endpoint.' });
};

const getNodeContext = async (req, res, next) => {
  try {
    const result = await nodeService.getNodeContext(req.params.id, req.params.nodeId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getNodeAncestry = async (req, res, next) => {
  try {
    const result = await nodeService.getNodeAncestry(req.params.id, req.params.nodeId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const updateNodeStatus = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await nodeService.updateNodeStatus(req.params.id, req.params.nodeId, req.user.id, userName, req.body.status);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const moveNode = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await nodeService.moveNode(req.params.id, req.params.nodeId, req.user.id, userName, {
      newParentId: req.body.parent_id,
      newOrderIndex: req.body.order_index,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const addLogEntry = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await nodeService.addLogEntry(req.params.id, req.params.nodeId, req.user.id, userName, {
      content: req.body.content,
      logType: req.body.log_type,
      actorType: req.body.actor_type,
      tags: req.body.tags,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getNodeLogs = async (req, res, next) => {
  try {
    const result = await nodeService.getNodeLogs(req.params.id, req.params.nodeId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const requestAgent = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await nodeService.requestAgent(req.params.id, req.params.nodeId, req.user.id, userName, {
      requestType: req.body.request_type,
      message: req.body.message,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const clearAgentRequest = async (req, res, next) => {
  try {
    const result = await nodeService.clearAgentRequest(req.params.id, req.params.nodeId, req.user.id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const assignAgent = async (req, res, next) => {
  try {
    const result = await nodeService.assignAgent(req.params.id, req.params.nodeId, req.user.id, req.body.agent_id);
    res.json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const unassignAgent = async (req, res, next) => {
  try {
    await nodeService.unassignAgent(req.params.id, req.params.nodeId, req.user.id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

const getSuggestedAgents = async (req, res, next) => {
  try {
    const agents = await nodeService.getSuggestedAgents();
    res.json({ agents });
  } catch (error) {
    next(error);
  }
};

const createRpiChain = async (req, res, next) => {
  try {
    const userName = req.user.name || req.user.email;
    const result = await nodeService.createRpiChain(req.params.id, req.user.id, userName, {
      title: req.body.title,
      description: req.body.description,
      parentId: req.body.parent_id,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof nodeService.ServiceError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

module.exports = {
  getNodes, getNode, createNode, updateNode, deleteNode,
  addComment, getComments, getNodeContext, getNodeAncestry,
  updateNodeStatus, moveNode, addLogEntry, getNodeLogs,
  requestAgent, clearAgentRequest, assignAgent, unassignAgent, getSuggestedAgents,
  createRpiChain,
};

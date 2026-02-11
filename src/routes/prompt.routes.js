const express = require('express');
const router = express.Router();
const promptController = require('../controllers/prompt.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.get('/', authenticate, promptController.listPrompts);
router.post('/', authenticate, promptController.createPrompt);
router.put('/:promptId', authenticate, promptController.updatePrompt);
router.delete('/:promptId', authenticate, promptController.deletePrompt);

module.exports = router;

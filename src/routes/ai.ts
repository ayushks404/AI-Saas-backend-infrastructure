import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import { streamChat } from '../controllers/ai.controller.js';

const router = express.Router();

/**
 * POST /api/ai/chat
 * Guards: requireAuth, rateLimitMiddleware
 * Handler: streamChat controller
 */
router.post('/chat', requireAuth, rateLimitMiddleware, streamChat);

export default router;

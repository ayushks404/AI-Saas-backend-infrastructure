import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { checkCostRateLimit } from '../middleware/costRateLimit.js';
import { modelRateLimitMiddleware } from '../middleware/modelRateLimit.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import { streamChat } from '../controllers/ai.controller.js';

const router = express.Router();

/**
 * POST /api/ai/chat
 * Guards (in order of execution):
 * 1. requireAuth - populates req.user
 * 2. checkCostRateLimit - pre-call tiktoken estimate + Redis INCRBYFLOAT daily budget check
 * 3. modelRateLimitMiddleware - enforces per-model RPM (e.g. 5/min for Claude Opus)
 * 4. rateLimitMiddleware - enforces user tier RPM limits
 * Handler:
 * 5. streamChat - SSE streaming + post-call reconciliation
 */
router.post(
  '/chat',
  requireAuth,
  checkCostRateLimit,
  modelRateLimitMiddleware,
  rateLimitMiddleware,
  streamChat
);

export default router;


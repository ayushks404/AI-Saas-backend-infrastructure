import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import { register, login, refresh, getMe } from '../controllers/auth.controller.js';

const router = express.Router();

/**
 * POST /auth/register
 * Guards: rateLimitMiddleware
 * Handler: register controller
 */
router.post('/register', rateLimitMiddleware, register);

/**
 * POST /auth/login
 * Guards: rateLimitMiddleware
 * Handler: login controller
 */
router.post('/login', rateLimitMiddleware, login);

/**
 * POST /auth/refresh
 * Handler: refresh controller (atomic getdel rotation)
 */
router.post('/refresh', refresh);

/**
 * GET /auth/me
 * Guards: requireAuth
 * Handler: getMe controller
 */
router.get('/me', requireAuth, getMe);

export default router;

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { redis } from '../lib/redis.js';
import { estimateInputCost, DAILY_BUDGET_BY_TIER } from '../lib/tokenCost.js';
import { logger } from '../lib/logger.js';

// Extend Express Request interface so downstream handlers can access costTracker
declare global {
    namespace Express {
        interface Request {
            costTracker?: {
                key: string;
                estimatedCost: number;
                model: string;
            };
        }
    }
}

/**
 * Enforces financial cost quotas per user based on daily USD tier allowances.
 * Uses optimistic Redis INCRBYFLOAT with rollback to prevent concurrent race conditions.
 */
export const checkCostRateLimit: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
        // If route isn't protected by requireAuth, skip cost limiting
        return next();
    }

    const userTier = user.tier ?? 'free';
    const budget = DAILY_BUDGET_BY_TIER[userTier] ?? 0.10;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const key = `cost:${user._id}:${today}`;

    const model = req.body?.model ?? 'gpt-4o-mini';
    const messages = req.body?.messages ?? [];

    const estimated = estimateInputCost(model, messages);

    try {
        // Atomic optimistic reservation: reserve the estimated amount first
        const usedStr = await redis.incrbyfloat(key, estimated);
        const used = parseFloat(usedStr);
        // 25 hours TTL: covers full day + 1h buffer for long requests crossing midnight
        await redis.expire(key, 86400 + 3600);

        if (used > budget) {
            // Refund the reservation so the failed request doesn't deduct from their budget
            await redis.incrbyfloat(key, -estimated);

            const resetAt = new Date();
            resetAt.setUTCHours(24, 0, 0, 0); // Next UTC midnight

            logger.warn('Daily AI cost budget exhausted', {
                userId: user._id,
                userTier,
                usedUSD: +(used - estimated).toFixed(6),
                budgetUSD: budget,
                attemptedModel: model
            });

            res.status(429).json({
                error: 'Daily AI budget exhausted',
                budgetUSD: budget,
                usedUSD: +(used - estimated).toFixed(6),
                resetAt: resetAt.toISOString()
            });
            return;
        }

        // Attach tracker metadata to request for post-call reconciliation in the controller
        req.costTracker = {
            key,
            estimatedCost: estimated,
            model
        };

        next();
    } catch (err: any) {
        logger.error('Redis cost rate limit error - allowing fail-open to preserve availability', {
            error: err.message,
            key
        });
        // In infrastructure, fail-open preserves user experience if Redis is temporarily degraded
        next();
    }
};

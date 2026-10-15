import { Request, Response, NextFunction, RequestHandler } from 'express';
import { checkRateLimitWithFallback } from '../services/rateLimit.js';

/**
 * Per-model rate limits matching upstream provider capacity and financial risk:
 * - Claude Opus: strict 5 req/min (high upstream provider constraint & high cost)
 * - Claude Sonnet: 30 req/min
 * - GPT-4o: 60 req/min
 * - GPT-4o-mini: 200 req/min (fast, cheap utility model)
 */
export const MODEL_RATE_LIMITS: Record<string, { requestsPerMinute: number }> = {
  'claude-opus-4-8':   { requestsPerMinute: 5   },
  'claude-opus-4-6':   { requestsPerMinute: 5   },
  'claude-sonnet-4-6': { requestsPerMinute: 30  },
  'gpt-4o':            { requestsPerMinute: 60  },
  'gpt-4o-mini':       { requestsPerMinute: 200 },
};

const DEFAULT_LIMIT = 20;

/**
 * Middleware enforcing per-model RPM (Requests Per Minute) quotas per user.
 * Evaluates before global tier limits to isolate expensive frontier models.
 */
export const modelRateLimitMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const model: string = req.body?.model ?? 'gpt-4o-mini';
  const userId = req.user?._id?.toString() ?? req.ip ?? 'anonymous';
  const limitConfig = MODEL_RATE_LIMITS[model];
  const limit = limitConfig ? limitConfig.requestsPerMinute : DEFAULT_LIMIT;

  // 1-minute fixed window bucket
  const now = Date.now();
  const bucket = Math.floor(now / 60000);
  const key = `rl:model:${model}:${userId}:${bucket}`;

  const result = await checkRateLimitWithFallback(key, limit, 60);

  if (!result.allowed) {
    const secondsRemainingInMinute = 60 - (Math.floor(now / 1000) % 60);

    res.status(429).json({
      error: `Rate limit exceeded for model ${model}`,
      model,
      limit,
      remaining: 0,
      resetInSeconds: secondsRemainingInMinute
    });
    return;
  }

  next();
};

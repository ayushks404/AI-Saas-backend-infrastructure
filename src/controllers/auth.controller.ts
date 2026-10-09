import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User } from '../models/User.js';
import { signToken } from '../services/jwt.js';
import { redis } from '../lib/redis.js';
import { AppError } from '../lib/errors.js';
import { config } from '../config/env.js';

const BCRYPT_ROUNDS = 12;

// ==========================================
// 1. INPUT VALIDATION SCHEMAS (ZOD)
// ==========================================
export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required')
});

// ==========================================
// 2. CONTROLLER HANDLERS
// ==========================================

/**
 * POST /auth/register
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = RegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      const messages = parseResult.error.issues.map((i) => i.message).join(', ');
      return next(new AppError(messages, 400, 'VALIDATION_ERROR'));
    }

    const { email, password } = parseResult.data;

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return next(new AppError('Email is already registered', 409, 'EMAIL_EXISTS'));
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({
      email,
      passwordHash,
      tier: 'free'
    });

    const accessToken = await signToken({
      sub: user._id.toString(),
      tier: user.tier
    });

    // Generate cryptographically secure refresh token
    const refreshId = randomBytes(32).toString('hex');
    const refreshKey = `rt:${user._id}:${refreshId}`;
    await redis.setex(refreshKey, 7 * 86400, 'valid'); // 7 days in Redis

    // Set secure httpOnly cookie strictly for /auth/refresh
    res.cookie('refreshToken', `${user._id}:${refreshId}`, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      accessToken,
      userId: user._id,
      tier: user.tier
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/login
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parseResult = LoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const messages = parseResult.error.issues.map((i) => i.message).join(', ');
      return next(new AppError(messages, 400, 'VALIDATION_ERROR'));
    }

    const { email, password } = parseResult.data;

    // By default passwordHash is excluded (select: false in schema), so explicitly select it
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return next(new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS'));
    }

    const accessToken = await signToken({
      sub: user._id.toString(),
      tier: user.tier
    });

    const refreshId = randomBytes(32).toString('hex');
    const refreshKey = `rt:${user._id}:${refreshId}`;
    await redis.setex(refreshKey, 7 * 86400, 'valid');

    res.cookie('refreshToken', `${user._id}:${refreshId}`, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
      accessToken,
      userId: user._id,
      tier: user.tier
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/refresh
 */
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cookieVal = req.cookies?.refreshToken;
    if (!cookieVal) {
      return next(new AppError('Missing refresh token cookie', 401, 'MISSING_REFRESH_TOKEN'));
    }

    const [userId, refreshId] = cookieVal.split(':');
    if (!userId || !refreshId) {
      return next(new AppError('Malformed refresh token cookie', 401, 'INVALID_REFRESH_TOKEN'));
    }

    // ATOMIC VERIFY & INVALIDATE: getdel reads and deletes the token simultaneously
    const valid = await redis.getdel(`rt:${userId}:${refreshId}`);
    if (!valid) {
      return next(new AppError('Invalid, expired, or already-used refresh token', 401, 'INVALID_REFRESH_TOKEN'));
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return next(new AppError('User not found', 401, 'USER_NOT_FOUND'));
    }

    // Issue fresh access token
    const newAccessToken = await signToken({
      sub: user._id.toString(),
      tier: user.tier
    });

    // Issue and save fresh rotated refresh token
    const newRefreshId = randomBytes(32).toString('hex');
    await redis.setex(`rt:${user._id}:${newRefreshId}`, 7 * 86400, 'valid');

    res.cookie('refreshToken', `${user._id}:${newRefreshId}`, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
      accessToken: newAccessToken
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/me
 */
export function getMe(req: Request, res: Response): void {
  res.status(200).json({
    user: req.user
  });
}

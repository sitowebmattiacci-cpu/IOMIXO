import { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'

interface RateLimitOptions {
  windowMs: number
  max:      number
  message?: string
}

export function apiRateLimit({ windowMs, max, message }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
      error: message ?? `Too many requests. Please try again later.`,
    },
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return (req as any).user?.sub ?? req.ip ?? 'unknown'
    },
  })
}

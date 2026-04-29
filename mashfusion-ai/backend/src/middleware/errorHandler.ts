import { Request, Response, NextFunction } from 'express'
import { logger } from '../config/logger'

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public isOperational = true
  ) {
    super(message)
    this.name = 'AppError'
    Error.captureStackTrace(this, this.constructor)
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({ error: err.message, data: null })
    return
  }

  // Unexpected errors — don't leak details in production
  logger.error('Unhandled error', {
    error:   err.message,
    stack:   err.stack,
    url:     req.url,
    method:  req.method,
    reqId:   (req as any).id,
  })

  res.status(500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    data:  null,
  })
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found`, data: null })
}

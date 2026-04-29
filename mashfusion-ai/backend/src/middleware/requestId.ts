import { Request, Response, NextFunction } from 'express'
import { v4 as uuid } from 'uuid'

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) ?? uuid()
  ;(req as any).id = id
  res.setHeader('X-Request-ID', id)
  next()
}

import { headers } from 'next/headers'
import { resolvePortal, type ResolvedPortal } from './portal'

/** Portal of the current request (server components / generateMetadata). App Hosting forwards the public host in x-forwarded-host. */
export function getRequestPortal(): ResolvedPortal {
  const h = headers()
  return resolvePortal(h.get('x-forwarded-host') ?? h.get('host'))
}

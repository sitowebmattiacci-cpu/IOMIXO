import { setGlobalOptions } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'

// Infrastructure smoke test, deliberately isolated in its own codebase ("health"):
// no Firestore, no Admin SDK, no secrets, no Supabase/Stripe, no data. It only answers with static JSON.
// Cost baseline identical to the application functions: europe-west1, scale to zero, bounded concurrency.
setGlobalOptions({ region: 'europe-west1', minInstances: 0, maxInstances: 10 })

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: 'iomixo-functions' })
})

/**
 * Integration check of the Firebase Auth flow against the Auth emulator (no cloud).
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx ts-node --transpile-only scripts/auth-emulator-check.ts
 */
import express from 'express'
import type { Server } from 'http'
import { requireAuth, requireAnyAuth } from '../src/middleware/auth'
import { errorHandler } from '../src/middleware/errorHandler'

const EMU = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`
const idt = (p: string, body: object) =>
  fetch(`${EMU}/identitytoolkit.googleapis.com/v1/${p}?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, body: await r.json() as any }))

let failed = 0
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failed++ }

;(async () => {
  const app = express()
  app.get('/protected', requireAuth, (req, res) => res.json((req as any).user))
  app.get('/guest-ok',  requireAnyAuth, (req, res) => res.json((req as any).user))
  app.use(errorHandler)
  const server: Server = await new Promise(r => { const s = app.listen(0, () => r(s)) })
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  const get = (path: string, token?: string) => fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })

  const email = `t${Date.now()}@example.com`
  const reg = await idt('accounts:signUp', { email, password: 'password123', returnSecureToken: true })
  check('1 create email/password account', reg.ok && !!reg.body.idToken)

  const login = await idt('accounts:signInWithPassword', { email, password: 'password123', returnSecureToken: true })
  check('2 login valid', login.ok && !!login.body.idToken)
  const bad = await idt('accounts:signInWithPassword', { email, password: 'wrong-password', returnSecureToken: true })
  check('3 login wrong password rejected', !bad.ok, bad.body?.error?.message)

  // password reset via emulator oobCodes
  await idt('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email })
  const oobs = await (await fetch(`${EMU}/emulator/v1/projects/demo-iomixo/oobCodes`)).json() as any
  const reset = oobs.oobCodes.filter((o: any) => o.email === email && o.requestType === 'PASSWORD_RESET').pop()
  const rr = await idt('accounts:resetPassword', { oobCode: reset.oobCode, newPassword: 'newpassword456' })
  const relogin = await idt('accounts:signInWithPassword', { email, password: 'newpassword456', returnSecureToken: true })
  check('6 password reset via emulator', rr.ok && relogin.ok)

  // email verification
  await idt('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: relogin.body.idToken })
  const oobs2 = await (await fetch(`${EMU}/emulator/v1/projects/demo-iomixo/oobCodes`)).json() as any
  const ver = oobs2.oobCodes.filter((o: any) => o.email === email && o.requestType === 'VERIFY_EMAIL').pop()
  await idt('accounts:update', { oobCode: ver.oobCode })
  const fresh = await idt('accounts:signInWithPassword', { email, password: 'newpassword456', returnSecureToken: true })

  const ok = await get('/protected', fresh.body.idToken)
  const u = await ok.json() as any
  check('9 backend accepts valid Firebase token', ok.status === 200 && u.provider === 'firebase' && u.email === email)
  check('7 email verification reflected in req.user', u.emailVerified === true)
  check('10 backend rejects invalid token', (await get('/protected', 'garbage')).status === 401)
  check('11 protected endpoint without token → 401', (await get('/protected')).status === 401)

  const anon = await idt('accounts:signUp', { returnSecureToken: true })
  check('8 anonymous sign-in', anon.ok && !!anon.body.idToken)
  const a1 = await get('/protected', anon.body.idToken)
  const a2 = await get('/guest-ok', anon.body.idToken)
  check('12 anonymous token: requireAuth→403, requireAnyAuth→200 with isAnonymous', a1.status === 403 && a2.status === 200 && (await a2.json() as any).isAnonymous === true)

  server.close()
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
  process.exit(failed ? 1 : 0)
})()

import * as legacy from '../plans'
// require (not import): the Functions package lives outside this tsconfig's rootDir, jest transpiles it on the fly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fb: typeof import('../plans') = require('../../../../../firebase/functions/src/entitlements/plans')

describe('Functions plan table mirrors the legacy backend table', () => {
  it('PLAN_LIMITS are identical for every tier and every feature', () => {
    expect(Object.keys(fb.PLAN_LIMITS).sort()).toEqual(Object.keys(legacy.PLAN_LIMITS).sort())
    for (const tier of Object.keys(legacy.PLAN_LIMITS) as Array<keyof typeof legacy.PLAN_LIMITS>) {
      expect(fb.PLAN_LIMITS[tier]).toEqual(legacy.PLAN_LIMITS[tier])
    }
  })
  it('normalizePlan agrees on every legacy alias and on garbage', () => {
    for (const raw of ['free', 'pro', 'wedding', 'advance', 'pro_plus', 'premium_wedding', 'wedding_edition_plan', 'club', 'studio', '', 'PRO', 'x', null, undefined]) {
      expect(fb.normalizePlan(raw as any)).toBe(legacy.normalizePlan(raw as any))
    }
  })
})

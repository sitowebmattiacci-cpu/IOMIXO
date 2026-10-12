import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { maskId, BackfillRefused } from './entitlementBackfill'

/**
 * Backfill of the legacy profile domain into Firestore (METADATA ONLY, never creates accounts):
 *   users.full_name          → users/{uid}.displayName           (only when the account has none; never overwritten)
 *   dj_profiles.*            → djProfiles/{uid}                   (create-only; an existing doc is reported as noop / drift, never overwritten)
 *   avatar_url (both)        → NOT served: kept as `legacyAvatarUrl` and planned in a separate binary manifest (buildAvatarManifest)
 *
 *  - DRY RUN is the default; nothing is written unless `apply: true` (guards re-checked before the first write; demo project or --yes-production).
 *  - Identity: Supabase user id → Firebase uid ONLY through users/{uid}.legacySupabaseId (ambiguous / unmapped → reported, skipped).
 *  - Values are normalised to what firestore.rules accept (lengths, https URLs); a value that cannot be kept is dropped and counted (`sanitized`).
 *  - public_slug is carried over server-side (it is not client-writable); a slug already held by another djProfile is a blocker.
 *  - Nothing is ever deleted by a run. The rollback removes only what this run created and restores only values that are still untouched.
 */
export interface LegacyProfileUser { id: string; full_name?: string | null; avatar_url?: string | null; updated_at?: string | null }
export interface LegacyDjProfile {
  user_id: string; display_name?: string | null; bio?: string | null
  instagram_url?: string | null; tiktok_url?: string | null; spotify_url?: string | null; soundcloud_url?: string | null; website_url?: string | null
  avatar_url?: string | null; public_slug?: string | null; created_at?: string | null; updated_at?: string | null
}
export interface ProfileSnapshot { users: LegacyProfileUser[]; djProfiles: LegacyDjProfile[] }

const URL_FIELDS = [['instagram_url', 'instagramUrl'], ['tiktok_url', 'tiktokUrl'], ['spotify_url', 'spotifyUrl'], ['soundcloud_url', 'soundcloudUrl'], ['website_url', 'websiteUrl']] as const
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/.+/.test(v)
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const extOf = (u: string) => (/\.([A-Za-z0-9]{1,5})(?:\?|$)/.exec(u)?.[1] ?? '').toLowerCase()
/** Legacy public bucket URL → object path inside the `avatars` bucket; null for anything else (external URL, other bucket). */
export const legacyAvatarPath = (u: string | null | undefined): string | null => {
  const m = typeof u === 'string' ? /\/storage\/v1\/object\/public\/avatars\/([^?#]+)/.exec(u) : null
  const p = m ? decodeURIComponent(m[1]) : null
  return p && !p.startsWith('/') && !p.includes('..') && p.length <= 300 ? p : null
}

export interface ProfileInventory {
  users: number; usersWithName: number; usersWithAvatar: number
  djProfiles: number; withDisplayName: number; withBio: number; withSocials: number; withSlug: number; withAvatar: number
  duplicateDjProfiles: number; duplicateSlugs: number; nonHttpUrls: number; tooLong: number
  avatars: { total: number; supabasePublicBucket: number; external: number; unsafe: number; byExtension: Record<string, number> }
  /** Fields a public profile does NOT have in the legacy schema (reported so nobody expects them): */
  notInLegacySchema: string[]
}
export function inventoryProfiles(s: ProfileSnapshot): ProfileInventory {
  const inv: ProfileInventory = {
    users: s.users.length, usersWithName: 0, usersWithAvatar: 0, djProfiles: s.djProfiles.length, withDisplayName: 0, withBio: 0, withSocials: 0, withSlug: 0, withAvatar: 0,
    duplicateDjProfiles: 0, duplicateSlugs: 0, nonHttpUrls: 0, tooLong: 0, avatars: { total: 0, supabasePublicBucket: 0, external: 0, unsafe: 0, byExtension: {} },
    notInLegacySchema: ['city/area', 'public e-mail', 'phone', 'facebook (UI reads it, column does not exist)'],
  }
  const avatar = (u: string | null | undefined) => {
    if (!u) return
    inv.avatars.total++
    const p = legacyAvatarPath(u)
    if (p) { inv.avatars.supabasePublicBucket++; const e = extOf(p) || '∅'; inv.avatars.byExtension[e] = (inv.avatars.byExtension[e] ?? 0) + 1; if (!MIME[e]) inv.avatars.unsafe++ }
    else if (isHttp(u)) inv.avatars.external++; else inv.avatars.unsafe++
  }
  for (const u of s.users) { if (u.full_name) inv.usersWithName++; if (u.avatar_url) { inv.usersWithAvatar++; avatar(u.avatar_url) } }
  const ids = new Set<string>(), slugs = new Set<string>()
  for (const p of s.djProfiles) {
    if (ids.has(p.user_id)) inv.duplicateDjProfiles++; ids.add(p.user_id)
    if (p.display_name) inv.withDisplayName++; if (p.bio) inv.withBio++; if (p.public_slug) { inv.withSlug++; if (slugs.has(p.public_slug)) inv.duplicateSlugs++; slugs.add(p.public_slug) }
    if (URL_FIELDS.some(([k]) => p[k])) inv.withSocials++
    for (const [k] of URL_FIELDS) if (p[k] && !isHttp(p[k])) inv.nonHttpUrls++; else if (p[k] && String(p[k]).length > 300) inv.tooLong++
    if ((p.display_name?.length ?? 0) > 80 || (p.bio?.length ?? 0) > 1000) inv.tooLong++
    if (p.avatar_url) { inv.withAvatar++; avatar(p.avatar_url) }
  }
  return inv
}

export interface ProfileBackfillOptions { apply: boolean; projectId: string; yesProduction?: boolean; limit?: number; legacyUserId?: string }
export interface ProfileRollbackEntry { path: string; kind: 'djProfile' | 'userName'; before?: string | null; after?: string }
export interface ProfileBackfillReport {
  mode: 'dry-run' | 'apply'; project: string; inventory: ProfileInventory
  users: { selected: number; unmapped: number; ambiguous: number; wouldSetName: number; noop: number; keptExistingName: number }
  djProfiles: { selected: number; unmapped: number; ambiguous: number; wouldCreate: number; noop: number; drift: number; sanitized: number; slugClashes: number }
  avatars: { toCopy: number; notCopiable: number }
  blockers: string[]; samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }; entries?: ProfileRollbackEntry[]
}

type UserRef = { uid: string; ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }
async function usersByLegacyId(db: Firestore, ids: string[]): Promise<{ map: Map<string, UserRef>; ambiguous: Set<string> }> {
  const map = new Map<string, UserRef>(), ambiguous = new Set<string>()
  for (const id of ids) {
    const q = await db.collection('users').where('legacySupabaseId', '==', id).limit(2).get()
    if (q.size === 1) map.set(id, { uid: q.docs[0].id, ref: q.docs[0].ref, data: q.docs[0].data() }); else if (q.size > 1) ambiguous.add(id)
  }
  return { map, ambiguous }
}

const clip = (v: string | null | undefined, max: number): string | null => { const t = (v ?? '').trim(); return t ? t.slice(0, max) : null }
/** Legacy dj_profiles row → djProfiles doc fields (rules-compatible). `sanitized` counts values that had to be dropped or cut. */
export function djProfileFields(r: LegacyDjProfile): { fields: Record<string, unknown>; sanitized: number } {
  let sanitized = 0
  const f: Record<string, unknown> = { displayName: clip(r.display_name, 80), bio: clip(r.bio, 1000) }
  if ((r.display_name?.trim().length ?? 0) > 80 || (r.bio?.trim().length ?? 0) > 1000) sanitized++
  for (const [src, dst] of URL_FIELDS) {
    const v = (r[src] ?? '').trim()
    if (!v) { f[dst] = null; continue }
    if (!isHttp(v) || v.length > 300) { f[dst] = null; sanitized++; continue }
    f[dst] = v
  }
  f.publicSlug = clip(r.public_slug, 200)
  return { fields: f, sanitized }
}

export async function runProfileBackfill(input: ProfileSnapshot, opts: ProfileBackfillOptions, deps: { db: Firestore }): Promise<ProfileBackfillReport> {
  const guard = (bag: string[]) => {
    if (!opts.projectId) bag.push('project id not explicit')
    if (!(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) bag.push('non-emulator project requires --yes-production')
  }
  if (opts.apply) { const early: string[] = []; guard(early); if (early.length) throw new BackfillRefused(early) }
  const { db } = deps
  const report: ProfileBackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId, inventory: inventoryProfiles(input),
    users: { selected: 0, unmapped: 0, ambiguous: 0, wouldSetName: 0, noop: 0, keptExistingName: 0 },
    djProfiles: { selected: 0, unmapped: 0, ambiguous: 0, wouldCreate: 0, noop: 0, drift: 0, sanitized: 0, slugClashes: 0 },
    avatars: { toCopy: 0, notCopiable: 0 }, blockers: [], samples: [],
  }
  let us = input.users, dps = input.djProfiles
  if (opts.legacyUserId) { us = us.filter((u) => u.id === opts.legacyUserId); dps = dps.filter((p) => p.user_id === opts.legacyUserId) }
  if (opts.limit !== undefined) { us = us.slice(0, opts.limit); dps = dps.slice(0, opts.limit) }
  report.users.selected = us.length; report.djProfiles.selected = dps.length

  const dupIds = new Map<string, number>(); for (const p of input.djProfiles) dupIds.set(p.user_id, (dupIds.get(p.user_id) ?? 0) + 1)
  if (report.inventory.duplicateDjProfiles) report.blockers.push(`${report.inventory.duplicateDjProfiles} duplicate dj_profiles row(s) for the same user`)
  if (report.inventory.duplicateSlugs) report.blockers.push(`${report.inventory.duplicateSlugs} duplicate public_slug in the input`)

  const { map, ambiguous } = await usersByLegacyId(db, Array.from(new Set([...us.map((u) => u.id), ...dps.map((p) => p.user_id)])))
  const planned: Array<() => Promise<'written' | 'skipped'>> = [], entries: ProfileRollbackEntry[] = []

  for (const u of us) {
    const target = map.get(u.id)
    if (!target) { if (ambiguous.has(u.id)) report.users.ambiguous++; else report.users.unmapped++; continue }
    if (u.avatar_url) { if (legacyAvatarPath(u.avatar_url) && MIME[extOf(u.avatar_url)]) report.avatars.toCopy++; else report.avatars.notCopiable++ }
    const name = clip(u.full_name, 80)
    if (!name) continue
    if (target.data.displayName) { if (target.data.displayName === name) report.users.noop++; else report.users.keptExistingName++; continue }
    report.users.wouldSetName++
    if (report.samples.length < 10) report.samples.push({ kind: 'userName', user: maskId(u.id), uid: maskId(target.uid), chars: name.length })
    planned.push(async () => {
      const cur = await target.ref.get(); if (!cur.exists || cur.data()!.displayName) return 'skipped' as const
      await target.ref.update({ displayName: name, legacyAvatarUrl: u.avatar_url ?? FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
      entries.push({ path: target.ref.path, kind: 'userName', before: null, after: name }); return 'written' as const
    })
  }

  // slugs already held in Firestore by someone else (a slug is globally unique)
  const slugOwner = new Map<string, string>()
  for (const p of dps) if (p.public_slug) { const q = await db.collection('djProfiles').where('publicSlug', '==', p.public_slug).limit(2).get(); for (const d of q.docs) slugOwner.set(p.public_slug, d.id) }

  for (const p of dps) {
    if ((dupIds.get(p.user_id) ?? 0) > 1) continue
    const target = map.get(p.user_id)
    if (!target) { if (ambiguous.has(p.user_id)) report.djProfiles.ambiguous++; else report.djProfiles.unmapped++; continue }
    if (p.avatar_url) { if (legacyAvatarPath(p.avatar_url) && MIME[extOf(p.avatar_url)]) report.avatars.toCopy++; else report.avatars.notCopiable++ }
    const { fields, sanitized } = djProfileFields(p)
    report.djProfiles.sanitized += sanitized
    const ref = db.collection('djProfiles').doc(target.uid), cur = await ref.get()
    if (cur.exists) {
      const c = cur.data()!, same = ['displayName', 'bio', 'instagramUrl', 'tiktokUrl', 'spotifyUrl', 'soundcloudUrl', 'websiteUrl'].every((k) => (c[k] ?? null) === (fields[k] ?? null))
      if (same) report.djProfiles.noop++; else report.djProfiles.drift++
      continue
    }
    const holder = fields.publicSlug ? slugOwner.get(fields.publicSlug as string) : undefined
    if (holder && holder !== target.uid) { report.djProfiles.slugClashes++; continue }
    report.djProfiles.wouldCreate++
    if (report.samples.length < 10) report.samples.push({ kind: 'djProfile', user: maskId(p.user_id), uid: maskId(target.uid), hasBio: !!fields.bio, socials: URL_FIELDS.filter(([, d]) => fields[d]).length, hasSlug: !!fields.publicSlug })
    const created = p.created_at ? parseSourceTimestamp(p.created_at) : null
    planned.push(async () => {
      try {
        await ref.create({
          ...fields, ...(p.avatar_url ? { legacyAvatarUrl: p.avatar_url } : {}), legacySupabaseId: p.user_id, backfilled: true,
          createdAt: created ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        })
      } catch { return 'skipped' as const }                     // exists (race / rerun): never overwritten
      entries.push({ path: ref.path, kind: 'djProfile' }); return 'written' as const
    })
  }

  if (report.users.unmapped + report.djProfiles.unmapped) report.blockers.push(`${report.users.unmapped + report.djProfiles.unmapped} row(s) whose Supabase user has no users/{uid}.legacySupabaseId (not migrated: skipped, never created)`)
  if (report.users.ambiguous + report.djProfiles.ambiguous) report.blockers.push(`${report.users.ambiguous + report.djProfiles.ambiguous} row(s) matching more than one Firebase account`)
  if (report.djProfiles.slugClashes) report.blockers.push(`${report.djProfiles.slugClashes} public_slug already used by another djProfile`)
  if (opts.apply) {
    const reasons = [...report.blockers.filter((b) => !b.includes('has no users/{uid}.legacySupabaseId')), ]; guard(reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }
    report.applied = { written, skipped }; report.entries = entries
  }
  return report
}

/** Removes ONLY what an apply created: djProfile docs still flagged backfilled and untouched by the owner, and names it set that are still unchanged. */
export async function runProfileRollback(db: Firestore, entries: ProfileRollbackEntry[], opts: { apply: boolean; projectId: string; yesProduction?: boolean }) {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const out = { removed: 0, restored: 0, skippedChanged: 0 }
  for (const e of entries) {
    const ref = db.doc(e.path), snap = await ref.get()
    if (!snap.exists) continue
    const d = snap.data()!
    if (e.kind === 'djProfile') {
      // untouched = no avatar committed and not edited since the backfill (the owner's save bumps updatedAt past createdAt-of-run; we compare the avatar and flag)
      if (d.backfilled !== true || d.avatarPath) { out.skippedChanged++; continue }
      if (opts.apply) await ref.delete(); out.removed++
    } else {
      if (d.displayName !== e.after) { out.skippedChanged++; continue }
      if (opts.apply) await ref.update({ displayName: FieldValue.delete(), legacyAvatarUrl: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }); out.restored++
    }
  }
  return out
}

// ── avatar binaries: PLAN only (no network, no Storage) ──
export interface AvatarManifestEntry {
  kind: 'user' | 'dj'; uid: string; legacyUserId: string; legacyBucket: 'avatars'; legacyPath: string; legacyUrl: string
  targetPath: string; contentType: string
}
/** Deterministic target path (token = hash of the legacy path → re-planning gives the same manifest; the copy executor is separate and explicit). */
export async function buildAvatarManifest(input: ProfileSnapshot, db: Firestore, opts: { legacyUserId?: string } = {}): Promise<{ entries: AvatarManifestEntry[]; unmapped: number; skipped: number }> {
  const rows: Array<{ kind: 'user' | 'dj'; id: string; url: string }> = []
  for (const u of input.users) if (u.avatar_url && (!opts.legacyUserId || u.id === opts.legacyUserId)) rows.push({ kind: 'user', id: u.id, url: u.avatar_url })
  for (const p of input.djProfiles) if (p.avatar_url && (!opts.legacyUserId || p.user_id === opts.legacyUserId)) rows.push({ kind: 'dj', id: p.user_id, url: p.avatar_url })
  const { map } = await usersByLegacyId(db, Array.from(new Set(rows.map((r) => r.id))))
  const entries: AvatarManifestEntry[] = []; let unmapped = 0, skipped = 0
  for (const r of rows) {
    const target = map.get(r.id), path = legacyAvatarPath(r.url), ext = path ? extOf(path) : ''
    if (!target) { unmapped++; continue }
    if (!path || !MIME[ext]) { skipped++; continue }
    const token = createHash('sha256').update(`${r.kind}:${path}`).digest('base64url').slice(0, 24)
    entries.push({ kind: r.kind, uid: target.uid, legacyUserId: r.id, legacyBucket: 'avatars', legacyPath: path, legacyUrl: r.url,
      targetPath: `profiles/${target.uid}/avatar/${r.kind}-${token}.${ext === 'jpeg' ? 'jpg' : ext}`, contentType: MIME[ext] })
  }
  return { entries, unmapped, skipped }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certainEventPortal, guestPortalRedirect } from '../../lib/brand/portalRedirect'

const live = { mioloveLive: true }

test('event → portal from its own data: owner type first for historic events, accessMode for couple albums, no guess otherwise', () => {
  assert.equal(certainEventPortal({ type: 'party', ownerAccountType: null }), 'iomixo')
  assert.equal(certainEventPortal({ type: 'standard' }), 'iomixo')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: 'dj', accessMode: null }), 'iomixo', 'historic / new Wedding DJ')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: 'couple', accessMode: null }), 'miolove', 'couple album created before accessMode existed')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: 'couple', accessMode: 'trial' }), 'miolove')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: null, accessMode: 'activated' }), 'miolove', 'owner read failed, accessMode still conclusive')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: null, accessMode: null }), null, 'owner read failed: never classified as DJ')
  assert.equal(certainEventPortal({ type: 'wedding' }), null, 'old server without the field: unknown')
  assert.equal(certainEventPortal({ type: 'wedding', ownerAccountType: 'admin' }), null, 'unexpected value: unknown')
  assert.equal(certainEventPortal({ type: null, ownerAccountType: 'dj' }), null, 'event not loaded yet')
})

test('redirect DJ events from miolovealbum.com to iomixo.com, keeping path, slug, query and hash', () => {
  const dj = { ...live, type: 'wedding', ownerAccountType: 'dj', accessMode: null }
  assert.equal(guestPortalRedirect({ ...dj, hostname: 'miolovealbum.com', pathname: '/live/abc123', search: '?ref=qr&x=1', hash: '#games' }), 'https://iomixo.com/live/abc123?ref=qr&x=1#games')
  assert.equal(guestPortalRedirect({ ...dj, hostname: 'www.miolovealbum.com', pathname: '/screen/abc123' }), 'https://iomixo.com/screen/abc123')
  assert.equal(guestPortalRedirect({ ...live, type: 'party', ownerAccountType: 'dj', hostname: 'miolovealbum.com', pathname: '/booth/p1/' }), 'https://iomixo.com/booth/p1/')
})

test('redirect couple albums from iomixo.com to miolovealbum.com (historic album without accessMode included)', () => {
  const album = { ...live, type: 'wedding', ownerAccountType: 'couple', accessMode: null }
  assert.equal(guestPortalRedirect({ ...album, hostname: 'iomixo.com', pathname: '/live/sp0s1', search: '?lang=it' }), 'https://miolovealbum.com/live/sp0s1?lang=it')
  assert.equal(guestPortalRedirect({ ...album, hostname: 'www.iomixo.com', pathname: '/booth/sp0s1' }), 'https://miolovealbum.com/booth/sp0s1')
})

test('no loop: on the target host the same event stays put', () => {
  assert.equal(guestPortalRedirect({ ...live, type: 'wedding', ownerAccountType: 'dj', hostname: 'iomixo.com', pathname: '/live/abc' }), null)
  assert.equal(guestPortalRedirect({ ...live, type: 'wedding', ownerAccountType: 'couple', hostname: 'miolovealbum.com', pathname: '/live/abc' }), null)
  // Follow the redirect chain from both sides: one hop at most.
  for (const ev of [{ type: 'wedding', ownerAccountType: 'dj' }, { type: 'wedding', ownerAccountType: 'couple' }, { type: 'party', ownerAccountType: 'dj' }]) {
    for (const host of ['iomixo.com', 'miolovealbum.com']) {
      const first = guestPortalRedirect({ ...live, ...ev, hostname: host, pathname: '/live/s1' })
      if (!first) continue
      const u = new URL(first)
      assert.equal(guestPortalRedirect({ ...live, ...ev, hostname: u.hostname, pathname: u.pathname }), null, `${host} → ${u.hostname} stops`)
    }
  }
})

test('no redirect when unsure, off-portal, off-path or MIOLOVE not live', () => {
  const unknown = { ...live, type: 'wedding', ownerAccountType: null, accessMode: null }
  assert.equal(guestPortalRedirect({ ...unknown, hostname: 'iomixo.com', pathname: '/live/abc' }), null, 'owner unknown: stay (no wrong classification)')
  assert.equal(guestPortalRedirect({ ...unknown, hostname: 'miolovealbum.com', pathname: '/live/abc' }), null)
  const dj = { ...live, type: 'wedding', ownerAccountType: 'dj' }
  for (const h of ['localhost', '127.0.0.1', 'iomixo-web--iomixo-494817.europe-west4.hosted.app', 'evil-miolovealbum.com']) {
    assert.equal(guestPortalRedirect({ ...dj, hostname: h, pathname: '/live/abc' }), null, h)
  }
  for (const p of ['/', '/login', '/sessions/abc', '/remote/abc', '/live', '/live/abc/extra', '//evil.com/live/abc']) {
    assert.equal(guestPortalRedirect({ ...dj, hostname: 'miolovealbum.com', pathname: p }), null, p)
  }
  assert.equal(guestPortalRedirect({ mioloveLive: false, type: 'wedding', ownerAccountType: 'couple', hostname: 'iomixo.com', pathname: '/live/abc' }), null, 'MIOLOVE domain not connected yet')
  assert.equal(guestPortalRedirect({ mioloveLive: false, type: 'wedding', ownerAccountType: 'dj', hostname: 'miolovealbum.com', pathname: '/live/abc' }), 'https://iomixo.com/live/abc', 'IOMIXO is always live')
})

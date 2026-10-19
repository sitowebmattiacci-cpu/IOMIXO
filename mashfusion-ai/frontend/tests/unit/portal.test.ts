import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PORTAL_CONFIG, normalizeHost, getPortalFromHostname, resolvePortal, portalForEventType, publicBaseFor, djToolsBase, actionHopOrigin,
} from '../../lib/portal'

test('portal config: two portals, one role each, canonical origins', () => {
  assert.equal(PORTAL_CONFIG.iomixo.accountType, 'dj'); assert.equal(PORTAL_CONFIG.iomixo.baseUrl, 'https://iomixo.com'); assert.equal(PORTAL_CONFIG.iomixo.theme, 'party')
  assert.equal(PORTAL_CONFIG.miolove.accountType, 'couple'); assert.equal(PORTAL_CONFIG.miolove.baseUrl, 'https://miolovealbum.com'); assert.equal(PORTAL_CONFIG.miolove.theme, 'wedding')
  assert.deepEqual([...PORTAL_CONFIG.miolove.hosts], ['miolovealbum.com', 'www.miolovealbum.com'])
  assert.equal(PORTAL_CONFIG.miolove.meta.title, 'MIOLOVE ALBUM')
  assert.doesNotMatch(JSON.stringify(PORTAL_CONFIG.miolove), /iomixo/i, 'the MIOLOVE portal config never mentions IOMIXO')
})

test('portal detection by hostname (port, case, proxy lists, www) and safe default for every other host', () => {
  assert.equal(normalizeHost('MioloveAlbum.com:3000'), 'miolovealbum.com'); assert.equal(normalizeHost('a.com, b.com'), 'a.com'); assert.equal(normalizeHost(null), '')
  for (const h of ['iomixo.com', 'www.iomixo.com', 'IOMIXO.com:443']) assert.equal(getPortalFromHostname(h), 'iomixo', h)
  for (const h of ['miolovealbum.com', 'www.miolovealbum.com', 'miolovealbum.com:8080']) assert.equal(getPortalFromHostname(h), 'miolove', h)
  for (const h of ['localhost', '127.0.0.1:3000', 'iomixo-web--iomixo-494817.europe-west4.hosted.app', 'iolovealbum.com', 'evil-miolovealbum.com', 'miolovealbum.com.evil.io', '']) assert.equal(getPortalFromHostname(h), null, h)
  assert.deepEqual([resolvePortal('localhost').config.id, resolvePortal('localhost').matched], ['iomixo', false], 'unknown host → IOMIXO default, not matched')
  assert.deepEqual([resolvePortal('www.miolovealbum.com').config.id, resolvePortal('www.miolovealbum.com').matched], ['miolove', true])
})

test('event type → portal: Wedding is MIOLOVE, Party / standard are IOMIXO', () => {
  assert.equal(portalForEventType('wedding'), 'miolove'); assert.equal(portalForEventType('party'), 'iomixo'); assert.equal(portalForEventType('standard'), 'iomixo'); assert.equal(portalForEventType(undefined), 'iomixo')
})

test('public links: Wedding → MIOLOVE even from iomixo.com, Party → IOMIXO even from miolovealbum.com; dev hosts keep their origin; go-live switch off keeps today\'s origin', () => {
  const live = { mioloveLive: true }
  assert.equal(publicBaseFor('wedding', { ...live, hostname: 'iomixo.com', origin: 'https://iomixo.com' }), 'https://miolovealbum.com')
  assert.equal(publicBaseFor('wedding', { ...live, hostname: 'www.iomixo.com', origin: 'https://www.iomixo.com' }), 'https://miolovealbum.com')
  assert.equal(publicBaseFor('wedding', { ...live, hostname: 'miolovealbum.com', origin: 'https://miolovealbum.com' }), 'https://miolovealbum.com')
  assert.equal(publicBaseFor('party', { ...live, hostname: 'iomixo.com', origin: 'https://iomixo.com' }), 'https://iomixo.com')
  assert.equal(publicBaseFor('party', { ...live, hostname: 'miolovealbum.com', origin: 'https://miolovealbum.com' }), 'https://iomixo.com')
  assert.equal(publicBaseFor('standard', { ...live, hostname: 'www.miolovealbum.com', origin: 'https://www.miolovealbum.com' }), 'https://iomixo.com')
  assert.equal(publicBaseFor('wedding', { ...live, hostname: 'localhost', origin: 'http://localhost:3000' }), 'http://localhost:3000')
  assert.equal(publicBaseFor('party', { ...live, hostname: '127.0.0.1', origin: 'http://127.0.0.1:4000' }), 'http://127.0.0.1:4000')
  assert.equal(publicBaseFor('wedding', { mioloveLive: false, hostname: 'iomixo.com', origin: 'https://iomixo.com' }), 'https://iomixo.com', 'domain not connected yet: nothing changes')
  assert.equal(publicBaseFor('party', { mioloveLive: false, hostname: 'iomixo.com', origin: 'https://iomixo.com' }), 'https://iomixo.com')
})

test('DJ tools (Remote) stay on IOMIXO whatever the event type or host', () => {
  assert.equal(djToolsBase({ hostname: 'iomixo.com', origin: 'https://iomixo.com' }), 'https://iomixo.com')
  assert.equal(djToolsBase({ hostname: 'miolovealbum.com', origin: 'https://miolovealbum.com' }), 'https://iomixo.com')
  assert.equal(djToolsBase({ hostname: 'localhost', origin: 'http://localhost:3000' }), 'http://localhost:3000')
})

test('no redirect between portals is decided by the account type any more (wrongPortalTarget is gone)', async () => {
  const mod = await import('../../lib/portal') as Record<string, unknown>
  assert.equal('wrongPortalTarget' in mod, false)
})

test('Firebase action link hop: only to the OTHER known portal (https), never to an arbitrary URL', () => {
  assert.equal(actionHopOrigin('https://miolovealbum.com/login', 'iomixo.com'), 'https://miolovealbum.com')
  assert.equal(actionHopOrigin('https://iomixo.com/login', 'www.miolovealbum.com'), 'https://iomixo.com')
  assert.equal(actionHopOrigin('https://miolovealbum.com/login', 'miolovealbum.com'), null, 'already there')
  assert.equal(actionHopOrigin('https://miolovealbum.com/login', 'www.miolovealbum.com'), null)
  assert.equal(actionHopOrigin('https://evil.example/login', 'iomixo.com'), null); assert.equal(actionHopOrigin('http://miolovealbum.com/login', 'iomixo.com'), null)
  assert.equal(actionHopOrigin('https://miolovealbum.com.evil.io/x', 'iomixo.com'), null); assert.equal(actionHopOrigin('not a url', 'iomixo.com'), null); assert.equal(actionHopOrigin(null, 'iomixo.com'), null)
  assert.equal(actionHopOrigin('https://miolovealbum.com/login', 'localhost'), 'https://miolovealbum.com', 'a dev host is not a portal, a real portal continueUrl is still honoured')
})

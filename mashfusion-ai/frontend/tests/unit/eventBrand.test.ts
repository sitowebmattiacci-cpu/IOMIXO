import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portalForEventType, publicBaseFor } from '../../lib/portal'
import { eventBrandOf, hasPhotoFeatures } from '../../lib/brand/eventBrand'

test('event owner → portal: a Sposi album is MIOLOVE, a DJ\'s Wedding stays IOMIXO', () => {
  assert.equal(portalForEventType('wedding', 'couple'), 'miolove')
  assert.equal(portalForEventType('wedding', 'dj'), 'iomixo')
  assert.equal(portalForEventType('party', 'dj'), 'iomixo')
  assert.equal(portalForEventType('wedding', null), 'miolove', 'owner unknown keeps the legacy rule')
})

test('public links of a Wedding DJ event use iomixo.com, a Sposi album keeps miolovealbum.com', () => {
  const ctx = { mioloveLive: true, hostname: 'iomixo.com', origin: 'https://iomixo.com' }
  assert.equal(publicBaseFor('wedding', { ...ctx, owner: 'dj' }), 'https://iomixo.com')
  assert.equal(publicBaseFor('wedding', { ...ctx, owner: 'couple' }), 'https://miolovealbum.com')
  assert.equal(publicBaseFor('wedding', { ...ctx, hostname: 'miolovealbum.com', origin: 'https://miolovealbum.com', owner: 'dj' }), 'https://iomixo.com')
  assert.equal(publicBaseFor('wedding', { mioloveLive: true, hostname: 'localhost', origin: 'http://localhost:3000', owner: 'dj' }), 'http://localhost:3000')
})

test('event brand: only Sposi albums are MIOLOVE (and only they have photo features)', () => {
  assert.equal(eventBrandOf({ type: 'party' }), 'iomixo')
  assert.equal(eventBrandOf({ type: 'standard', hostname: 'miolovealbum.com' }), 'iomixo')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: 'couple' }), 'miolove')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: 'dj', hostname: 'miolovealbum.com' }), 'iomixo')
  assert.equal(eventBrandOf({ type: 'wedding', accessMode: 'trial', hostname: 'iomixo.com' }), 'miolove')
  assert.equal(eventBrandOf({ type: 'wedding', accessMode: 'activated' }), 'miolove')
  assert.equal(eventBrandOf({ type: 'wedding', accessMode: null, hostname: 'iomixo.com' }), 'iomixo', 'a DJ Wedding carries no accessMode')
  assert.equal(eventBrandOf({ type: 'wedding', accessMode: null, hostname: 'www.miolovealbum.com' }), 'miolove', 'legacy album opened on its own domain')
  assert.equal(hasPhotoFeatures('miolove'), true)
  assert.equal(hasPhotoFeatures('iomixo'), false)
})

test('event brand of historic events: the owner decides; the hostname only when the owner is unknown', () => {
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: 'couple', accessMode: null, hostname: 'iomixo.com' }), 'miolove', 'couple album without accessMode, opened on iomixo.com')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: 'dj', accessMode: null, hostname: 'miolovealbum.com' }), 'iomixo', 'Wedding DJ QR printed with a miolovealbum.com link')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: 'dj', accessMode: 'trial' }), 'miolove', 'accessMode is written by the server only for couple albums')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: null, accessMode: null, hostname: 'miolovealbum.com' }), 'miolove', 'owner unknown: hostname fallback, never "DJ" by default')
  assert.equal(eventBrandOf({ type: 'wedding', ownerAccountType: null, accessMode: null, hostname: 'iomixo.com' }), 'iomixo')
})

import type { Metadata } from 'next'
import { MIOLOVE_PRIVATE_ROBOTS } from '@/lib/miolove/seo'

/**
 * Metadata of the guest surfaces (album /live, Live Booth /booth, TV /screen). `manifest: null` drops the root layout's web-app manifest link: a guest page
 * is opened from a QR code or a chat link and must behave as a plain web page in every browser, never as something to install or hand over to an
 * installed app. MIOLOVE adds the noindex meta tag that matches the middleware's X-Robots-Tag.
 */
export function guestPageMetadata(miolove: boolean): Metadata {
  return miolove ? { manifest: null, robots: MIOLOVE_PRIVATE_ROBOTS } : { manifest: null }
}

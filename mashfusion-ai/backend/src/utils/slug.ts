import crypto from 'crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Generate a URL-safe random slug. Default length 10 (~60 bits of entropy). */
export function randomSlug(length = 10): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** Try generating a slug up to `attempts` times, calling `exists(slug)` to check uniqueness. */
export async function uniqueSlug(exists: (slug: string) => Promise<boolean>, attempts = 5): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const slug = randomSlug(10 + i) // grow if collisions happen
    if (!(await exists(slug))) return slug
  }
  throw new Error('Could not generate a unique slug')
}

/** Convert user input into a URL-friendly slug fragment. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// Smart random selection with short-term memory.
// Picks a random option while avoiding the ones that came out in the most
// recent spins, so the roulette feels random but never repeats the same
// penalty back-to-back (or within the last few spins when possible).

/**
 * Pick a random option, avoiding the most recently used ones.
 *
 * Strategy:
 *  1. Exclude the last `avoidCount` recent ids → pick from the rest.
 *  2. If nothing is left, only exclude the very last id (no immediate repeat).
 *  3. If still nothing (e.g. a single option), fall back to all options.
 */
export function getSmartRandomOption<T extends { id: string }>(
  options: T[],
  recentIds: string[] = [],
  avoidCount = 3
): T | null {
  if (!options.length) return null

  const recentToAvoid = recentIds.slice(-avoidCount)

  let available = options.filter((o) => !recentToAvoid.includes(o.id))

  if (!available.length && recentIds.length) {
    const lastId = recentIds[recentIds.length - 1]
    available = options.filter((o) => o.id !== lastId)
  }

  if (!available.length) {
    available = options
  }

  return available[Math.floor(Math.random() * available.length)]
}

import { parseSourceTimestamp } from '../gameRoundRepository'

describe('parseSourceTimestamp (Postgres timestamptz → Firestore Timestamp, microsecond-exact)', () => {
  it('keeps microseconds and handles Z / +00:00 / +0200 / space separator', () => {
    const a = parseSourceTimestamp('2026-02-01T10:00:00.123456+00:00')!, b = parseSourceTimestamp('2026-02-01T10:00:00.123456Z')!
    expect(a.nanoseconds).toBe(123456000); expect(a.isEqual(b)).toBe(true)
    expect(parseSourceTimestamp('2026-02-01 12:00:00.5+02')!.isEqual(parseSourceTimestamp('2026-02-01T10:00:00.500000Z')!)).toBe(true)
    expect(parseSourceTimestamp('2026-02-01T12:00:00+0200')!.seconds).toBe(Date.parse('2026-02-01T10:00:00Z') / 1000)
    expect(parseSourceTimestamp('2026-02-01T10:00:00.123457Z')!.valueOf()).not.toBe(parseSourceTimestamp('2026-02-01T10:00:00.123456Z')!.valueOf())
  })
  it('rejects anything that is not a timestamp', () => {
    for (const bad of [undefined, null, 12, '', 'yesterday', '2026-13-45T00:00:00Z']) expect(parseSourceTimestamp(bad)).toBeNull()
  })
})

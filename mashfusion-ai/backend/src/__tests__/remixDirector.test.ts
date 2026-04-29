/**
 * Unit tests: remixDirector.ts — interpretRemixPrompt()
 *
 * All tests run purely in-process (no network calls) because:
 *   - OPENAI_API_KEY is unset in setup.ts → LLM path is skipped
 *   - The rule engine is synchronous pure-function logic
 */

import { interpretRemixPrompt } from '../services/remixDirector'

// ── Helper ────────────────────────────────────────────────────
async function interpret(prompt: string) {
  const result = await interpretRemixPrompt(prompt)
  expect(result).not.toBeNull()
  return result!
}

// ══════════════════════════════════════════════════════════════
describe('interpretRemixPrompt', () => {

  // ── Null / empty input ─────────────────────────────────────
  test('returns null for empty string', async () => {
    expect(await interpretRemixPrompt('')).toBeNull()
    expect(await interpretRemixPrompt('   ')).toBeNull()
    expect(await interpretRemixPrompt(null)).toBeNull()
    expect(await interpretRemixPrompt(undefined)).toBeNull()
  })

  test('caps raw_prompt at 500 characters', async () => {
    const long = 'a'.repeat(600)
    const result = await interpret(long)
    expect(result.raw_prompt.length).toBe(500)
  })

  // ── Style detection ────────────────────────────────────────
  test('detects EDM festival style', async () => {
    const r = await interpret('Make it an EDM banger with a massive drop')
    expect(r.style_profile).toBe('edm_festival')
    expect(r.target_energy).toBe('explosive')
  })

  test('detects house club style', async () => {
    const r = await interpret('Groovy house club feel with 4/4 kick')
    expect(r.style_profile).toBe('house_club')
  })

  test('detects chill/lofi style', async () => {
    const r = await interpret('Make it a chill lo-fi sunset vibe')
    expect(r.style_profile).toBe('chill_sunset')
    expect(r.tempo_adjustment).toBe('slightly_slower')
    expect(r.transition_density).toBe('minimal')
  })

  test('detects emotional/cinematic style', async () => {
    const r = await interpret('Deep emotional mood, nostalgic and melancholic')
    expect(r.style_profile).toBe('deep_emotional')
    expect(r.target_energy).toBe('slow_build')
  })

  test('detects cinematic style', async () => {
    const r = await interpret('Epic cinematic orchestral score with dramatic ending')
    expect(r.style_profile).toBe('cinematic')
    expect(r.finale_intensity).toBe('explosive')
  })

  test('detects pop radio style', async () => {
    const r = await interpret('Radio-ready pop hit with a catchy hook')
    expect(r.style_profile).toBe('pop_radio')
  })

  test('detects viral/TikTok style', async () => {
    const r = await interpret('TikTok viral trending 2025')
    expect(r.style_profile).toBe('viral_modern')
    expect(r.modernity_level).toBe('viral')
  })

  // ── Tempo detection ────────────────────────────────────────
  test('detects slower tempo', async () => {
    const r = await interpret('Make it slower, halftime feel')
    expect(r.tempo_adjustment).toBe('slower')
  })

  test('detects faster tempo', async () => {
    const r = await interpret('Sped-up version, faster energy')
    expect(r.tempo_adjustment).toBe('faster')
  })

  test('defaults to original tempo', async () => {
    const r = await interpret('Just make it sound amazing')
    expect(r.tempo_adjustment).toBe('original')
  })

  // ── Vocal priority ─────────────────────────────────────────
  test('detects track A vocal priority', async () => {
    const r = await interpret('Use the main vocal from track A')
    expect(r.vocal_priority).toBe('track_a')
  })

  test('detects track B vocal priority', async () => {
    const r = await interpret('Vocals from track B please')
    expect(r.vocal_priority).toBe('track_b')
  })

  test('detects instrumental (no vocals)', async () => {
    const r = await interpret('Remove all vocals, pure instrumental')
    expect(r.vocal_priority).toBe('instrumental')
  })

  // ── Instrument overlay ─────────────────────────────────────
  test('detects piano overlay', async () => {
    const r = await interpret('Add warm piano keys underneath')
    expect(r.instrument_overlay).toBe('piano_pads')
  })

  test('detects synth lead overlay', async () => {
    const r = await interpret('Synth lead arpeggios')
    expect(r.instrument_overlay).toBe('synth_leads')
  })

  test('detects strings overlay', async () => {
    const r = await interpret('Dramatic orchestral strings')
    expect(r.instrument_overlay).toBe('strings')
  })

  // ── Transition style ───────────────────────────────────────
  test('detects aggressive transitions', async () => {
    const r = await interpret('Hard cuts and aggressive transitions')
    expect(r.transition_density).toBe('aggressive')
  })

  test('detects smooth transitions', async () => {
    const r = await interpret('Seamless smooth blend between sections')
    expect(r.transition_density).toBe('smooth')
  })

  // ── Finale intensity ───────────────────────────────────────
  test('detects explosive finale', async () => {
    const r = await interpret('Big epic end, huge climax')
    expect(r.finale_intensity).toBe('explosive')
  })

  test('detects fade-out ending', async () => {
    const r = await interpret('Fade out at the end, soft gentle finish')
    expect(r.finale_intensity).toBe('fade_out')
  })

  // ── Surprise factor ────────────────────────────────────────
  test('detects "surprise me" at max surprise', async () => {
    const r = await interpret('Surprise me, do something crazy')
    expect(r.surprise_factor).toBe(1.0)
  })

  test('detects experimental flag', async () => {
    const r = await interpret('Be bold and experimental, something unique')
    expect(r.surprise_factor).toBeGreaterThan(0)
  })

  // ── Output shape ───────────────────────────────────────────
  test('always returns processing_headline and processing_steps', async () => {
    const r = await interpret('Make a great mashup')
    expect(typeof r.processing_headline).toBe('string')
    expect(r.processing_headline.length).toBeGreaterThan(0)
    expect(Array.isArray(r.processing_steps)).toBe(true)
    expect(r.processing_steps.length).toBeGreaterThan(0)
  })

  test('returns raw_prompt in output', async () => {
    const prompt = 'EDM festival energy'
    const r = await interpret(prompt)
    expect(r.raw_prompt).toBe(prompt)
  })

  test('confidence is between 0 and 1', async () => {
    const r = await interpret('House club track')
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })

  // ── Multi-signal input ─────────────────────────────────────
  test('handles compound prompt with multiple signals', async () => {
    const r = await interpret(
      'Emotional cinematic mashup, slow build, piano pads, fade out ending, track A vocals'
    )
    expect(r.style_profile).toMatch(/cinematic|deep_emotional/)
    expect(r.instrument_overlay).toBe('piano_pads')
    expect(r.finale_intensity).toBe('fade_out')
    expect(r.vocal_priority).toBe('track_a')
  })

})

/**
 * MASHFUSION AI — Remix Director Interpreter Engine
 *
 * Converts a user's free-text remix vision into structured machine
 * parameters that drive the AI pipeline: stem priorities, energy curves,
 * transition behaviour, style profile, and mastering intensity.
 *
 * Two-tier approach:
 *   1. Rule-based NLP (always runs first — zero latency, no API cost)
 *   2. OpenAI completion (optional enhancement when OPENAI_API_KEY is set)
 *      The LLM refines/overrides specific fields the rule engine misses.
 *
 * Output shape: RemixDirectorParams (see types at bottom of file)
 */

import { logger } from '../config/logger'

// ── Types ────────────────────────────────────────────────────────────────────

export type EnergyProfile    = 'slow_build' | 'medium_slow_rise' | 'steady' | 'high_energy' | 'explosive' | 'dreamy'
export type StyleProfile     = 'edm_festival' | 'house_club' | 'deep_emotional' | 'pop_radio' | 'cinematic' | 'chill_sunset' | 'viral_modern' | 'auto'
export type TempoAdjustment  = 'slower' | 'slightly_slower' | 'original' | 'slightly_faster' | 'faster'
export type VocalPriority    = 'track_a' | 'track_b' | 'balanced' | 'instrumental'
export type TransitionDensity= 'minimal' | 'smooth' | 'dynamic' | 'aggressive'
export type FinaleIntensity  = 'fade_out' | 'standard' | 'high' | 'explosive'
export type ModernityLevel   = 'classic' | 'modern' | 'cutting_edge' | 'viral'

export interface RemixDirectorParams {
  /** Raw user input preserved for display */
  raw_prompt:           string
  /** Detected genre/style profile — maps to existing preset names */
  style_profile:        StyleProfile
  /** Energy arc of the mashup */
  target_energy:        EnergyProfile
  /** BPM adjustment intent */
  tempo_adjustment:     TempoAdjustment
  /** Which track's vocals dominate */
  vocal_priority:       VocalPriority
  /** Instrument atmosphere layers (e.g. 'piano_pads', 'synth_leads') */
  instrument_overlay:   string | null
  /** How aggressive transitions between sections are */
  transition_density:   TransitionDensity
  /** Intensity of the final section */
  finale_intensity:     FinaleIntensity
  /** How current/viral the sound should feel */
  modernity_level:      ModernityLevel
  /** 0–1 probability that the user wants surprises */
  surprise_factor:      number
  /** Confidence of the rule engine (0–1); lower = LLM helped more */
  confidence:           number
  /** Human-readable summary shown in UI during processing */
  processing_headline:  string
  processing_steps:     string[]
}

// ── Default neutral params ────────────────────────────────────────────────────

const DEFAULTS: Omit<RemixDirectorParams, 'raw_prompt' | 'processing_headline' | 'processing_steps'> = {
  style_profile:      'auto',
  target_energy:      'steady',
  tempo_adjustment:   'original',
  vocal_priority:     'balanced',
  instrument_overlay: null,
  transition_density: 'smooth',
  finale_intensity:   'standard',
  modernity_level:    'modern',
  surprise_factor:    0.0,
  confidence:         1.0,
}

// ══════════════════════════════════════════════════════════════════════════════
// RULE-BASED CLASSIFIER
// Maps keyword/phrase clusters → parameter values.
// Each rule is intentionally broad to capture natural language variation.
// ══════════════════════════════════════════════════════════════════════════════

interface RuleSet {
  patterns:   RegExp[]
  apply:      (params: Partial<RemixDirectorParams>) => void
}

const RULES: RuleSet[] = [
  // ── Style / Genre ──────────────────────────────────────────
  {
    patterns: [/\bedm\b/i, /\bfestival\b/i, /\bdrop\b/i, /\bbig room\b/i, /\belectronic\b/i],
    apply: (p) => { p.style_profile = 'edm_festival'; p.target_energy = 'explosive'; p.transition_density = 'aggressive'; p.finale_intensity = 'explosive' },
  },
  {
    patterns: [/\bhouse\b/i, /\bclub\b/i, /\bdancefloor\b/i, /\bgroov/i, /\b4[- ]?4\b/i],
    apply: (p) => { p.style_profile = 'house_club'; p.target_energy = 'high_energy'; p.transition_density = 'dynamic' },
  },
  {
    patterns: [/\bchill\b/i, /\blofi\b/i, /\blo[- ]?fi\b/i, /\brelax/i, /\bsunset\b/i, /\blaid[- ]back\b/i],
    apply: (p) => { p.style_profile = 'chill_sunset'; p.target_energy = 'dreamy'; p.tempo_adjustment = 'slightly_slower'; p.transition_density = 'minimal' },
  },
  {
    patterns: [/\bemotional\b/i, /\bnostalgic\b/i, /\bsad\b/i, /\bmelanchol/i, /\bheartbreak\b/i, /\bdeep\b/i],
    apply: (p) => { p.style_profile = 'deep_emotional'; p.target_energy = 'slow_build'; p.tempo_adjustment = 'slightly_slower'; p.transition_density = 'smooth' },
  },
  {
    patterns: [/\bcinematic\b/i, /\bepic\b/i, /\borchest/i, /\bfilm\b/i, /\bscore\b/i, /\bdramatic\b/i],
    apply: (p) => { p.style_profile = 'cinematic'; p.target_energy = 'slow_build'; p.transition_density = 'smooth'; p.finale_intensity = 'explosive' },
  },
  {
    patterns: [/\bpop\b/i, /\bradio\b/i, /\bhit\b/i, /\bcatchy\b/i, /\bcommercial\b/i],
    apply: (p) => { p.style_profile = 'pop_radio'; p.target_energy = 'high_energy'; p.transition_density = 'dynamic'; p.modernity_level = 'cutting_edge' },
  },
  {
    patterns: [/\btiktok\b/i, /\bviral\b/i, /\btrend/i, /\bmodern\b/i, /\b2024\b/i, /\b2025\b/i, /\b2026\b/i],
    apply: (p) => { p.style_profile = 'viral_modern'; p.modernity_level = 'viral'; p.transition_density = 'aggressive'; p.target_energy = 'explosive' },
  },

  // ── Energy / Mood ──────────────────────────────────────────
  {
    patterns: [/\benerget/i, /\bpowerful\b/i, /\bintense\b/i, /\bbanger\b/i, /\bpumping\b/i, /\bhype\b/i],
    apply: (p) => { p.target_energy = 'explosive'; p.finale_intensity = 'explosive' },
  },
  {
    patterns: [/\bdream/i, /\bathmosp/i, /\bairy\b/i, /\bfloat/i, /\betherea/i, /\bspa\b/i],
    apply: (p) => { p.target_energy = 'dreamy'; p.instrument_overlay = 'ambient_pads'; p.transition_density = 'minimal' },
  },
  {
    patterns: [/\bsummer\b/i, /\bupbeat\b/i, /\bhappy\b/i, /\bjoyful\b/i, /\bfun\b/i, /\bfestive\b/i],
    apply: (p) => { p.target_energy = 'high_energy'; p.tempo_adjustment = 'slightly_faster' },
  },
  {
    patterns: [/\bbuild/i, /\brise\b/i, /\bgrow/i, /\bescalat/i, /\bbuild[- ]?up\b/i],
    apply: (p) => { p.target_energy = 'slow_build'; p.finale_intensity = 'explosive' },
  },

  // ── Tempo ──────────────────────────────────────────────────
  {
    patterns: [/\bslow\b/i, /\bslower\b/i, /\bslowed\b/i, /\bhalftime\b/i],
    apply: (p) => { p.tempo_adjustment = 'slower' },
  },
  {
    patterns: [/\ba bit slow/i, /\bslightly slow/i, /\bmore relaxed tempo\b/i],
    apply: (p) => { p.tempo_adjustment = 'slightly_slower' },
  },
  {
    patterns: [/\bfaster\b/i, /\bquicker\b/i, /\bsped[- ]?up\b/i, /\bspeed up\b/i],
    apply: (p) => { p.tempo_adjustment = 'faster' },
  },

  // ── Vocal priority ─────────────────────────────────────────
  {
    patterns: [/vocal.*track\s*[a1]/i, /use.*vocal.*first/i, /track a.*vocal/i, /main.*vocal/i],
    apply: (p) => { p.vocal_priority = 'track_a' },
  },
  {
    patterns: [/vocal.*track\s*[b2]/i, /use.*vocal.*second/i, /track b.*vocal/i],
    apply: (p) => { p.vocal_priority = 'track_b' },
  },
  {
    patterns: [/\binstrumental\b/i, /\bno vocal/i, /\bwithout vocal/i, /\bremove vocal/i],
    apply: (p) => { p.vocal_priority = 'instrumental' },
  },
  {
    patterns: [/\bequal vocal/i, /\bboth vocal/i, /\bbalanced\b/i, /\bmix.*vocal/i],
    apply: (p) => { p.vocal_priority = 'balanced' },
  },

  // ── Instrument overlay ─────────────────────────────────────
  {
    patterns: [/\bpiano\b/i, /\bkeys\b/i, /\bkeyboard\b/i],
    apply: (p) => { p.instrument_overlay = 'piano_pads' },
  },
  {
    patterns: [/\bguitar\b/i, /\bacoustic\b/i],
    apply: (p) => { p.instrument_overlay = 'guitar_texture' },
  },
  {
    patterns: [/\bsynth\b/i, /\blead\b/i, /\barp\b/i, /\bsequencer\b/i],
    apply: (p) => { p.instrument_overlay = 'synth_leads' },
  },
  {
    patterns: [/\bstring/i, /\borchest/i, /\bviolin\b/i, /\bcello\b/i],
    apply: (p) => { p.instrument_overlay = 'strings' },
  },
  {
    patterns: [/\bpad\b/i, /\bambient\b/i, /\btexture\b/i, /\batmospher/i],
    apply: (p) => { p.instrument_overlay = 'ambient_pads' },
  },
  {
    patterns: [/\bbass\b/i, /\bsub\b/i, /\bboosted bass\b/i],
    apply: (p) => { p.instrument_overlay = 'deep_bass' },
  },

  // ── Transition aggressiveness ──────────────────────────────
  {
    patterns: [/\bsmooth/i, /\bseamless\b/i, /\bsubtle\b/i, /\bsoft trans/i],
    apply: (p) => { p.transition_density = 'smooth' },
  },
  {
    patterns: [/\bjump cut\b/i, /\bhard cut\b/i, /\baggressive\b/i, /\bsharp\b/i, /\bsnappy\b/i],
    apply: (p) => { p.transition_density = 'aggressive' },
  },
  {
    patterns: [/\bdynamic\b/i, /\bvariet/i, /\bdifferent transition/i],
    apply: (p) => { p.transition_density = 'dynamic' },
  },
  {
    patterns: [/\bminimal transition/i, /\bfew transition/i, /\bsimple\b/i],
    apply: (p) => { p.transition_density = 'minimal' },
  },

  // ── Finale / ending ────────────────────────────────────────
  {
    patterns: [/\bbig.*end/i, /\bexplosive.*end/i, /\bpowerful.*ending/i, /\bhuge.*chorus/i, /\bepic.*end/i, /\bclimax\b/i, /\bhuge.*climax/i],
    apply: (p) => { p.finale_intensity = 'explosive' },
  },
  {
    patterns: [/\bfade.*out\b/i, /\bsoft.*end/i, /\bquiet.*end/i, /\bgentl.*end/i],
    apply: (p) => { p.finale_intensity = 'fade_out' },
  },
  {
    patterns: [/\bstrong.*end/i, /\bimpactful\b/i],
    apply: (p) => { p.finale_intensity = 'high' },
  },

  // ── Surprise / experimental ────────────────────────────────
  {
    patterns: [/\bsurprise\b/i, /\bunexpected\b/i, /\bexperimental\b/i, /\bcreative\b/i, /\bunique\b/i, /\bbold\b/i],
    apply: (p) => { p.surprise_factor = 0.8 },
  },
  {
    patterns: [/\bsurprise me\b/i, /\bwow me\b/i, /\bshock me\b/i, /\bdo something crazy\b/i],
    apply: (p) => { p.surprise_factor = 1.0 },
  },
]

// ── Processing steps shown in the UI ─────────────────────────────────────────

const PROCESSING_STEPS: Record<StyleProfile, string[]> = {
  edm_festival:    ['Analysing festival energy curve…', 'Setting explosive drop points…', 'Injecting EDM power structure…', 'Mastering for stadium volume…'],
  house_club:      ['Detecting groove pockets…', 'Aligning 4/4 pulse across tracks…', 'Injecting club-ready transitions…', 'Mastering for dancefloor…'],
  deep_emotional:  ['Mapping emotional arc…', 'Selecting vocal dominance…', 'Designing atmospheric layers…', 'Shaping melancholic energy curve…'],
  pop_radio:       ['Optimising verse-chorus flow…', 'Tuning commercial hook timing…', 'Polishing for radio brightness…', 'Applying competitive loudness…'],
  cinematic:       ['Building cinematic tension arc…', 'Layering orchestral texture…', 'Designing dramatic finale…', 'Applying film-grade mastering…'],
  chill_sunset:    ['Creating relaxed groove pocket…', 'Softening transient edges…', 'Designing warm atmospheric tail…', 'Mastering for lo-fi warmth…'],
  viral_modern:    ['Detecting viral sound palette…', 'Designing TikTok-ready hook…', 'Applying modern compression style…', 'Optimising for streaming loudness…'],
  auto:            ['Interpreting your remix vision…', 'Designing energy curve…', 'Selecting vocal dominance…', 'Injecting requested atmosphere…'],
}

function buildHeadline(params: Partial<RemixDirectorParams>): string {
  const mood: Record<StyleProfile, string> = {
    edm_festival:   'explosive EDM festival',
    house_club:     'groovy house club',
    deep_emotional: 'emotional & cinematic',
    pop_radio:      'radio-ready pop',
    cinematic:      'epic cinematic',
    chill_sunset:   'chill ambient',
    viral_modern:   'viral modern',
    auto:           'AI-directed',
  }
  const style = params.style_profile ?? 'auto'
  return `Creating your ${mood[style]} remix`
}

// ══════════════════════════════════════════════════════════════════════════════
// RULE ENGINE — main classifier
// ══════════════════════════════════════════════════════════════════════════════

function runRuleEngine(prompt: string): Partial<RemixDirectorParams> {
  const partial: Partial<RemixDirectorParams> = {}
  let matched = 0

  for (const rule of RULES) {
    const hit = rule.patterns.some((re) => re.test(prompt))
    if (hit) {
      rule.apply(partial)
      matched++
    }
  }

  // Confidence proportional to how many rules fired
  partial.confidence = Math.min(0.5 + matched * 0.1, 1.0)
  return partial
}

// ══════════════════════════════════════════════════════════════════════════════
// OPENAI ENHANCER (optional)
// Only called when OPENAI_API_KEY env var is set.
// Fills in fields the rule engine left at default.
// ══════════════════════════════════════════════════════════════════════════════

async function enhanceWithLLM(
  prompt: string,
  ruleParams: Partial<RemixDirectorParams>
): Promise<Partial<RemixDirectorParams>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return {}

  const systemPrompt = `You are a music production AI assistant for MASHFUSION AI.
Convert the user's remix description into structured JSON parameters.
Return ONLY valid JSON matching this exact schema (all fields required):
{
  "style_profile": "edm_festival|house_club|deep_emotional|pop_radio|cinematic|chill_sunset|viral_modern|auto",
  "target_energy": "slow_build|medium_slow_rise|steady|high_energy|explosive|dreamy",
  "tempo_adjustment": "slower|slightly_slower|original|slightly_faster|faster",
  "vocal_priority": "track_a|track_b|balanced|instrumental",
  "instrument_overlay": "piano_pads|guitar_texture|synth_leads|strings|ambient_pads|deep_bass|null",
  "transition_density": "minimal|smooth|dynamic|aggressive",
  "finale_intensity": "fade_out|standard|high|explosive",
  "modernity_level": "classic|modern|cutting_edge|viral",
  "surprise_factor": 0.0
}
Only change fields where the user's request clearly implies something different from the current values.
Current rule-engine result: ${JSON.stringify(ruleParams)}`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens:  300,
      }),
    })

    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`)

    const json = await response.json() as Record<string, unknown>
    const raw  = (json.choices as Array<{message:{content:string}}>)?.[0]?.message?.content ?? ''
    // Extract JSON from potential markdown code block
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON in LLM response')

    const llmResult = JSON.parse(match[0])
    // Only use fields that are valid enum values (security: never trust LLM blindly)
    return sanitiseLLMOutput(llmResult)
  } catch (err) {
    logger.warn(`RemixDirector LLM enhancement failed: ${err}`)
    return {}
  }
}

function sanitiseLLMOutput(raw: Record<string, unknown>): Partial<RemixDirectorParams> {
  const valid: Partial<RemixDirectorParams> = {}

  const STYLE_PROFILES    = new Set(['edm_festival','house_club','deep_emotional','pop_radio','cinematic','chill_sunset','viral_modern','auto'])
  const ENERGY_PROFILES   = new Set(['slow_build','medium_slow_rise','steady','high_energy','explosive','dreamy'])
  const TEMPO_ADJ         = new Set(['slower','slightly_slower','original','slightly_faster','faster'])
  const VOCAL_PRIO        = new Set(['track_a','track_b','balanced','instrumental'])
  const INST_OVERLAYS     = new Set(['piano_pads','guitar_texture','synth_leads','strings','ambient_pads','deep_bass',null,'null'])
  const TRANS_DENSITY     = new Set(['minimal','smooth','dynamic','aggressive'])
  const FINALE_INTENSITY  = new Set(['fade_out','standard','high','explosive'])
  const MODERNITY         = new Set(['classic','modern','cutting_edge','viral'])

  if (STYLE_PROFILES.has(raw.style_profile as string))   valid.style_profile      = raw.style_profile as StyleProfile
  if (ENERGY_PROFILES.has(raw.target_energy as string))  valid.target_energy      = raw.target_energy as EnergyProfile
  if (TEMPO_ADJ.has(raw.tempo_adjustment as string))     valid.tempo_adjustment   = raw.tempo_adjustment as TempoAdjustment
  if (VOCAL_PRIO.has(raw.vocal_priority as string))      valid.vocal_priority     = raw.vocal_priority as VocalPriority
  if (INST_OVERLAYS.has(raw.instrument_overlay as string | null)) {
    valid.instrument_overlay = raw.instrument_overlay === 'null' ? null : raw.instrument_overlay as string | null
  }
  if (TRANS_DENSITY.has(raw.transition_density as string)) valid.transition_density = raw.transition_density as TransitionDensity
  if (FINALE_INTENSITY.has(raw.finale_intensity as string)) valid.finale_intensity = raw.finale_intensity as FinaleIntensity
  if (MODERNITY.has(raw.modernity_level as string))        valid.modernity_level   = raw.modernity_level as ModernityLevel
  if (typeof raw.surprise_factor === 'number')             valid.surprise_factor   = Math.max(0, Math.min(1, raw.surprise_factor))

  return valid
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Interpret a free-text remix prompt into RemixDirectorParams.
 * Falls back to neutral defaults for any undetected dimension.
 */
export async function interpretRemixPrompt(
  prompt: string | null | undefined
): Promise<RemixDirectorParams | null> {
  if (!prompt || prompt.trim().length === 0) return null

  const trimmed = prompt.trim().slice(0, 500)  // hard cap for safety

  // 1. Rule engine
  const ruleResult = runRuleEngine(trimmed)

  // 2. LLM enhancement (only if key set and confidence is low)
  let llmResult: Partial<RemixDirectorParams> = {}
  if ((ruleResult.confidence ?? 1) < 0.7) {
    llmResult = await enhanceWithLLM(trimmed, ruleResult)
  }

  // 3. Merge: defaults ← rules ← LLM
  const merged: RemixDirectorParams = {
    ...DEFAULTS,
    ...ruleResult,
    ...llmResult,
    raw_prompt: trimmed,
    processing_headline: '',
    processing_steps:    [],
  }

  merged.processing_headline = buildHeadline(merged)
  merged.processing_steps    = PROCESSING_STEPS[merged.style_profile] ?? PROCESSING_STEPS.auto

  logger.info(`RemixDirector: interpreted "${trimmed.slice(0, 60)}…" → style=${merged.style_profile} energy=${merged.target_energy} confidence=${merged.confidence}`)

  return merged
}

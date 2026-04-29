'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Mic2, X } from 'lucide-react'

// ── Quick-chips ───────────────────────────────────────────────
const CHIPS = [
  { label: 'EDM',         insert: 'Make it an explosive EDM festival anthem with a massive drop' },
  { label: 'House',       insert: 'Groovy house club banger with punchy kicks and smooth transitions' },
  { label: 'Chill',       insert: 'Chill lo-fi sunset vibe — relaxed tempo, warm atmospheric pads' },
  { label: 'Emotional',   insert: 'Deep emotional and cinematic — slow build, nostalgic mood' },
  { label: 'Radio Pop',   insert: 'Catchy radio-ready pop with a powerful chorus and modern sound' },
  { label: 'Cinematic',   insert: 'Epic cinematic score — dramatic tension arc and orchestral layers' },
  { label: 'Viral TikTok',insert: 'Viral TikTok-ready — modern sound, fast hook, cutting-edge style' },
  { label: 'Surprise Me', insert: 'Surprise me — do something bold and unexpected' },
] as const

// ── Placeholder cycle ─────────────────────────────────────────
const PLACEHOLDERS = [
  'e.g. "Make it a chill lo-fi banger with warm piano pads…"',
  'e.g. "Epic cinematic build with a massive final drop…"',
  'e.g. "Groovy house club feel — smooth transitions, punchy kicks…"',
  'e.g. "Deep emotional mood — nostalgic, slow build, big ending…"',
  'e.g. "Viral TikTok energy — modern sound and fast hook…"',
]

const MAX_CHARS = 500

interface Props {
  value:    string
  onChange: (v: string) => void
}

export function RemixDirectorInput({ value, onChange }: Props) {
  const [focused,   setFocused]   = useState(false)
  const [phIdx,     setPhIdx]     = useState(0)
  const textareaRef               = useRef<HTMLTextAreaElement>(null)

  // Cycle placeholder text when empty + unfocused
  useEffect(() => {
    if (focused || value) return
    const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3000)
    return () => clearInterval(id)
  }, [focused, value])

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const appendChip = useCallback((insert: string) => {
    const next = value
      ? `${value.trimEnd()}. ${insert}`
      : insert
    onChange(next.slice(0, MAX_CHARS))
    textareaRef.current?.focus()
  }, [value, onChange])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value.slice(0, MAX_CHARS))
  }

  const charCount  = value.length
  const nearLimit  = charCount > MAX_CHARS * 0.85
  const atLimit    = charCount >= MAX_CHARS

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600">
          <Mic2 className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-none">
            Remix Director
            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              AI
            </span>
          </p>
          <p className="text-[11px] text-white/35 mt-0.5">
            Describe your vision — the AI will interpret it into production parameters
          </p>
        </div>
      </div>

      {/* ── Textarea ── */}
      <div className={`relative rounded-2xl border transition-all duration-200 ${
        focused
          ? 'border-violet-500/60 bg-violet-500/5 shadow-[0_0_0_3px_rgba(139,92,246,0.15)]'
          : value
          ? 'border-white/15 bg-white/[0.03]'
          : 'border-white/8 bg-white/[0.02] hover:border-white/12'
      }`}>
        {/* Gradient orb (decoration) */}
        <div className="pointer-events-none absolute -top-4 -right-4 h-24 w-24 rounded-full bg-violet-600/10 blur-2xl" />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={3}
          className="relative z-10 w-full resize-none bg-transparent px-4 pt-4 pb-10 text-sm text-white/90 placeholder:text-white/20 focus:outline-none"
          placeholder={PLACEHOLDERS[phIdx]}
          style={{ minHeight: '96px' }}
        />

        {/* Footer row: clear + char count */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-4 pb-3">
          {value ? (
            <button
              type="button"
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/40 hover:bg-white/15 hover:text-white/70 transition-all"
              onClick={() => onChange('')}
              tabIndex={-1}
              aria-label="Clear"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          ) : (
            <span />
          )}
          <span className={`pointer-events-none text-[10px] font-medium tabular-nums transition-colors ${
            atLimit   ? 'text-red-400' :
            nearLimit ? 'text-amber-400' :
                        'text-white/20'
          }`}>
            {charCount}/{MAX_CHARS}
          </span>
        </div>
      </div>

      {/* ── Quick-chips ── */}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map(({ label, insert }) => (
          <motion.button
            key={label}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => appendChip(insert)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all duration-150 ${
              label === 'Surprise Me'
                ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20'
                : 'border-white/10 bg-white/[0.04] text-white/50 hover:border-white/20 hover:text-white/80'
            }`}
          >
            {label === 'Surprise Me' && <Sparkles className="mr-1 inline h-2.5 w-2.5" />}
            {label}
          </motion.button>
        ))}
      </div>

      {/* ── Active hint (shown when value is non-empty) ── */}
      <AnimatePresence>
        {value.trim().length > 10 && (
          <motion.div
            key="hint"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2 rounded-xl bg-violet-500/8 border border-violet-500/15 px-3 py-2.5">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
              <p className="text-[11px] text-white/50 leading-relaxed">
                The AI will interpret your description to set energy curves, vocal priorities,
                transition style, mastering preset, and more — before processing begins.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

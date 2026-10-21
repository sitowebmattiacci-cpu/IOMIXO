// Structure of the "Idee per usare MIOLOVE" guide: which ideas exist, how hard they are and which occasions they fit. All the TEXT lives in
// locales/miolove/*.json under `ideas.*` (title, text, when, why per idea). There is no game engine: every idea is played with what an album
// already does (guests scan the QR, send photos and videos, the owner sees them in the gallery and on the big screen).
export type IdeaId = 'hunt' | 'tables' | 'beforeAfter' | 'colour' | 'generations' | 'details' | 'emoji' | 'angle' | 'candid' | 'keepsake'
export type IdeaOccasion = 'wedding' | 'birthday' | 'baptism' | 'other'
export type IdeaDifficulty = 'easy' | 'medium'

export const IDEA_OCCASIONS: readonly IdeaOccasion[] = ['wedding', 'birthday', 'baptism', 'other']

export const IDEAS: ReadonlyArray<{ id: IdeaId; difficulty: IdeaDifficulty; occasions: readonly IdeaOccasion[] }> = [
  { id: 'hunt',        difficulty: 'easy',   occasions: ['wedding', 'birthday', 'baptism', 'other'] },
  { id: 'tables',      difficulty: 'easy',   occasions: ['wedding', 'birthday', 'other'] },
  { id: 'beforeAfter', difficulty: 'medium', occasions: ['wedding', 'birthday', 'baptism'] },
  { id: 'colour',      difficulty: 'easy',   occasions: ['wedding', 'birthday', 'other'] },
  { id: 'generations', difficulty: 'easy',   occasions: ['wedding', 'birthday', 'baptism', 'other'] },
  { id: 'details',     difficulty: 'easy',   occasions: ['wedding', 'baptism', 'birthday'] },
  { id: 'emoji',       difficulty: 'easy',   occasions: ['birthday', 'other', 'wedding'] },
  { id: 'angle',       difficulty: 'medium', occasions: ['wedding', 'birthday', 'other'] },
  { id: 'candid',      difficulty: 'easy',   occasions: ['wedding', 'birthday', 'baptism', 'other'] },
  { id: 'keepsake',    difficulty: 'medium', occasions: ['birthday', 'baptism', 'wedding', 'other'] },
]

/** Ideas suggested first for each occasion (the guide's "per ogni occasione" blocks): order matters. */
export const IDEAS_BY_OCCASION = (o: IdeaOccasion): IdeaId[] => IDEAS.filter((i) => i.occasions.includes(o)).map((i) => i.id)
export const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const

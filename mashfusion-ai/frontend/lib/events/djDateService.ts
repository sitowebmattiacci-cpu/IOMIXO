import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, serverTimestamp, type DocumentData,
} from 'firebase/firestore'
import { getFirebaseDb } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import type { DjEvent } from '../api'

/** DJ upcoming dates at djProfiles/{uid}/dates/{id} (owner CRUD, firestore.rules). Public ones reach guests through getPublicEvent. */
async function datesRef() {
  const user = await waitForAuthReady()
  if (!user || user.isAnonymous) throw new Error('Accedi con il tuo account')
  return { db: getFirebaseDb(), col: (db = getFirebaseDb()) => collection(db, 'djProfiles', user.uid, 'dates') }
}

const clip = (v: string | null | undefined, max: number) => { const t = (v ?? '').trim(); return t ? t.slice(0, max) : null }

const toEvent = (id: string, d: DocumentData): DjEvent => ({
  id, title: d.title ?? '', event_date: d.eventDate ?? null, venue_name: d.venueName ?? null, city: d.city ?? null,
  ticket_url: d.ticketUrl ?? null, is_public: d.isPublic === true,
})

const toDoc = (p: Partial<DjEvent>) => ({
  ...(p.title !== undefined ? { title: p.title.trim().slice(0, 120) } : {}),
  ...(p.event_date !== undefined ? { eventDate: p.event_date || null } : {}),
  ...(p.venue_name !== undefined ? { venueName: clip(p.venue_name, 120) } : {}),
  ...(p.city !== undefined ? { city: clip(p.city, 120) } : {}),
  ...(p.ticket_url !== undefined ? { ticketUrl: clip(p.ticket_url, 300) } : {}),
  ...(p.is_public !== undefined ? { isPublic: p.is_public } : {}),
})

export const djDates = {
  async list(): Promise<DjEvent[]> {
    const { col } = await datesRef()
    const snap = await getDocs(col())
    return snap.docs.map((d) => toEvent(d.id, d.data()))
      .sort((a, b) => (a.event_date ?? '9999').localeCompare(b.event_date ?? '9999'))
  },
  async create(input: Partial<DjEvent>): Promise<DjEvent> {
    if (!input.title?.trim()) throw new Error('Titolo evento obbligatorio')
    const { col } = await datesRef()
    const data = { title: '', eventDate: null, venueName: null, city: null, ticketUrl: null, isPublic: true, ...toDoc(input) }
    const ref = await addDoc(col(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return toEvent(ref.id, data)
  },
  // Rules validate the whole document, so the update rewrites the merged one.
  async update(id: string, patch: Partial<DjEvent>): Promise<DjEvent> {
    const { col } = await datesRef()
    const ref = doc(col(), id)
    const cur = await getDoc(ref)
    if (!cur.exists()) throw new Error('Evento non trovato')
    const { createdAt: _c, updatedAt: _u, ...rest } = cur.data()
    void _c; void _u
    const next = { ...rest, ...toDoc(patch) }
    await updateDoc(ref, { ...next, updatedAt: serverTimestamp() })
    return toEvent(id, next)
  },
  async remove(id: string): Promise<void> {
    const { col } = await datesRef()
    await deleteDoc(doc(col(), id))
  },
}

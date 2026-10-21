// Demo photographs of the MIOLOVE home (hero, phone, screen, album, occasions). One manifest: replacing a picture means dropping a file in
// public/demo/miolove/ and editing its entry here. The files are the SOURCE images (PNG, 1086×1448 portrait; party-friends 1448×1086 landscape): they are never re-encoded; next/image serves
// resized WebP/AVIF versions to the browser.

export type DemoOccasion = 'wedding' | 'birthday' | 'baptism' | 'other'
export interface DemoPhoto {
  src: string
  width: number
  height: number
  /** i18n key (locales/miolove/*: home.demoAlt.*): what the picture shows, in the visitor's language. */
  altKey: string
  /** CSS object-position used when the picture is cropped (landscape screen, square thumbnails): keeps the faces in frame. */
  focus?: string
}

const P = (name: string, altKey: string, focus = '50% 40%', [width, height]: readonly [number, number] = [1086, 1448]): DemoPhoto => ({ src: `/demo/miolove/${name}.png`, width, height, altKey: `home.demoAlt.${altKey}`, focus })

const PHOTO = {
  martinaCandles: P('birthday-martina', 'martinaCandles', '50% 62%'),
  martinaSelfie: P('birthday-selfie', 'martinaSelfie', '50% 55%'),
  martinaGarden: P('garden-party', 'martinaGarden', '55% 55%'),
  martinaQrTable: P('birthday-qr-table', 'martinaQrTable', '62% 58%'),
  weddingParty: P('wedding-party', 'weddingParty', '50% 40%'),
  weddingGuestsPhones: P('wedding-guests-phones', 'weddingGuestsPhones', '50% 35%'),
  // "Altro evento": a generic evening party (friends dancing and toasting). No bride, groom, veil or ceremony: it must never read as a wedding.
  partyFriends: P('party-friends', 'partyFriends', '50% 40%', [1448, 1086]),
  baptism: P('baptism-family', 'baptism', '50% 45%'),
} as const

export const DEMO_PHOTOS = PHOTO

/** The sample event shown everywhere on the home: "Compleanno di Martina". Same photos on the phone, on the big screen and in the owner's album. */
export const DEMO_EVENT = {
  /** i18n: home.preview.sampleName */
  titleKey: 'home.preview.sampleName',
  /** Date printed on the table card of the sample event (photo `martinaQrTable`): the demo shows the same one everywhere. */
  date: '2026-10-25',
  /** The cover is the first one. */
  photos: [PHOTO.martinaCandles, PHOTO.martinaSelfie, PHOTO.martinaGarden, PHOTO.martinaQrTable],
} as const

/** One cover per occasion (home "every occasion" cards). */
export const OCCASION_COVERS: Record<DemoOccasion, DemoPhoto> = {
  wedding: PHOTO.weddingParty,       // the newlyweds dancing with their guests (lively party, not the old embrace)
  birthday: PHOTO.martinaCandles,
  baptism: PHOTO.baptism,
  other: PHOTO.partyFriends,
}

/** Small "guests are sharing" pictures floating around the hero phone. */
export const HERO_EXTRAS = [PHOTO.weddingGuestsPhones, PHOTO.martinaGarden] as const

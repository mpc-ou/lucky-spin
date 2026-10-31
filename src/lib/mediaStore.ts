import { create } from 'zustand'
import { audio } from '../audio/audioManager'

/**
 * User-uploaded media (background image, background music), kept in IndexedDB so it survives
 * reloads. One slot per kind: a new upload overwrites the previous one.
 */
export type MediaKind = 'backstage' | 'music'
interface MediaRecord {
  blob: Blob
  name: string
  at: number
}

const DB = 'lucky-spin'
const STORE = 'media'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close()) as Promise<T>
}

interface MediaState {
  backstageUrl: string | null
  backstageName: string | null
  backstageType: 'image' | 'video' | null
  musicName: string | null
  /** object URL of the uploaded music (for previews) */
  musicUrl: string | null
}

export const useMedia = create<MediaState>(() => ({ backstageUrl: null, backstageName: null, backstageType: null, musicName: null, musicUrl: null }))

function apply(kind: MediaKind, rec: MediaRecord | undefined) {
  if (kind === 'backstage') {
    const old = useMedia.getState().backstageUrl
    if (old) URL.revokeObjectURL(old)
    const isVideo = rec ? rec.blob.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(rec.name) : false
    useMedia.setState({
      backstageUrl: rec ? URL.createObjectURL(rec.blob) : null,
      backstageName: rec?.name ?? null,
      backstageType: rec ? (isVideo ? 'video' : 'image') : null,
    })
  } else {
    const old = useMedia.getState().musicUrl
    if (old) URL.revokeObjectURL(old)
    useMedia.setState({ musicName: rec?.name ?? null, musicUrl: rec ? URL.createObjectURL(rec.blob) : null })
    audio.setCustomMusic(rec?.blob ?? null)
  }
}

/** Load whatever was saved earlier (call once at startup). */
export async function loadMedia() {
  try {
    for (const kind of ['backstage', 'music'] as MediaKind[]) apply(kind, await tx<MediaRecord | undefined>('readonly', (s) => s.get(kind)))
  } catch (e) {
    console.warn('[media] IndexedDB unavailable', e)
  }
}

/** Save an upload (overwrites the previous file of that kind) and apply it immediately. */
export async function saveMedia(kind: MediaKind, file: File) {
  const rec: MediaRecord = { blob: file, name: file.name, at: Date.now() }
  await tx('readwrite', (s) => s.put(rec, kind))
  apply(kind, rec)
}

/** Remove an upload and fall back to the default. */
export async function clearMedia(kind: MediaKind) {
  await tx('readwrite', (s) => s.delete(kind))
  apply(kind, undefined)
}

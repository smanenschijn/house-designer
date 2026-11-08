import { create } from 'zustand';
import type { Item, Placement } from '../shared/recipe';
import { api, type User } from './api';
import type { WallMode } from './three/houseMesh';
import { renderParams } from './renderMode';

export type LevelView = number | 'all';

interface AppState {
  user: User | null;
  users: User[];
  items: Item[];
  placements: Placement[];
  version: number;
  loaded: boolean;
  error: string | null;

  level: LevelView;
  wallMode: WallMode;
  selectedId: string | null;
  /** id van de plaatsing die nu gesleept wordt (niet overschrijven door verversen) */
  dragging: string | null;
  panel: 'library' | 'editor' | 'account' | null;
  editingItemId: string | null;
  /** azimut van de camera in radialen (voor cutaway en kompas) */
  azimuth: number;
  rotateRequest: number;
  focusRequest: number;
  snap: boolean;
  /** iso = isometrisch (orthografisch), persp = perspectief */
  camMode: 'iso' | 'persp';
  showLabels: boolean;
  /** false = kijkmodus: meubels zijn vastgezet */
  editMode: boolean;
  online: { id: string; name: string }[];
  /** kamer om op in te zoomen bij het openen (rendermodus) */
  focusRoom: string | null;
  notice: string | null;
  /** zon: datum (YYYY-MM-DD) en tijd in minuten na middernacht (lokale tijd) */
  sun: { date: string; minutes: number };

  setUser: (u: User | null) => void;
  load: () => Promise<void>;
  poll: () => Promise<void>;
  setLevel: (l: LevelView) => void;
  setWallMode: (m: WallMode) => void;
  select: (id: string | null) => void;
  setPanel: (p: AppState['panel'], editingItemId?: string | null) => void;
  setAzimuth: (a: number) => void;
  requestRotate: (dir: 1 | -1) => void;
  requestFocus: () => void;
  setSnap: (s: boolean) => void;
  setDragging: (id: string | null) => void;
  setCamMode: (m: 'iso' | 'persp') => void;
  setShowLabels: (v: boolean) => void;
  setEditMode: (v: boolean) => void;
  setOnline: (o: { id: string; name: string }[]) => void;
  setNotice: (n: string | null) => void;
  setSun: (patch: Partial<{ date: string; minutes: number }>) => void;

  upsertItem: (it: Item) => void;
  removeItem: (id: string) => void;
  upsertPlacement: (p: Placement) => void;
  patchPlacementLocal: (id: string, patch: Partial<Placement>) => void;
  removePlacement: (id: string) => void;
  setError: (e: string | null) => void;
}

/** kleine voorkeuren per apparaat (mag ontbreken, bijv. in privévensters) */
function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`hd:${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`hd:${key}`, JSON.stringify(value));
  } catch {
    /* geen opslag beschikbaar */
  }
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  users: [],
  items: [],
  placements: [],
  version: 0,
  loaded: false,
  error: null,

  level: renderParams?.level ?? 0,
  wallMode: 'cutaway',
  selectedId: null,
  dragging: null,
  panel: null,
  editingItemId: null,
  // camera linksvoor (straat + carportzijde)
  azimuth: renderParams ? (renderParams.azimuth * Math.PI) / 180 : -Math.PI / 4,
  rotateRequest: 0,
  focusRequest: 0,
  snap: true,
  camMode: renderParams?.camera ?? 'iso',
  showLabels: renderParams ? true : readPref('showLabels', true),
  editMode: renderParams ? false : readPref('editMode', true),
  online: [],
  notice: null,
  focusRoom: renderParams?.room ?? null,
  sun: {
    date: renderParams?.date ?? new Date().toISOString().slice(0, 10),
    minutes: renderParams?.time ? Number(renderParams.time.split(':')[0]) * 60 + Number(renderParams.time.split(':')[1]) : 14 * 60,
  },

  setUser: (user) => set({ user }),
  load: async () => {
    const s = await api.state();
    set({ items: s.items, placements: s.placements, users: s.users, version: s.version, loaded: true });
  },
  poll: async () => {
    if (get().dragging) return;
    const { version } = await api.version();
    if (version !== get().version) {
      const s = await api.state();
      if (get().dragging) return;
      const sel = get().selectedId;
      set({
        items: s.items,
        placements: s.placements,
        users: s.users,
        version: s.version,
        selectedId: sel && s.placements.some((p) => p.id === sel) ? sel : null,
      });
    }
  },
  setLevel: (level) => set({ level, selectedId: null }),
  setWallMode: (wallMode) => set({ wallMode }),
  select: (selectedId) => set({ selectedId }),
  setPanel: (panel, editingItemId = null) => set({ panel, editingItemId }),
  setAzimuth: (azimuth) => set({ azimuth }),
  requestRotate: (dir) => set((s) => ({ rotateRequest: s.rotateRequest + dir })),
  requestFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
  setSnap: (snap) => set({ snap }),
  setDragging: (dragging) => set({ dragging }),
  setCamMode: (camMode) => set({ camMode }),
  setOnline: (online) => set({ online }),
  setNotice: (notice) => set({ notice }),
  setEditMode: (editMode) => {
    writePref('editMode', editMode);
    set(editMode ? { editMode } : { editMode, selectedId: null });
  },
  setShowLabels: (showLabels) => {
    writePref('showLabels', showLabels);
    set({ showLabels });
  },
  setSun: (patch) => set((s) => ({ sun: { ...s.sun, ...patch } })),

  upsertItem: (it) =>
    set((s) => ({ items: s.items.some((x) => x.id === it.id) ? s.items.map((x) => (x.id === it.id ? it : x)) : [it, ...s.items], version: s.version + 0 })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id), placements: s.placements.filter((p) => p.itemId !== id) })),
  upsertPlacement: (p) =>
    set((s) => ({ placements: s.placements.some((x) => x.id === p.id) ? s.placements.map((x) => (x.id === p.id ? p : x)) : [...s.placements, p] })),
  patchPlacementLocal: (id, patch) => set((s) => ({ placements: s.placements.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removePlacement: (id) => set((s) => ({ placements: s.placements.filter((x) => x.id !== id), selectedId: s.selectedId === id ? null : s.selectedId })),
  setError: (error) => set({ error }),
}));

/** Voer een API-actie uit; toon fout zonder de app te breken. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    useApp.getState().setError(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

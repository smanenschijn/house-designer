import { create } from 'zustand';
import type { Item, Placement } from '../shared/recipe';
import { api, type User } from './api';
import type { WallMode } from './three/houseMesh';

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
  panel: 'library' | 'editor' | null;
  editingItemId: string | null;
  /** azimut van de camera in radialen (voor cutaway en kompas) */
  azimuth: number;
  rotateRequest: number;
  focusRequest: number;
  snap: boolean;

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

  upsertItem: (it: Item) => void;
  removeItem: (id: string) => void;
  upsertPlacement: (p: Placement) => void;
  patchPlacementLocal: (id: string, patch: Partial<Placement>) => void;
  removePlacement: (id: string) => void;
  setError: (e: string | null) => void;
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  users: [],
  items: [],
  placements: [],
  version: 0,
  loaded: false,
  error: null,

  level: 0,
  wallMode: 'cutaway',
  selectedId: null,
  dragging: null,
  panel: null,
  editingItemId: null,
  // camera linksvoor (straat + carportzijde)
  azimuth: -Math.PI / 4,
  rotateRequest: 0,
  focusRequest: 0,
  snap: true,

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

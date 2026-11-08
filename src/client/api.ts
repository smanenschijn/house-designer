import type { Item, ItemInput, Placement, PlacementInput } from '../shared/recipe';

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
    } catch {
      /* geen json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface StateSnapshot {
  items: Item[];
  placements: Placement[];
  users: User[];
  version: number;
}

export const api = {
  me: () => req<User>('GET', '/api/me'),
  login: (username: string, password: string) => req<User>('POST', '/api/login', { username, password }),
  logout: () => req<void>('POST', '/api/logout'),
  state: () => req<StateSnapshot>('GET', '/api/state'),
  version: () => req<{ version: number }>('GET', '/api/version'),
  createItem: (input: ItemInput) => req<Item>('POST', '/api/items', input),
  updateItem: (id: string, input: Partial<ItemInput>) => req<Item>('PUT', `/api/items/${id}`, input),
  deleteItem: (id: string) => req<void>('DELETE', `/api/items/${id}`),
  createPlacement: (input: PlacementInput) => req<Placement>('POST', '/api/placements', input),
  updatePlacement: (id: string, input: Partial<PlacementInput>) => req<Placement>('PUT', `/api/placements/${id}`, input),
  deletePlacement: (id: string) => req<void>('DELETE', `/api/placements/${id}`),
};

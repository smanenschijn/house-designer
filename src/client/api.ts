import type { Item, ItemInput, Placement, PlacementInput } from '../shared/recipe';

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
}

export interface Account extends User {
  passkeys: PasskeyInfo[];
}

export interface UserDetail extends User {
  createdAt: string;
  passkeys: number;
}

export type LoginResult = User | { needs2fa: true; pendingToken: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

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
  login: (username: string, password: string) => req<LoginResult>('POST', '/api/auth/login', { username, password }),
  passkeyLoginOptions: () => req<{ challengeId: string; options: Json }>('POST', '/api/auth/passkey/login/options'),
  passkeyLoginVerify: (challengeId: string, response: unknown, pendingToken?: string) =>
    req<User>('POST', '/api/auth/passkey/login/verify', { challengeId, response, pendingToken }),
  logout: () => req<void>('POST', '/api/auth/logout'),

  account: () => req<Account>('GET', '/api/account'),
  updateAccount: (displayName: string) => req<User>('PUT', '/api/account', { displayName }),
  changePassword: (current: string, next: string) => req<void>('POST', '/api/account/password', { current, next }),
  passkeyRegisterOptions: () => req<{ challengeId: string; options: Json }>('POST', '/api/account/passkeys/options'),
  passkeyRegisterVerify: (challengeId: string, response: unknown, name: string) =>
    req<{ passkeys: PasskeyInfo[] }>('POST', '/api/account/passkeys/verify', { challengeId, response, name }),
  deletePasskey: (id: string) => req<void>('DELETE', `/api/account/passkeys/${encodeURIComponent(id)}`),

  users: () => req<UserDetail[]>('GET', '/api/users'),
  createUser: (input: { username: string; displayName: string; password: string }) => req<User>('POST', '/api/users', input),
  updateUser: (id: string, input: { displayName?: string; password?: string }) => req<User>('PUT', `/api/users/${id}`, input),
  deleteUser: (id: string) => req<void>('DELETE', `/api/users/${id}`),
  state: () => req<StateSnapshot>('GET', '/api/state'),
  version: () => req<{ version: number }>('GET', '/api/version'),
  createItem: (input: ItemInput) => req<Item>('POST', '/api/items', input),
  updateItem: (id: string, input: Partial<ItemInput>) => req<Item>('PUT', `/api/items/${id}`, input),
  deleteItem: (id: string) => req<void>('DELETE', `/api/items/${id}`),
  createPlacement: (input: PlacementInput) => req<Placement>('POST', '/api/placements', input),
  updatePlacement: (id: string, input: Partial<PlacementInput>) => req<Placement>('PUT', `/api/placements/${id}`, input),
  deletePlacement: (id: string) => req<void>('DELETE', `/api/placements/${id}`),
};

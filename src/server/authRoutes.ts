import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  AuthError,
  Ephemeral,
  MIN_PASSWORD,
  createSession,
  createUser,
  deletePasskey,
  deleteSession,
  deleteUser,
  deleteUserSessions,
  findUser,
  getPasskey,
  getUser,
  insertPasskey,
  listPasskeys,
  listUsersDetailed,
  passkeyRows,
  sessionUser,
  touchPasskey,
  toPublic,
  updateUser,
  verifyPassword,
  type PublicUser,
} from './auth';

import { origin, rpID, secure } from './config';

export const COOKIE = 'hd_session';


export type AuthEnv = { Variables: { user: PublicUser } };

const challenges = new Ephemeral<string>(5 * 60_000);
/** wachtwoord klopte, maar er is een passkey nodig als tweede factor */
const pending2fa = new Ephemeral<string>(5 * 60_000);

const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  dec: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
};

// ---------- inlogpogingen beperken (per IP, oplopende wachttijd) ----------
const failures = new Map<string, { n: number; until: number }>();
const ipOf = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
function checkThrottle(c: Context) {
  const f = failures.get(ipOf(c));
  if (f && f.until > Date.now()) {
    const min = Math.ceil((f.until - Date.now()) / 60_000);
    throw new AuthError(429, `Te veel mislukte pogingen. Probeer het over ${min} minuut${min > 1 ? 'en' : ''} opnieuw.`);
  }
}
function registerFailure(c: Context) {
  const ip = ipOf(c);
  const f = failures.get(ip) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + Math.min(60, 2 ** (f.n - 5)) * 60_000;
  failures.set(ip, f);
}

function startSession(c: Context, userId: string) {
  failures.delete(ipOf(c));
  const token = createSession(userId);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', maxAge: 60 * 86400 });
  return c.json(toPublic(getUser(userId)!));
}

// ================= /api/auth (zonder login) =================
export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  checkThrottle(c);
  const body = await c.req.json().catch(() => ({}));
  const u = typeof body.username === 'string' ? findUser(body.username) : undefined;
  if (!u || typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) {
    registerFailure(c);
    throw new AuthError(401, 'Onbekende gebruiker of verkeerd wachtwoord.');
  }
  // heeft deze gebruiker een passkey, dan telt die als tweede factor
  if (passkeyRows(u.id).length > 0) return c.json({ needs2fa: true, pendingToken: pending2fa.put(u.id) });
  return startSession(c, u.id);
});

authRoutes.post('/passkey/login/options', async (c) => {
  checkThrottle(c);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  return c.json({ challengeId: challenges.put(options.challenge), options });
});

authRoutes.post('/passkey/login/verify', async (c) => {
  checkThrottle(c);
  const body = await c.req.json().catch(() => ({}));
  const expectedChallenge = challenges.take(body.challengeId);
  if (!expectedChallenge) throw new AuthError(400, 'Verlopen poging, probeer het opnieuw.');
  const pk = getPasskey(String(body.response?.id ?? ''));
  if (!pk) {
    registerFailure(c);
    throw new AuthError(401, 'Deze passkey is niet bekend. Log in met je wachtwoord en voeg hem opnieuw toe.');
  }
  if (body.pendingToken !== undefined) {
    const pendingUser = pending2fa.take(body.pendingToken);
    if (!pendingUser || pendingUser !== pk.user_id) {
      registerFailure(c);
      throw new AuthError(401, 'Deze passkey hoort niet bij dit account.');
    }
  }
  const result = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: pk.id,
      publicKey: b64u.dec(pk.public_key),
      counter: pk.counter,
      transports: pk.transports ? (JSON.parse(pk.transports) as AuthenticatorTransport[]) : undefined,
    },
  }).catch(() => null);
  if (!result?.verified) {
    registerFailure(c);
    throw new AuthError(401, 'Passkey kon niet worden gecontroleerd.');
  }
  touchPasskey(pk.id, result.authenticationInfo.newCounter);
  return startSession(c, pk.user_id);
});

authRoutes.post('/logout', (c) => {
  const token = getCookie(c, COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.body(null, 204);
});

// ================= middleware =================
export async function requireUser(c: Context<AuthEnv>, next: () => Promise<void>) {
  const user = sessionUser(getCookie(c, COOKIE));
  if (!user) return c.json({ error: 'Niet ingelogd' }, 401);
  c.set('user', user);
  await next();
}

// ================= /api/account (eigen account) =================
export const accountRoutes = new Hono<AuthEnv>();

accountRoutes.get('/', (c) => {
  const u = c.get('user');
  return c.json({ ...u, passkeys: listPasskeys(u.id) });
});

accountRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(updateUser(c.get('user').id, { displayName: typeof body.displayName === 'string' ? body.displayName : undefined }));
});

accountRoutes.post('/password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const u = getUser(c.get('user').id)!;
  if (typeof body.current !== 'string' || !verifyPassword(body.current, u.password_hash)) throw new AuthError(400, 'Huidig wachtwoord klopt niet.');
  if (typeof body.next !== 'string' || body.next.length < MIN_PASSWORD) throw new AuthError(400, `Nieuw wachtwoord moet minstens ${MIN_PASSWORD} tekens zijn.`);
  updateUser(u.id, { password: body.next });
  deleteUserSessions(u.id, getCookie(c, COOKIE));
  return c.body(null, 204);
});

accountRoutes.post('/passkeys/options', async (c) => {
  const u = getUser(c.get('user').id)!;
  const existing = passkeyRows(u.id);
  const options = await generateRegistrationOptions({
    rpName: 'Waalstraat 16',
    rpID,
    userName: u.username,
    userDisplayName: u.display_name,
    userID: b64u.dec(u.webauthn_user_id),
    attestationType: 'none',
    excludeCredentials: existing.map((k) => ({
      id: k.id,
      transports: k.transports ? (JSON.parse(k.transports) as AuthenticatorTransport[]) : undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  return c.json({ challengeId: challenges.put(options.challenge), options });
});

accountRoutes.post('/passkeys/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const expectedChallenge = challenges.take(body.challengeId);
  if (!expectedChallenge) throw new AuthError(400, 'Verlopen poging, probeer het opnieuw.');
  const result = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch((e: Error) => {
    throw new AuthError(400, `Passkey niet geaccepteerd: ${e.message}`);
  });
  if (!result.verified || !result.registrationInfo) throw new AuthError(400, 'Passkey niet geaccepteerd.');
  const { credential } = result.registrationInfo;
  insertPasskey({
    id: credential.id,
    userId: c.get('user').id,
    publicKey: b64u.enc(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Passkey',
  });
  return c.json({ passkeys: listPasskeys(c.get('user').id) });
});

accountRoutes.delete('/passkeys/:id', (c) => {
  const ok = deletePasskey(c.get('user').id, decodeURIComponent(c.req.param('id')));
  return ok ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404);
});

// ================= /api/users (gebruikersbeheer, voor iedereen die is ingelogd) =================
export const userRoutes = new Hono<AuthEnv>();

userRoutes.get('/', (c) => c.json(listUsersDetailed()));

userRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const u = createUser({
    username: String(body.username ?? ''),
    displayName: String(body.displayName ?? ''),
    password: String(body.password ?? ''),
  });
  return c.json(u, 201);
});

userRoutes.put('/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param('id');
  const password = typeof body.password === 'string' && body.password ? body.password : undefined;
  const u = updateUser(id, { displayName: typeof body.displayName === 'string' ? body.displayName : undefined, password });
  // wachtwoord gereset door iemand anders: die gebruiker moet opnieuw inloggen
  if (password && id !== c.get('user').id) deleteUserSessions(id);
  return c.json(u);
});

userRoutes.delete('/:id', (c) => {
  deleteUser(c.req.param('id'), c.get('user').id);
  return c.body(null, 204);
});

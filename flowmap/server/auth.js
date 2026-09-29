// Login without third-party services: scrypt password hashes + HMAC-signed session tokens.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_DAYS = 30;

export function loadSecret(dir) {
  if (process.env.FLOWMAP_SECRET && process.env.FLOWMAP_SECRET.length >= 16) return process.env.FLOWMAP_SECRET;
  if (!dir) throw new Error('Set FLOWMAP_SECRET (16+ random characters) in the environment');
  const file = path.join(dir, 'secret.key');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('base64url');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const [v, saltB, hashB] = String(stored).split('$');
  if (v !== 's1' || !saltB || !hashB) return false;
  const expected = Buffer.from(hashB, 'base64url');
  const actual = crypto.scryptSync(password, Buffer.from(saltB, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signToken(secret, userId) {
  const body = b64({ uid: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400 });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isInteger(p.uid) || p.exp < Date.now() / 1000) return null;
    return p.uid;
  } catch {
    return null;
  }
}

// Secrets a user stores with us (their AI key) are encrypted with a key derived from the server secret.
const encKey = (secret) => crypto.createHash('sha256').update(`flowmap-secrets:${secret}`).digest();
export function encryptJson(secret, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `g1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function decryptJson(secret, s) {
  const [v, iv, tag, data] = String(s || '').split('.');
  if (v !== 'g1') return {};
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'));
  } catch {
    return {};
  }
}

// Keys for AI agents: shown once, stored only as a hash.
export const AGENT_PREFIX = 'fm_';
export const newAgentKey = () => AGENT_PREFIX + crypto.randomBytes(24).toString('base64url');
export const hashAgentKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// Tiny in-memory throttle for login / register attempts.
export function makeLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return arr.length <= max;
  };
}

// Le registre en ligne des fermes (Supabase) : inscription obligatoire (nom de ferme unique et code
// secret), sauvegarde de la partie, classements, visites. Tout passe par des fonctions SQL
// (supabase/schema.sql) : la table n'est jamais lisible directement, et le code secret n'est jamais
// renvoyé. Une fois inscrit, on peut jouer sans réseau : la ferme repartira en ligne au retour.
import { serialize } from '../save/save';
import { farmLevel } from '../sim/economy';
import { currentDay } from '../sim/core';
import { isLayer, productivity } from '../sim/hens';
import type { GameState } from '../sim/types';

// La clé « publishable » est faite pour être publique : la sécurité est dans la base.
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://itujphqtbhvqbifaqyct.supabase.co';
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? 'sb_publishable_ZDgr2zjrs3itQEO6IeoB4A_BCEU0AxQ';

export const NAME_RE = /^[A-Za-zÀ-ÿ0-9 _'’.-]{3,24}$/;
export const SECRET_MIN = 4;

const ID_KEY = 'cocotte.online';

export interface Identity {
  name: string;
  secret: string;
}

export interface BoardRow {
  name: string;
  level: number;
  xp: number;
  hens: number;
  laying_rate: number;
  wellbeing: number;
  game_day: number;
  updated_at: string;
}

export type BoardSort = 'level' | 'laying' | 'wellbeing';

/** Erreur réseau ou de la base (le jeu continue sans). */
export class OnlineError extends Error {}

async function rpc<T>(fn: string, body: Record<string, unknown>, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* texte brut */
      }
      throw new OnlineError(msg);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (e) {
    if (e instanceof OnlineError) throw e;
    throw new OnlineError('network');
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------- Identité ----
export function identity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Identity>;
    return typeof o.name === 'string' && typeof o.secret === 'string' ? { name: o.name, secret: o.secret } : null;
  } catch {
    return null;
  }
}
export function setIdentity(id: Identity) {
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(id));
  } catch {
    /* stockage indisponible */
  }
}
export function clearIdentity() {
  try {
    localStorage.removeItem(ID_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Laquelle des deux sauvegardes reprendre ? Celle en ligne si elle est franchement plus récente
 * (on a joué sur un autre appareil depuis) ; sinon celle de ce navigateur, toujours la plus à jour.
 */
export const onlineIsNewer = (onlineSavedAt: number, localSavedAt: number) => onlineSavedAt > localSavedAt + 5000;

// ------------------------------------------------------------- Registre ----
export const farmAvailable = (name: string) => rpc<boolean>('farm_available', { p_name: name });

/** Réserve le nom avec son code secret : 'ok', 'taken' (déjà pris) ou 'invalid'. */
export const claimFarm = (name: string, secret: string) => rpc<'ok' | 'taken' | 'invalid'>('claim_farm', { p_name: name, p_secret: secret });

/** Retrouve sa ferme (sauvegarde) avec le nom et le code ; erreur 'unknown' ou 'denied'. */
export const restoreFarm = (name: string, secret: string, timeoutMs?: number) => rpc<string | null>('restore_farm', { p_name: name, p_secret: secret }, timeoutMs);

export const loadBoard = (sort: BoardSort, limit = 50) => rpc<BoardRow[]>('get_board', { p_sort: sort, p_limit: limit });

export async function fetchFarm(name: string) {
  const rows = await rpc<Array<{ name: string; level: number; hens: number; save: string }>>('get_farm_save', { p_name: name });
  return rows[0] ?? null;
}

// -------------------------------------------------------------- Coucou ----
export type GreetResult = 'ok' | 'wait' | 'denied' | 'unknown' | 'self';

/** Passe le coucou à une ferme, au nom de la nôtre. */
export function sendGreeting(to: string): Promise<GreetResult> {
  const id = identity();
  if (!id) return Promise.resolve('denied');
  return rpc<GreetResult>('send_greeting', { p_from: id.name, p_secret: id.secret, p_to: to });
}

export interface Greeting {
  from_name: string;
  sent_at: string;
}

/** Les coucous reçus depuis la dernière fois (ils sont marqués comme vus). */
export function readGreetings(): Promise<Greeting[]> {
  const id = identity();
  if (!id) return Promise.resolve([]);
  return rpc<Greeting[]>('read_greetings', { p_name: id.name, p_secret: id.secret }, 8000);
}

// ------------------------------------------------------------- Envoi ----
/** Chiffres du classement : niveau, volailles, taux de ponte moyen (0 à 1) et bien-être moyen. */
export function farmStats(s: GameState) {
  const layers = s.hens.filter(isLayer);
  const laying = layers.length ? layers.reduce((a, h) => a + productivity(h), 0) / layers.length : 0;
  const wellbeing = s.hens.length ? s.hens.reduce((a, h) => a + h.wellbeing, 0) / s.hens.length : 0;
  return { level: farmLevel(s), xp: Math.round(s.xp), hens: s.hens.length, laying: Math.round(laying * 1000) / 1000, wellbeing: Math.round(wellbeing * 10) / 10 };
}

let lastPush = 0;
let lastOk = 0;
let pushing = false;
let retry = 0;
let latest: GameState | null = null;
/** Instant de la dernière sauvegarde en ligne réussie (0 : pas encore dans cette session). */
export const lastPushOk = () => lastOk;
/** Envoyé au plus toutes les 90 s ; une sauvegarde énorme (> 5,5 Mo) n'est pas envoyée. */
const PUSH_EVERY_MS = 90_000;
const MAX_SAVE_CHARS = 5_500_000;

/** Envoie l'état de la ferme au registre (sans bloquer le jeu, erreurs ignorées). */
export async function pushFarm(s: GameState, force = false): Promise<'ok' | 'denied' | 'skipped' | 'error'> {
  const id = identity();
  latest = s;
  if (!id || pushing) return 'skipped';
  const now = Date.now();
  if (!force && now - lastPush < PUSH_EVERY_MS) return 'skipped';
  const save = serialize(s);
  if (save.length > MAX_SAVE_CHARS) return 'skipped';
  const st = farmStats(s);
  pushing = true;
  lastPush = now;
  try {
    const r = await rpc<string>(
      'push_farm',
      { p_name: id.name, p_secret: id.secret, p_level: st.level, p_xp: st.xp, p_hens: st.hens, p_laying: st.laying, p_wellbeing: st.wellbeing, p_money: Math.round(s.money), p_day: currentDay(s), p_save: save },
      30000,
    );
    // trop tôt après le dernier envoi (ou la création du nom) : on réessaie une fois, un peu plus tard
    if (r === 'wait' && !retry) {
      retry = setTimeout(() => {
        retry = 0;
        if (latest) void pushFarm(latest, true);
      }, 21_000) as unknown as number;
    }
    if (r === 'ok') lastOk = Date.now();
    return r === 'ok' ? 'ok' : r === 'denied' ? 'denied' : 'skipped';
  } catch {
    lastPush = 0;
    return 'error';
  } finally {
    pushing = false;
  }
}

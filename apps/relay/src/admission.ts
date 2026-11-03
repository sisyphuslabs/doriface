/** Client admission rules (contract v1.2 C1), kept free of Workers APIs so they are testable on their own. */

export const MAX_ACTIVE_SESSIONS = 32;
export const MAX_PENDING_SESSIONS = 8;

export interface Admittee {
  readonly ip: string;
  readonly openedAt: number;
}

/**
 * The pending session to evict when the pending cap is full: the oldest one from the source that holds the most
 * pending sessions. A flooding source therefore loses its own sessions first; another source displaces it only while
 * the flooder still holds more pending sessions than anyone else.
 */
export function evictionVictim<T>(pending: readonly T[], admittee: (session: T) => Admittee): T | undefined {
  const perIp = new Map<string, T[]>();
  for (const session of pending) {
    const { ip } = admittee(session);
    perIp.set(ip, [...(perIp.get(ip) ?? []), session]);
  }
  let victims: readonly T[] = [];
  for (const sessions of perIp.values()) if (sessions.length > victims.length) victims = sessions;
  return victims.reduce<T | undefined>(
    (oldest, session) =>
      oldest === undefined || admittee(session).openedAt < admittee(oldest).openedAt ? session : oldest,
    undefined,
  );
}

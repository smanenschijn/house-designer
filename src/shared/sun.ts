/**
 * Zonnestand (NOAA-benadering, nauwkeurig tot ~0,5°).
 * Standaardlocatie: Waalstraat 16, Nijverdal.
 */
export const NIJVERDAL = { lat: 52.362, lon: 6.468 };

const RAD = Math.PI / 180;

export interface SunPosition {
  /** hoogte boven de horizon in graden */
  elevation: number;
  /** azimut in graden vanaf het noorden, met de klok mee (90 = oost) */
  azimuth: number;
}

export function sunPosition(date: Date, lat = NIJVERDAL.lat, lon = NIJVERDAL.lon): SunPosition {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 864e5) + 1;
  const hourUtc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourUtc - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hourUtc * 60 + eqtime + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
  return { elevation: 90 - zen / RAD, azimuth: ((az % 360) + 360) % 360 };
}

/**
 * Richting naar de zon in huiscoördinaten [x, y, z] (genormaliseerd).
 * north/east zijn eenheidsvectoren in het plan ([x, z]).
 */
export function sunDirection(p: SunPosition, north: [number, number]): [number, number, number] {
  // oost = noord 90° met de klok mee gedraaid (van bovenaf gezien met z naar 'beneden')
  const east: [number, number] = [-north[1], north[0]];
  const a = p.azimuth * RAD;
  const e = p.elevation * RAD;
  const hx = north[0] * Math.cos(a) + east[0] * Math.sin(a);
  const hz = north[1] * Math.cos(a) + east[1] * Math.sin(a);
  return [hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)];
}

export function compassName(azimuth: number): string {
  const names = ['noord', 'noordoost', 'oost', 'zuidoost', 'zuid', 'zuidwest', 'west', 'noordwest'];
  return names[Math.round(azimuth / 45) % 8];
}

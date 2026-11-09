/** Parameters als de app geopend wordt door de server om een afbeelding te maken (?render=…). */
export interface RenderParams {
  /** voorvertoning van één meubel */
  item?: string;
  elevation?: number;
  level: number;
  room?: string;
  camera: 'iso' | 'persp';
  azimuth: number;
  time?: string;
  date?: string;
}

export const renderParams: RenderParams | null = (() => {
  try {
    const p = new URLSearchParams(location.search).get('render');
    return p ? (JSON.parse(p) as RenderParams) : null;
  } catch {
    return null;
  }
})();

/** OAuth-autorisatie die wacht op toestemming (?oauth=…) */
export const oauthQuery: string | null = (() => {
  try {
    return new URLSearchParams(location.search).get('oauth');
  } catch {
    return null;
  }
})();

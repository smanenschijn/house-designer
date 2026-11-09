/**
 * Meekijkmodus: /kijk/<token> opent het huis alleen-lezen, zonder account.
 */
const m = typeof location !== 'undefined' ? /^\/kijk\/([A-Za-z0-9_-]{20,100})\/?$/.exec(location.pathname) : null;
export const viewToken: string | null = m ? m[1] : null;

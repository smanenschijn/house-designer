/** Publieke URL van de site; bepaalt passkey-domein, OAuth-issuer en MCP-resource. */
export const publicUrl = new URL(process.env.PUBLIC_URL ?? 'http://localhost:5173');
export const origin = publicUrl.origin;
export const rpID = publicUrl.hostname;
export const secure = publicUrl.protocol === 'https:';
export const mcpResource = `${origin}/mcp`;

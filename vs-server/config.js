// vs-server/config.js
// Environment defaults shared by the Node and Bun adapters.

export const PORT = parseInt(process.env.PORT || '3001', 10);
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sev7en-admin';

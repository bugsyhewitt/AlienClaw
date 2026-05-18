// Hostinger entry point — loads the TypeScript API via tsx at runtime.
// Hostinger runs: node server.js
// tsx/cjs registers the TypeScript loader, then we require the real entry.
require('tsx/cjs');
require('./src/alienclaw/api/main.ts');

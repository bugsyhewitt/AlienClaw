// Hostinger entry point — pre-compiled bundle, no tsx needed at runtime.
// LiteSpeed loads this via require(), so no top-level await allowed.
process.env.ALIENCLAW_DB_URL = process.env.ALIENCLAW_DB_URL?.replace('@localhost/', '@127.0.0.1/');
import('./dist/main.js').catch(err => { process.stderr.write(String(err) + '\n'); process.exit(1); });

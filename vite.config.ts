import { defineConfig, type Plugin } from 'vite';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TUNING_FILE = fileURLToPath(new URL('./src/ragdoll/tuning.json', import.meta.url));
/** Paths look like MUSCLES.shoulder.frequency or GAIT.armSwing. */
const PATH = /^[A-Z_]+(\.[A-Za-z]+){1,2}$/;

/**
 * Dev-server only: lets the sandbox's tuning panel save its settings into
 * src/ragdoll/tuning.json ("Save to project"). Not part of the built game.
 */
function ragdollTuningSave(): Plugin {
  return {
    name: 'ragdoll-tuning-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ragdoll/tuning', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; if (body.length > 100_000) req.destroy(); });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body) as unknown;
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('expected an object');
            // Keep only well-formed number entries, sorted so the file diffs cleanly.
            const clean: Record<string, number> = {};
            for (const key of Object.keys(data).sort()) {
              const v = (data as Record<string, unknown>)[key];
              if (PATH.test(key) && typeof v === 'number' && Number.isFinite(v)) clean[key] = v;
            }
            // Write to a temp file then rename, so a half-written file is never read.
            const tmp = `${TUNING_FILE}.tmp`;
            await fs.writeFile(tmp, `${JSON.stringify(clean, null, 2)}\n`);
            await fs.rename(tmp, TUNING_FILE);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, saved: Object.keys(clean).length }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

const CHARACTERS_FILE = fileURLToPath(new URL('./characters.json', import.meta.url));

/**
 * Dev-server only: the sandbox's character library (named recipes) lives in
 * characters.json at the project root. GET reads it, POST replaces it. It's fetched at
 * runtime rather than imported, so saving a character doesn't reload the page.
 */
function characterLibrary(): Plugin {
  return {
    name: 'ragdoll-character-library',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ragdoll/characters', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          try { res.end(await fs.readFile(CHARACTERS_FILE, 'utf8')); } catch { res.end('{"characters":[]}'); }
          return;
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; if (body.length > 500_000) req.destroy(); });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body) as { default?: unknown; characters?: unknown };
            if (!Array.isArray(data.characters) || data.characters.length > 500) throw new Error('expected { characters: [...] }');
            // Only recipe-shaped objects; the page validates the details when it loads them.
            const characters = data.characters.filter((c) => c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string');
            const out = { default: typeof data.default === 'string' ? data.default : undefined, characters };
            const tmp = `${CHARACTERS_FILE}.tmp`;
            await fs.writeFile(tmp, `${JSON.stringify(out, null, 2)}\n`);
            await fs.rename(tmp, CHARACTERS_FILE);
            res.end(JSON.stringify({ ok: true, saved: characters.length }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

/**
 * Build only: ships characters.json next to the page, so a static copy of the sandbox
 * (GitHub Pages) can still load the character library, read-only.
 */
function bundleCharacters(): Plugin {
  return {
    name: 'ragdoll-bundle-characters',
    apply: 'build',
    async generateBundle() {
      try {
        this.emitFile({ type: 'asset', fileName: 'characters.json', source: await fs.readFile(CHARACTERS_FILE, 'utf8') });
      } catch { /* no library yet: the page starts with the default look */ }
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the built page works from any folder (e.g. GitHub Pages' /repo-name/).
  base: './',
  plugins: [ragdollTuningSave(), characterLibrary(), bundleCharacters()],
  // The character library is data the page reads and writes, not source: don't reload on it.
  server: { watch: { ignored: ['**/characters.json', '**/characters.json.tmp'] } },
});

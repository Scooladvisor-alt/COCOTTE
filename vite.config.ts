import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Le jeu garde un état vivant (boucle, scène 3D, simulation) : un remplacement à chaud
 * partiel des modules pourrait dupliquer la scène ou les étiquettes. En développement, toute
 * modification recharge donc proprement la page (la partie est sauvegardée à la fermeture).
 */
function fullReload(): Plugin {
  return {
    name: 'cocotte-full-reload',
    apply: 'serve',
    handleHotUpdate({ server }) {
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * Application installable (PWA) : à chaque construction, écrit sw.js avec la liste exacte des fichiers
 * de cette version et une empreinte de leur contenu. Une nouvelle version déployée a donc toujours un
 * sw.js différent : le téléphone la détecte, la met en cache, puis efface l'ancienne.
 */
function serviceWorker(): Plugin {
  return {
    name: 'cocotte-service-worker',
    apply: 'build',
    // après la génération de index.html
    enforce: 'post',
    generateBundle(_options, bundle) {
      // (les polices .woff ne servent qu'aux navigateurs trop anciens pour un service worker : inutile de les garder)
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !f.endsWith('.woff'))
        .sort();
      if (!files.includes('index.html')) throw new Error('sw.js : index.html absent de la construction');
      const pub = readdirSync('public').filter((f) => !f.startsWith('.')).sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const out = bundle[f];
        hash.update(f).update(out.type === 'chunk' ? out.code : out.source);
      }
      for (const f of pub) hash.update(f).update(readFileSync(`public/${f}`));
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync('pwa/service-worker.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify([...files, ...pub]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [preact({ prefreshEnabled: false }), fullReload(), serviceWorker()],
  base: './',
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 900,
    // three.js à part : il ne change pas d'une version du jeu à l'autre et reste dans le cache du navigateur
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);

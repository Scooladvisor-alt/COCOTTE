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

export default defineConfig({
  plugins: [preact({ prefreshEnabled: false }), fullReload()],
  base: './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);

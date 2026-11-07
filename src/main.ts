// Point d'entrée : tout petit, pour que l'écran de chargement d'index.html s'affiche d'abord.
// Le jeu (three.js, modèles, simulation) arrive ensuite, sans bloquer cet affichage.
// (setTimeout et non requestAnimationFrame : celui-ci ne se déclenche pas dans un onglet caché)
setTimeout(() => {
  void import('./boot');
}, 0);

// Application installable : le service worker garde le jeu en cache pour qu'il s'ouvre vite et sans
// connexion. Seulement en production (en développement, il servirait d'anciens fichiers). On l'installe
// une fois le jeu lancé, pour ne pas lui disputer le réseau au premier chargement.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          // à chaque retour dans l'application, on regarde si une nouvelle version a été déployée
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
          });
        })
        .catch(() => undefined);
    }, 4000);
  });
}

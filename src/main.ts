// Point d'entrée : tout petit, pour que l'écran de chargement d'index.html s'affiche d'abord.
// Le jeu (three.js, modèles, simulation) arrive ensuite, sans bloquer cet affichage.
// (setTimeout et non requestAnimationFrame : celui-ci ne se déclenche pas dans un onglet caché)
setTimeout(() => {
  void import('./boot');
}, 0);

// Publicités récompensées (Google AdSense, « Ad Placement API » pour les jeux H5) : le joueur
// choisit de regarder une publicité, et reçoit sa récompense seulement s'il l'a vue jusqu'au bout.
// Le script n'est chargé qu'une fois, au démarrage ; en développement, Google sert des publicités
// de test. Bloqué (bloqueur de publicités, pas de réseau), le bouton prévient simplement le joueur.

const CLIENT = 'ca-pub-7899071085197143';

interface PlacementInfo {
  breakStatus: string;
}
interface AdBreakOptions {
  type: 'reward';
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  beforeReward?: (showAdFn: () => void) => void;
  adDismissed?: () => void;
  adViewed?: () => void;
  adBreakDone?: (info: PlacementInfo) => void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (o: AdBreakOptions) => void;
    adConfig?: (o: object) => void;
  }
}

let loaded = false;

/**
 * Le script AdSense est écrit en dur dans index.html (le robot de Google doit le trouver dans la
 * page pour valider le site). Ici, seulement un filet de sécurité s'il manquait.
 */
export function loadAds() {
  if (loaded || typeof document === 'undefined') return;
  loaded = true;
  window.adsbygoogle = window.adsbygoogle || [];
  if (!window.adBreak) {
    const push = (o: object) => window.adsbygoogle!.push(o);
    window.adBreak = push as Window['adBreak'];
    window.adConfig = push;
  }
  if (document.querySelector('script[src*="adsbygoogle.js"]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  s.crossOrigin = 'anonymous';
  s.setAttribute('data-ad-frequency-hint', '30s');
  if (import.meta.env.DEV) s.setAttribute('data-adbreak-test', 'on');
  document.head.appendChild(s);
}

export type AdOutcome = 'viewed' | 'dismissed' | 'unavailable';

/**
 * Montre une publicité récompensée. `pause`/`resume` encadrent la publicité (jeu et son coupés),
 * `onReward` n'est appelé que si elle a été regardée jusqu'au bout.
 */
export function showRewardedAd(h: { pause: () => void; resume: () => void; onReward: () => void; onDone: (o: AdOutcome) => void }) {
  loadAds();
  let shown = false;
  let rewarded = false;
  let finished = false;
  const finish = (o: AdOutcome) => {
    if (finished) return;
    finished = true;
    h.onDone(o);
  };
  try {
    window.adBreak?.({
      type: 'reward',
      name: 'boutique-1000',
      beforeAd: () => {
        shown = true;
        h.pause();
      },
      afterAd: () => h.resume(),
      beforeReward: (showAdFn) => showAdFn(),
      adDismissed: () => finish('dismissed'),
      adViewed: () => {
        rewarded = true;
        h.onReward();
      },
      adBreakDone: (info) => {
        if (shown) h.resume();
        finish(rewarded ? 'viewed' : info.breakStatus === 'dismissed' ? 'dismissed' : 'unavailable');
      },
    });
  } catch {
    finish('unavailable');
  }
  // rien ne vient (script bloqué, pas de publicité à servir) : on n'attend pas indéfiniment
  window.setTimeout(() => {
    if (!shown) finish('unavailable');
  }, 6000);
}

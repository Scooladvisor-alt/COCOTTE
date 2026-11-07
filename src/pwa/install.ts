// Installer Cocotte sur l'écran d'accueil, depuis un bouton de la page d'accueil.
// - Android, Chrome, Edge : le navigateur propose l'installation (beforeinstallprompt), on la déclenche d'un clic.
// - iPhone, iPad : Safari ne permet pas d'installer depuis la page ; on montre les deux gestes à faire.
// Ce module est chargé dès le début (main.ts) : le navigateur peut proposer l'installation très tôt.

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

/** Le jeu tourne-t-il déjà comme une application installée ? */
export const isInstalled = () =>
  installed ||
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

/** iPhone ou iPad (y compris l'iPad qui se présente comme un Mac). */
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Ce que le bouton peut faire ici : lancer l'installation, montrer les gestes sur iPhone, ou rien. */
export function installMode(): 'prompt' | 'ios' | null {
  if (isInstalled()) return null;
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return null;
}

export async function promptInstall() {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  notify();
  return outcome === 'accepted';
}

export function onInstallChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Le blason de la ferme : chaque joueur choisit le sien à la création (et peut en changer dans les
// Réglages). Une icône du jeu, dans le même trait que le reste de l'interface, sur ses couleurs.
import { Icon } from './common';

export interface Crest {
  id: string;
  name: string;
  icon: string;
  /** Dégradé du fond et couleur de l'icône. */
  from: string;
  to: string;
  fg: string;
}

export const CRESTS: Crest[] = [
  { id: 'poule', name: 'La Poule', icon: 'hen', from: '#fff3d6', to: '#ffe0a3', fg: '#a2651c' },
  { id: 'grange', name: 'La Grange', icon: 'home', from: '#e2574c', to: '#b8372e', fg: '#fff6ee' },
  { id: 'ble', name: 'Le Blé', icon: 'wheat', from: '#f8e08e', to: '#e7b84a', fg: '#7a5410' },
  { id: 'oeuf', name: 'L’Œuf', icon: 'egg', from: '#eef4ff', to: '#cfdcf5', fg: '#3a5a92' },
  { id: 'pousse', name: 'La Pousse', icon: 'sprout', from: '#dff3d2', to: '#a9d98c', fg: '#2f6a2a' },
  { id: 'soleil', name: 'Le Soleil', icon: 'sun', from: '#ffd27a', to: '#ff9f43', fg: '#7a3a00' },
  { id: 'lune', name: 'La Lune', icon: 'moon', from: '#3c4a7a', to: '#232c4f', fg: '#f3e9c9' },
  { id: 'etoile', name: 'L’Étoile', icon: 'star', from: '#e9dcff', to: '#bfa6f2', fg: '#4f2f8f' },
  { id: 'coeur', name: 'Le Cœur', icon: 'heart', from: '#ffe1ea', to: '#f7a8bf', fg: '#a3264d' },
  { id: 'panier', name: 'Le Panier', icon: 'basket', from: '#f1dcc0', to: '#d4a874', fg: '#5b3a17' },
  { id: 'source', name: 'La Source', icon: 'drop', from: '#d9f1ff', to: '#8fd0f2', fg: '#13557a' },
  { id: 'trophee', name: 'Le Trophée', icon: 'trophy', from: '#2f3a33', to: '#1c2420', fg: '#e8c25a' },
];

export const crestOf = (id?: string) => CRESTS.find((c) => c.id === id) ?? CRESTS[0];

/** Le blason (taille au choix). */
export function FarmLogo({ id, size = 38 }: { id?: string; size?: number }) {
  const c = crestOf(id);
  return (
    <div class="logo" style={{ width: `${size}px`, height: `${size}px`, background: `linear-gradient(145deg, ${c.from}, ${c.to})`, color: c.fg }} title={c.name}>
      <Icon name={c.icon} size={Math.round(size * 0.53)} />
    </div>
  );
}

/** La grille de choix des blasons. */
export function CrestPicker({ value, onPick }: { value?: string; onPick: (id: string) => void }) {
  const cur = crestOf(value).id;
  return (
    <div class="crest-pick" role="radiogroup" aria-label="Blason de la ferme">
      {CRESTS.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={c.id === cur} class={c.id === cur ? 'on' : ''} title={c.name} onClick={() => onPick(c.id)}>
          <FarmLogo id={c.id} size={40} />
        </button>
      ))}
    </div>
  );
}

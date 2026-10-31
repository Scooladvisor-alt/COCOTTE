import type { WorkerRole } from '../sim/types';

export interface RoleDef {
  role: WorkerRole;
  title: string;
  icon: string;
  description: string;
  boosts: string[];
  /** Salaire journalier (centimes). */
  wage: number;
  reqLevel: number;
  /** Nombre maximum de salariés de ce métier selon le niveau de ferme. */
  max: (level: number) => number;
  /** Couleurs de la tenue. */
  outfit: { shirt: number; pants: number; hat: number | null; apron?: number };
}

export const ROLES: Record<WorkerRole, RoleDef> = {
  farmhand: {
    role: 'farmhand',
    title: 'Commis de ferme',
    icon: '🧑‍🌾',
    description: 'Fait tourner la ferme au quotidien.',
    boosts: ['Eau et grain toujours remplis', 'Nettoie les poulaillers', 'Ferme les trappes le soir', 'Ramasse les œufs', 'Armé contre les renards'],
    wage: 600,
    reqLevel: 3,
    max: (l) => (l >= 8 ? 3 : l >= 6 ? 2 : 1),
    outfit: { shirt: 0xb5483c, pants: 0x34557d, hat: 0xe2c06a },
  },
  seller: {
    role: 'seller',
    title: 'Vendeur·se',
    icon: '🧑‍💼',
    description: 'Tient l’étal aux heures d’ouverture.',
    boosts: ['+60 % de clients', 'Un guichet de plus', '+10 % de panier moyen'],
    wage: 900,
    reqLevel: 4,
    max: () => 1,
    outfit: { shirt: 0xf6f2ea, pants: 0x3d4a63, hat: null, apron: 0x2f6bff },
  },
  caretaker: {
    role: 'caretaker',
    title: 'Soigneur·se',
    icon: '🧑‍⚕️',
    description: 'Garde le troupeau en bonne santé.',
    boosts: ['Soins gratuits (+30 santé)', 'Maladies divisées par 2,5', '+4 santé et +6 bien-être par jour'],
    wage: 1000,
    reqLevel: 5,
    max: (l) => (l >= 8 ? 2 : 1),
    outfit: { shirt: 0xffffff, pants: 0x6aa0c8, hat: null },
  },
  gardener: {
    role: 'gardener',
    title: 'Jardinier·ère',
    icon: '🧑‍🌾',
    description: 'Entretient les prairies.',
    boosts: ['Reverdit d’abord les zones pelées', 'Herbe 30 % plus rapide', 'Armé contre les renards'],
    wage: 700,
    reqLevel: 3,
    max: (l) => (l >= 7 ? 2 : 1),
    outfit: { shirt: 0x5aa36b, pants: 0x6b4a2f, hat: 0x7a5a3a },
  },
};

export const ROLE_ORDER: WorkerRole[] = ['farmhand', 'seller', 'caretaker', 'gardener'];

export const STAFF = {
  startHour: 6,
  endHour: 20,
  /** Le commis arrive avant le réveil des poules pour ouvrir les trappes… */
  farmhandStart: 4.0,
  /** …et reste le soir jusqu'à ce que toutes les poules soient rentrées. */
  farmhandEnd: 21,
  /** Heure limite : les trappes sont fermées même s'il reste des retardataires. */
  closeDeadline: 23.5,
  closeTime: 1.4,
  openTime: 1.0,
  /** Attente maximale (heures de jeu) devant un poulailler avant de fermer. */
  waitMaxHours: 2,
  /** Seuils d'intervention du commis : abreuvoirs, mangeoires, propreté. */
  waterBelow: 0.7,
  feedBelow: 0.6,
  /** Commande d'eau quand la cuve descend sous cette fraction. */
  restockWaterBelow: 0.35,
  /** Commande de grain quand la réserve tient moins de ce nombre de jours (ou tombe sous restockGrainBelow de sa capacité)… */
  restockGrainDays: 2.5,
  restockGrainBelow: 0.35,
  /** …et la remplit (plusieurs sacs d'un coup s'il le faut) pour tenir ce nombre de jours. */
  restockGrainTarget: 5,
  /** Délai minimal entre deux commandes du même produit (heures de jeu). */
  restockEveryHours: 0.5,
  /** Rayon dans lequel il ramasse les œufs au passage. */
  pickupRadius: 1.1,
  sellerStart: 7.6,
  walkSpeed: 1.75,
  /** Sur la route, les salariés pressent le pas (trajet maison ↔ ferme). */
  commuteSpeed: 2.6,
  basketMax: 30,
  collectTime: 1.4,
  depositTime: 1.4,
  refillTime: 1.8,
  cleanTime: 5,
  healTime: 2.6,
  waterTime: 3,
  healAmount: 30,
  healBelow: 70,
  waterRadius: 2.3,
  waterBoost: 0.3,
  sellerFlow: 1.6,
  sellerWtp: 1.1,
  caretakerSickFactor: 0.4,
  caretakerRegen: 4,
  caretakerWellbeing: 6,
  gardenerRegrowth: 1.3,
  farmhandQuality: 0.05,
  cleanBelow: 60,
};

export const WORKER_NAMES = [
  'Léa', 'Hugo', 'Chloé', 'Lucas', 'Manon', 'Louis', 'Camille', 'Jules', 'Inès', 'Gabriel', 'Zoé', 'Arthur',
  'Jade', 'Nathan', 'Lina', 'Tom', 'Rose', 'Paul', 'Alice', 'Théo', 'Margaux', 'Victor', 'Anaïs', 'Martin',
];

/** Prénom féminin (rang pair de la liste) ? Sert à l'apparence (coiffure, barbe) ; inconnu → au hasard. */
export function femName(name: string): boolean | undefined {
  const i = WORKER_NAMES.indexOf(name.split(' ')[0]);
  return i < 0 ? undefined : i % 2 === 0;
}

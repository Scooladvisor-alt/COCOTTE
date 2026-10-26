import type { BuildingType } from '../sim/types';

export interface BuildingLevel {
  name: string;
  /** Coût de construction (niveau 1) ou d'amélioration vers ce niveau (centimes). */
  cost: number;
  reqLevel: number;
  /** Entretien journalier (centimes). */
  upkeep: number;
  /** Capacité : poules (poulailler), œufs (pondoir/stockage), rations (mangeoire), litres (abreuvoir). */
  capacity: number;
  /** Nombre de poules pouvant utiliser l'équipement en même temps. */
  slots?: number;
  /** Poulailler : confort 0..1 */
  comfort?: number;
  /** Poulailler : vitesse d'encrassement. */
  dirtFactor?: number;
  /** Mangeoire : part de grain gaspillé. */
  waste?: number;
  /** Mangeoire / abreuvoir : remplissage automatique. */
  auto?: boolean;
  /** Pondoir : bonus de qualité des œufs. Abreuvoir : bonus de santé. */
  quality?: number;
  /** Pondoir : collecte automatique vers le stockage. */
  autoCollect?: boolean;
  /** Stockage : multiplicateur de perte de fraîcheur. */
  decay?: number;
  /** Étal : clients par heure. */
  flow?: number;
  /** Étal : multiplicateur de quantité achetée par client. */
  qtyMult?: number;
  /** Bain de poussière : bonus de bien-être. */
  wellbeing?: number;
  /** Compost : vers et insectes produits par jour (portions). */
  regen?: number;
  perk?: string;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  w: number;
  d: number;
  access: 'front' | 'around' | 'none';
  unique: boolean;
  buildable: boolean;
  movable: boolean;
  icon: string;
  levels: BuildingLevel[];
}

/**
 * Le poulailler est dessiné à l'échelle 2 (modèles de 3 × 2 agrandis) : emprise de 6 × 4 cases,
 * trappe au milieu de la façade.
 */
export const COOP_SCALE = 2;

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  coop: {
    type: 'coop',
    name: 'Poulailler',
    description: 'Abrite les poules la nuit. Sa capacité limite la taille du troupeau, son confort améliore le bien-être.',
    w: 3 * COOP_SCALE,
    d: 2 * COOP_SCALE,
    access: 'front',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🏠',
    levels: [
      { name: 'Cabane', cost: 3500, reqLevel: 1, upkeep: 20, capacity: 8, comfort: 0.35, dirtFactor: 1 },
      { name: 'Poulailler en bois', cost: 4500, reqLevel: 2, upkeep: 45, capacity: 16, comfort: 0.55, dirtFactor: 1, perk: 'Accueille les Araucana' },
      { name: 'Poulailler isolé', cost: 16000, reqLevel: 3, upkeep: 100, capacity: 28, comfort: 0.78, dirtFactor: 0.9, perk: 'Accueille les Marans' },
      { name: 'Poulailler moderne', cost: 45000, reqLevel: 5, upkeep: 200, capacity: 45, comfort: 1, dirtFactor: 0.6, perk: 'Ventilation : s’encrasse moins vite' },
    ],
  },
  nest: {
    type: 'nest',
    name: 'Pondoir',
    description: 'Les poules y pondent des œufs propres, faciles à ramasser. Sans place libre, elles pondent au sol.',
    w: 2,
    d: 1,
    access: 'front',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🪺',
    levels: [
      { name: 'Pondoir simple', cost: 2000, reqLevel: 1, upkeep: 5, capacity: 8, quality: 0 },
      { name: 'Pondoir double', cost: 5500, reqLevel: 2, upkeep: 10, capacity: 20, quality: 0.04 },
      { name: 'Pondoir à rouleau', cost: 18000, reqLevel: 4, upkeep: 30, capacity: 50, quality: 0.08, autoCollect: true, perk: 'Collecte automatique vers le stockage' },
    ],
  },
  feeder: {
    type: 'feeder',
    name: 'Mangeoire',
    description: 'Distribue le grain du stock. Complète l’herbe que les poules picorent.',
    w: 1,
    d: 1,
    access: 'around',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🌾',
    levels: [
      { name: 'Mangeoire en bois', cost: 1200, reqLevel: 1, upkeep: 3, capacity: 15, slots: 3, waste: 0.15, auto: false },
      { name: 'Trémie automatique', cost: 6000, reqLevel: 2, upkeep: 8, capacity: 40, slots: 5, waste: 0.08, auto: true, perk: 'Se remplit seule depuis le stock' },
      { name: 'Distributeur à silo', cost: 20000, reqLevel: 5, upkeep: 20, capacity: 120, slots: 8, waste: 0.03, auto: true, perk: 'Gaspillage minimal' },
    ],
  },
  drinker: {
    type: 'drinker',
    name: 'Abreuvoir',
    description: 'Fournit l’eau. L’eau distribuée est facturée chaque soir.',
    w: 1,
    d: 1,
    access: 'around',
    unique: false,
    buildable: true,
    movable: true,
    icon: '💧',
    levels: [
      { name: 'Seau abreuvoir', cost: 800, reqLevel: 1, upkeep: 2, capacity: 8, slots: 3, auto: false, quality: 0 },
      { name: 'Abreuvoir à niveau', cost: 4500, reqLevel: 2, upkeep: 6, capacity: 25, slots: 5, auto: true, quality: 0, perk: 'Raccordé au réseau : remplissage automatique' },
      { name: 'Ligne de pipettes', cost: 16000, reqLevel: 5, upkeep: 15, capacity: 80, slots: 8, auto: true, quality: 4, perk: 'Eau propre : +santé' },
    ],
  },
  storage: {
    type: 'storage',
    name: 'Stockage des œufs',
    description: 'Conserve les œufs ramassés avant la vente. Les niveaux supérieurs ralentissent leur vieillissement.',
    w: 2,
    d: 2,
    access: 'none',
    unique: true,
    buildable: false,
    movable: true,
    icon: '📦',
    levels: [
      { name: 'Garde-manger', cost: 3000, reqLevel: 1, upkeep: 5, capacity: 100, decay: 1 },
      { name: 'Étagère ventilée', cost: 7000, reqLevel: 2, upkeep: 15, capacity: 350, decay: 0.8 },
      { name: 'Chambre froide', cost: 30000, reqLevel: 4, upkeep: 60, capacity: 900, decay: 0.35, perk: 'Œufs frais 3× plus longtemps' },
      { name: 'Entrepôt réfrigéré', cost: 120000, reqLevel: 7, upkeep: 150, capacity: 2500, decay: 0.25 },
    ],
  },
  dustbath: {
    type: 'dustbath',
    name: 'Bain de poussière',
    description: 'Les poules s’y ébrouent et se débarrassent des parasites : bien-être en hausse et deux fois moins de maladies pour les poules de la parcelle.',
    w: 2,
    d: 2,
    access: 'around',
    unique: false,
    buildable: true,
    movable: true,
    icon: '⛱️',
    levels: [
      { name: 'Bain de poussière', cost: 3500, reqLevel: 2, upkeep: 3, capacity: 0, slots: 3, wellbeing: 10 },
      { name: 'Bain de sable couvert', cost: 9000, reqLevel: 4, upkeep: 6, capacity: 0, slots: 5, wellbeing: 16, perk: 'Abrité : encore moins de parasites et de maladies' },
    ],
  },
  pond: {
    type: 'pond',
    name: 'Mare',
    description: 'Un point d’eau naturel : les poules viennent y boire, et la pluie la remplit toute seule (eau gratuite, plus au printemps et en automne, moins en été). Un coin de fraîcheur qui apaise les poules de la parcelle et leur donne moins soif.',
    w: 3,
    d: 3,
    access: 'around',
    unique: false,
    buildable: true,
    movable: true,
    icon: '',
    levels: [
      { name: 'Mare', cost: 6000, reqLevel: 2, upkeep: 0, capacity: 60, slots: 6, regen: 70, wellbeing: 6 },
      { name: 'Grande mare', cost: 14000, reqLevel: 4, upkeep: 0, capacity: 160, slots: 9, regen: 160, wellbeing: 10, perk: 'Plus d’eau de pluie, des canards s’y installent' },
    ],
  },
  tree: {
    type: 'tree',
    name: 'Arbre d’ombrage',
    description: 'De l’ombre et un abri : les poules de la parcelle sont plus sereines et ont moins soif (surtout l’été), et une buse ne peut pas attraper une poule réfugiée sous ses branches. Plusieurs arbres se cumulent.',
    w: 1,
    d: 1,
    access: 'none',
    unique: false,
    buildable: true,
    movable: true,
    icon: '',
    levels: [{ name: 'Arbre d’ombrage', cost: 1500, reqLevel: 1, upkeep: 0, capacity: 0, wellbeing: 4 }],
  },
  compost: {
    type: 'compost',
    name: 'Compost',
    description: 'Les déchets s’y décomposent et grouillent de vers et d’insectes : les poules s’en régalent. Plus heureuses, elles pondent davantage et leurs œufs sont plus riches en protéines.',
    w: 2,
    d: 2,
    access: 'around',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🪱',
    levels: [
      { name: 'Tas de compost', cost: 4000, reqLevel: 2, upkeep: 2, capacity: 30, slots: 4, regen: 40 },
      { name: 'Composteur en bois', cost: 12000, reqLevel: 4, upkeep: 4, capacity: 60, slots: 6, regen: 80, perk: 'Deux fois plus de vers' },
    ],
  },
  incubator: {
    type: 'incubator',
    name: 'Couveuse',
    description: 'Garde les œufs fécondés au chaud et les retourne : au bout de 15 jours, ils éclosent. Les poussins grandissent avec les poules et deviennent pondeuses à 30 jours.',
    w: 2,
    d: 1,
    access: 'none',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🐣',
    levels: [
      { name: 'Petite couveuse', cost: 9000, reqLevel: 2, upkeep: 15, capacity: 12, quality: 0 },
      { name: 'Couveuse automatique', cost: 26000, reqLevel: 4, upkeep: 30, capacity: 30, quality: 0.08, perk: 'Retournement automatique : plus d’éclosions' },
      { name: 'Incubateur professionnel', cost: 65000, reqLevel: 6, upkeep: 60, capacity: 72, quality: 0.15, perk: 'Hygrométrie régulée : éclosions quasi certaines' },
    ],
  },
  stand: {
    type: 'stand',
    name: 'Étal de vente',
    description: 'Les clients du village s’y arrêtent de 8 h à 20 h et achètent au prix que vous fixez.',
    w: 2,
    d: 1,
    access: 'none',
    unique: true,
    buildable: false,
    movable: false,
    icon: '🧺',
    levels: [
      { name: 'Étal en bois', cost: 0, reqLevel: 1, upkeep: 10, capacity: 0, flow: 0.9, qtyMult: 1 },
      { name: 'Échoppe', cost: 15000, reqLevel: 3, upkeep: 30, capacity: 0, flow: 1.6, qtyMult: 1.25, perk: 'Vente en boîtes : paniers plus gros' },
      { name: 'Boutique de la ferme', cost: 55000, reqLevel: 6, upkeep: 80, capacity: 0, flow: 2.8, qtyMult: 1.5, perk: 'Clientèle fidèle' },
    ],
  },
};

export const BUILD_ORDER: BuildingType[] = ['coop', 'nest', 'feeder', 'drinker', 'pond', 'tree', 'dustbath', 'compost', 'incubator'];

/** Position fixe de l'étal (hors parcelles, sur la place pavée qui donne sur le trottoir). */
export const STAND_POS = { x: 17.2, z: 31.8 };

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
  /** Poussinière : vitesse de croissance des poussins (1 = normale). */
  growth?: number;
  perk?: string;
  /** Emprise propre à ce niveau (sinon celle du bâtiment) : les grandes auges s'allongent selon x. */
  w?: number;
  d?: number;
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
  /** Niveau de ferme exigé même quand les niveaux requis sont désactivés (l'abri à oies : niveau 10). */
  strictLevel?: boolean;
}

/**
 * Le poulailler est dessiné à l'échelle 2 (modèles de 3 × 2 agrandis) : emprise de 6 × 4 cases,
 * trappe au milieu de la façade.
 */
export const COOP_SCALE = 2;
/** La réserve à œufs aussi : modèles de 2 × 2 agrandis, emprise de 4 × 4 cases. */
export const STORAGE_SCALE = 2;

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
      { name: 'Poulailler en bois', cost: 6500, reqLevel: 2, upkeep: 45, capacity: 16, comfort: 0.55, dirtFactor: 1, perk: 'Accueille les Araucana' },
      { name: 'Poulailler isolé', cost: 22000, reqLevel: 3, upkeep: 100, capacity: 28, comfort: 0.78, dirtFactor: 0.9, perk: 'Accueille les Marans' },
      { name: 'Poulailler moderne', cost: 63000, reqLevel: 5, upkeep: 200, capacity: 45, comfort: 1, dirtFactor: 0.6, perk: 'Ventilation : s’encrasse moins vite' },
      { name: 'Grand poulailler moderne', cost: 170000, reqLevel: 7, upkeep: 320, capacity: 80, comfort: 1, dirtFactor: 0.5, w: 8, d: 5, perk: 'Mêmes panneaux isolés, en grand (8 × 5 cases) : 80 places, ventilation renforcée' },
      { name: 'Bâtiment avicole plein air', cost: 390000, reqLevel: 9, upkeep: 520, capacity: 140, comfort: 1, dirtFactor: 0.4, w: 10, d: 6, perk: 'Grand bâtiment de 10 × 6 cases : 140 places, silo et ventilation' },
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
      { name: 'Pondoir double', cost: 7500, reqLevel: 2, upkeep: 10, capacity: 20, quality: 0.04 },
      { name: 'Pondoir à rouleau', cost: 25000, reqLevel: 4, upkeep: 30, capacity: 50, quality: 0.08, autoCollect: true, perk: 'Collecte automatique vers le stockage' },
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
      { name: 'Trémie automatique', cost: 8500, reqLevel: 2, upkeep: 8, capacity: 40, slots: 5, waste: 0.08, auto: true, perk: 'Se remplit seule depuis le stock' },
      { name: 'Distributeur à silo', cost: 28000, reqLevel: 5, upkeep: 20, capacity: 120, slots: 8, waste: 0.03, auto: true, perk: 'Gaspillage minimal' },
      { name: 'Auge longue galvanisée', cost: 63000, reqLevel: 6, upkeep: 30, capacity: 260, slots: 14, waste: 0.03, auto: true, w: 3, perk: '14 poules côte à côte (3 cases de long)' },
      { name: 'Chaîne d’alimentation', cost: 155000, reqLevel: 8, upkeep: 55, capacity: 600, slots: 22, waste: 0.02, auto: true, w: 4, perk: '22 poules à la fois, grain distribué en continu (4 cases)' },
      { name: 'Grande bassine à grain', cost: 320000, reqLevel: 11, upkeep: 85, capacity: 1100, slots: 30, waste: 0.015, auto: true, w: 6, perk: 'Une longue bassine de zinc, sobre et sans gaspillage : 30 poules à la fois (6 cases)' },
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
      { name: 'Abreuvoir à niveau', cost: 6500, reqLevel: 2, upkeep: 6, capacity: 25, slots: 5, auto: true, quality: 0, perk: 'Raccordé au réseau : remplissage automatique' },
      { name: 'Ligne de pipettes', cost: 22000, reqLevel: 5, upkeep: 15, capacity: 80, slots: 8, auto: true, quality: 4, perk: 'Eau propre : +santé' },
      { name: 'Abreuvoir long en inox', cost: 50000, reqLevel: 6, upkeep: 25, capacity: 200, slots: 14, auto: true, quality: 5, w: 3, perk: '14 poules côte à côte (3 cases de long)' },
      { name: 'Grand bac abreuvoir', cost: 125000, reqLevel: 8, upkeep: 45, capacity: 450, slots: 22, auto: true, quality: 7, w: 4, perk: 'Grand bac en béton à niveau constant : 22 poules à la fois (4 cases)' },
      { name: 'Grande bassine à eau', cost: 260000, reqLevel: 11, upkeep: 70, capacity: 800, slots: 30, auto: true, quality: 8, w: 6, perk: 'Une longue bassine en inox à niveau constant, eau toujours claire : 30 poules à la fois (6 cases)' },
    ],
  },
  storage: {
    type: 'storage',
    name: 'Stockage des œufs',
    description: 'Conserve les œufs ramassés avant la vente. Les niveaux supérieurs ralentissent leur vieillissement.',
    w: 2 * STORAGE_SCALE,
    d: 2 * STORAGE_SCALE,
    access: 'none',
    unique: true,
    buildable: false,
    movable: true,
    icon: '📦',
    levels: [
      { name: 'Garde-manger', cost: 3000, reqLevel: 1, upkeep: 5, capacity: 100, decay: 1 },
      { name: 'Étagère ventilée', cost: 10000, reqLevel: 2, upkeep: 15, capacity: 350, decay: 0.8 },
      { name: 'Chambre froide', cost: 42000, reqLevel: 4, upkeep: 60, capacity: 900, decay: 0.35, perk: 'Œufs frais 3× plus longtemps' },
      { name: 'Entrepôt réfrigéré', cost: 170000, reqLevel: 7, upkeep: 150, capacity: 2500, decay: 0.25 },
      { name: 'Plateforme frigorifique', cost: 420000, reqLevel: 9, upkeep: 320, capacity: 6000, decay: 0.15, w: 6, d: 4, perk: 'Trois quais de chargement : 6 000 œufs, fraîcheur prolongée (6 × 4 cases)' },
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
      { name: 'Bain de sable couvert', cost: 13000, reqLevel: 4, upkeep: 6, capacity: 0, slots: 5, wellbeing: 16, perk: 'Abrité : encore moins de parasites et de maladies' },
      { name: 'Grand bain de sable', cost: 31000, reqLevel: 6, upkeep: 10, capacity: 0, slots: 8, wellbeing: 20, w: 3, d: 3, perk: 'Grand bassin de pierre à ciel ouvert (3 × 3 cases), sable fin ratissé : 8 places et très peu de maladies' },
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
      { name: 'Grande mare', cost: 20000, reqLevel: 4, upkeep: 0, capacity: 160, slots: 9, regen: 160, wellbeing: 10, perk: 'Plus d’eau de pluie, des canards s’y installent' },
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
  bush: {
    type: 'bush',
    name: 'Buisson',
    description: 'Un buisson sauvage, resté là quand vous avez acheté la parcelle. Il ne gêne que si vous voulez construire à cet endroit.',
    w: 1,
    d: 1,
    access: 'none',
    unique: false,
    buildable: false,
    movable: false,
    icon: '',
    levels: [{ name: 'Buisson', cost: 0, reqLevel: 1, upkeep: 0, capacity: 0 }],
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
      { name: 'Composteur en bois', cost: 17000, reqLevel: 4, upkeep: 4, capacity: 60, slots: 6, regen: 80, perk: 'Deux fois plus de vers' },
    ],
  },
  goosehouse: {
    type: 'goosehouse',
    name: 'Abri à oies',
    description: 'La maison des oies : elles y dorment à l’abri du renard, sans se mêler aux poules. Il en faut un avant d’acheter des oies ; sa capacité limite leur nombre.',
    w: 4,
    d: 3,
    access: 'front',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🪿',
    strictLevel: true,
    levels: [
      { name: 'Abri à oies', cost: 15000, reqLevel: 10, upkeep: 40, capacity: 8, comfort: 0.8, dirtFactor: 0.8, perk: 'Loge en bois basse et paillée : 8 oies' },
      { name: 'Grande loge à oies', cost: 56000, reqLevel: 10, upkeep: 80, capacity: 16, comfort: 0.95, dirtFactor: 0.7, w: 5, d: 3, perk: 'Deux fois plus de place, abreuvoir de bac : 16 oies' },
      { name: 'Maison des oies', cost: 125000, reqLevel: 10, upkeep: 140, capacity: 30, comfort: 1, dirtFactor: 0.55, w: 6, d: 4, perk: 'Grande maison de pierre et de bois, petite mare : 30 oies' },
    ],
  },
  incubator: {
    type: 'incubator',
    name: 'Couveuse',
    description: 'Faite pour la poussinière : elle s’installe sur un de ses emplacements et ne se pose nulle part ailleurs. Elle garde les œufs fécondés au chaud et les retourne ; au bout de 15 jours, les poussins éclosent directement à la poussinière et deviennent pondeuses à 30 jours.',
    // aucune case au sol : elle occupe un emplacement de la poussinière
    w: 0,
    d: 0,
    access: 'none',
    unique: false,
    buildable: true,
    movable: false,
    icon: '🐣',
    levels: [
      { name: 'Petite couveuse', cost: 9000, reqLevel: 2, upkeep: 15, capacity: 12, quality: 0 },
      { name: 'Couveuse automatique', cost: 36000, reqLevel: 4, upkeep: 30, capacity: 30, quality: 0.08, perk: 'Retournement automatique : plus d’éclosions' },
      { name: 'Incubateur professionnel', cost: 91000, reqLevel: 6, upkeep: 60, capacity: 72, quality: 0.15, perk: 'Hygrométrie régulée : éclosions quasi certaines' },
    ],
  },
  gooseincubator: {
    type: 'gooseincubator',
    name: 'Couveuse à oies',
    description: 'Un grand coffre paillé sous châssis vitré, chauffé par une lampe : les œufs d’oie fécondés y éclosent en 15 jours. L’oison sort tout seul par sa petite rampe et rejoint aussitôt les oies, sans passer par la poussinière. Il faut un jars pour féconder les œufs.',
    w: 3,
    d: 2,
    access: 'none',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🪿',
    strictLevel: true,
    levels: [
      { name: 'Couveuse à oies', cost: 20000, reqLevel: 10, upkeep: 30, capacity: 6, quality: 0.04, perk: 'Six gros œufs bien au chaud' },
      { name: 'Grande couveuse à oies', cost: 77000, reqLevel: 10, upkeep: 60, capacity: 12, quality: 0.1, w: 4, d: 2, perk: 'Deux lampes et de la paille fraîche : 12 œufs, plus d’éclosions' },
      { name: 'Couvoir des oies', cost: 170000, reqLevel: 10, upkeep: 110, capacity: 24, quality: 0.16, w: 4, d: 3, perk: 'Poêle et hygrométrie réglés : 24 œufs, éclosions quasi certaines' },
    ],
  },
  nursery: {
    type: 'nursery',
    name: 'Poussinière',
    description: 'Le coin des poussins : un bâtiment chauffé, un parc grillagé et des emplacements pour les couveuses (un par niveau). Ils éclosent sur place et grandissent à part, loin des poules et des prédateurs. Grain et eau sont pris dans la réserve. Quand ils vont bientôt pondre, ils sortent seuls rejoindre le troupeau.',
    w: 7,
    d: 6,
    access: 'front',
    unique: false,
    buildable: true,
    movable: true,
    icon: '🐤',
    levels: [
      { name: 'Poussinière', cost: 15000, reqLevel: 3, upkeep: 25, capacity: 24, comfort: 1, growth: 1.1, perk: 'Un emplacement de couveuse, parc grillagé pour 24 poussins, croissance +10 %' },
      { name: 'Grande poussinière', cost: 70000, reqLevel: 6, upkeep: 60, capacity: 60, comfort: 1, growth: 1.25, w: 10, d: 8, perk: 'Deux emplacements de couveuse, grand parc de 10 × 8 cases pour 60 poussins, croissance +25 %' },
    ],
  },
  petshop: {
    type: 'petshop',
    name: 'Vente de poules pondeuses',
    description: 'La boutique où vous vendez vos poules et vos oies en trop, à droite du parking. Chacune a son grand parc en herbe ; les gens du village viennent avec leur carton et en emportent quelques-unes. Il lui faut un vendeur pour ouvrir.',
    // à sa place fixe, le long du trottoir : aucune case de la ferme
    w: 0,
    d: 0,
    access: 'none',
    unique: true,
    buildable: true,
    movable: false,
    strictLevel: true,
    icon: '🐔',
    levels: [
      { name: 'Petite vente de poules', cost: 100000, reqLevel: 15, upkeep: 40, capacity: 12, flow: 1.2, perk: 'Une échoppe de bois, un parc à poules et un parc à oies : 12 volailles' },
      { name: 'Vente de poules pondeuses', cost: 300000, reqLevel: 15, upkeep: 80, capacity: 30, flow: 2.1, perk: 'Vraie boutique, parcs plus grands : 30 volailles, davantage de clients' },
      { name: 'Belle vente de poules', cost: 800000, reqLevel: 15, upkeep: 150, capacity: 60, flow: 3.3, perk: 'Devanture vitrée, deux comptoirs : 60 volailles' },
      { name: 'Grande vente de poules', cost: 2000000, reqLevel: 15, upkeep: 280, capacity: 120, flow: 5.1, perk: 'Deux étages, des parcs très longs : 120 volailles' },
      { name: 'Maison des poules pondeuses', cost: 5000000, reqLevel: 15, upkeep: 500, capacity: 250, flow: 7.5, perk: 'La référence de la région, trois comptoirs : 250 volailles' },
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
      { name: 'Échoppe', cost: 21000, reqLevel: 3, upkeep: 30, capacity: 0, flow: 1.6, qtyMult: 1.25, perk: 'Vente en boîtes : paniers plus gros' },
      { name: 'Boutique de la ferme', cost: 77000, reqLevel: 6, upkeep: 80, capacity: 0, flow: 2.8, qtyMult: 1.5, perk: 'Clientèle fidèle' },
      { name: 'Magasin de la ferme', cost: 335000, reqLevel: 9, upkeep: 180, capacity: 0, flow: 4.2, qtyMult: 1.8, perk: 'Un vrai magasin à votre nom : long comptoir, trois guichets, vitrines et terrasse' },
    ],
  },
};

/**
 * Emprise d'un bâtiment à un niveau donné (cases selon x et z). Pivoté d'un quart ou de trois
 * quarts de tour (rot = 1 ou 3), il échange largeur et profondeur.
 */
export function sizeOf(type: BuildingType, level = 1, rot = 0): { w: number; d: number } {
  const def = BUILDINGS[type];
  const L = def.levels[level - 1];
  const w = L?.w ?? def.w;
  const d = L?.d ?? def.d;
  return rot % 2 ? { w: d, d: w } : { w, d };
}

export const BUILD_ORDER: BuildingType[] = ['coop', 'goosehouse', 'nest', 'feeder', 'drinker', 'pond', 'tree', 'dustbath', 'compost', 'nursery', 'incubator', 'gooseincubator'];

/**
 * Hôtel de ville (décor, à l'ouest de la grille), où logent les salariés : ligne de sa façade, et
 * point devant sa porte par lequel ils arrivent et repartent.
 */
export const HALL_FRONT = 25.2;
export const HALL_DOOR: [number, number] = [-11, 25.72];
/** La cour pavée : de l'allée qui descend au trottoir (x = HALL_ALLEY) jusqu'au bout de l'hôtel de ville. */
export const HALL_ALLEY = -6;
export const HALL_COURT = { x0: HALL_DOOR[0] - 5.3, x1: HALL_DOOR[0] + 5.3, z0: 20.6, z1: 28.8 };
/** Ce que le bâtiment occupe au sol (perron compris) : personne ne passe au travers. */
export const HALL_BODY = { x0: HALL_DOOR[0] - 4.7, x1: HALL_DOOR[0] + 4.7, z0: 20.7, z1: 25.75 };
export const HALL_STEPS = { x0: HALL_DOOR[0] - 1.45, x1: HALL_DOOR[0] + 1.45, z0: 25.2, z1: 27.3 };

/** Position fixe de l'étal (hors parcelles, sur la place pavée qui donne sur le trottoir). */
export const STAND_POS = { x: 17.2, z: 31.8 };
/** La vente de poules pondeuses (l'animalerie) : son coin nord-ouest, juste à droite du parking. */
export const PET_POS = { x: 42.7, z: 30.45 };
/** L'emplacement à construire, tant qu'elle n'existe pas (on clique dessus). */
export const PET_PLOT = { x0: 42.6, x1: 55.7, z0: 30.3, z1: 37.3 };

/** Par où les volailles quittent leur parc pour rejoindre le camion : un portillon dans la clôture du fond. */
export function penGate(level: number, goose: boolean): [number, number] {
  const L = petLayout(level);
  const pen = goose ? L.geese : L.hens;
  return [PET_POS.x + pen.x1 - 0.5, PET_POS.z + pen.z0];
}

/**
 * Plan de la vente de poules (coordonnées locales depuis PET_POS, façade vers le trottoir) : la boutique et
 * son dallage à l'ouest, puis les parcs en herbe, de plus en plus longs : poules d'abord, oies ensuite.
 */
export function petLayout(level = 1) {
  const i = Math.max(0, Math.min(4, level - 1));
  const w = [13, 19, 25, 31, 38][i];
  const bw = [5.5, 6.5, 8, 9, 10.5][i];
  const x0 = bw + 0.9;
  const split = x0 + (w - x0) * 0.66;
  return {
    w,
    bw,
    /** Milieu des comptoirs (monde), où s'arrêtent les clients, écart entre comptoirs. */
    cx: PET_POS.x + 0.3 + bw / 2,
    stopZ: PET_POS.z + 4.55,
    gap: 1.15,
    counters: level >= 5 ? 3 : level >= 3 ? 2 : 1,
    hens: { x0, x1: split, z0: 0.3, z1: 6.2 },
    geese: { x0: split + 0.3, x1: w - 0.1, z0: 0.3, z1: 6.2 },
    center: { x: PET_POS.x + w / 2, z: PET_POS.z + 3.2 },
  };
}

/**
 * Où se passe la vente selon le niveau de l'étal. cx, stopZ, gap : milieu des guichets, où s'arrêtent
 * les clients, écart entre guichets ; sellerZ : rangée des vendeurs (au magasin : derrière le long
 * comptoir) ; center, w, d : le bâtiment, pour la caméra et le halo de sélection.
 */
export function standLayout(level = 1) {
  if (level >= 4) return { cx: 20, stopZ: 35.35, gap: 1.1, sellerZ: 34.4, center: { x: 20, z: 33.4 }, w: 8.6, d: 4.2 };
  return { cx: STAND_POS.x + 1, stopZ: STAND_POS.z + 1.25, gap: 0.62, sellerZ: 0, center: { x: STAND_POS.x + 1, z: STAND_POS.z + 0.3 }, w: 2, d: 1 };
}

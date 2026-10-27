// ============================================================================
//  ÉQUILIBRAGE CENTRALISÉ
//  Toutes les valeurs économiques et de simulation sont ici. Les montants sont
//  exprimés en CENTIMES (entiers) pour éviter toute dérive d'arrondi.
// ============================================================================

import type { EggType, Grade } from '../sim/types';

// ---------------------------------------------------------------- Temps ----
export const TIME = {
  /** Durée d'une journée de jeu en secondes simulées (vitesse x1 = temps réel). */
  DAY: 180,
  /** Pas fixe de simulation (secondes simulées). Indépendant du nombre d'images. */
  STEP: 0.1,
  /** Pas plus grossier utilisé pour la progression hors-ligne. */
  OFFLINE_STEP: 0.25,
  /** Plafond de la progression hors ligne, en jours de jeu. */
  OFFLINE_MAX_DAYS: 2,
  /** Heure de début de partie. */
  START_HOUR: 7,
  NIGHT_START: 21,
  NIGHT_END: 5.5,
  SHOP_OPEN: 8,
  SHOP_CLOSE: 20,
  CONTRACT_HOUR: 17,
  /** « Passer la nuit » : possible à partir de cette heure… */
  SKIP_FROM: 20,
  /** …jusqu'au réveil de la ferme, où l'on reprend. */
  WAKE_HOUR: 6.5,
  SPEEDS: [0, 1, 3, 10] as const,
};
export const HOUR = TIME.DAY / 24;
/** Secondes de jour (hors nuit) par journée — base du rythme de ponte. */
export const DAYTIME_SECONDS = (TIME.NIGHT_START - TIME.NIGHT_END) * HOUR;

// ---------------------------------------------------------------- Monde ----
export const WORLD = {
  /** Côté d'une parcelle (cases). Des parcelles de 20 × 20 : de vrais prés. */
  PARCEL: 20,
  COLS: 4,
  ROWS: 3,
  /**
   * Bord nord de la grille (z). La grille s'étend de Z0 à Z0 + ROWS × PARCEL (= 30, la route au
   * sud) : la ferme grandit vers le nord et l'est, la maison et le village restent à leur place.
   */
  Z0: -30,
  START_PARCEL: '0,2',
  /**
   * Axe de la route (z) devant les parcelles. Entre la clôture (z = 30) et la route : la petite
   * place pavée de l'étal, puis le trottoir où marchent les passants.
   */
  ROAD_Z: 37.3,
  /** Demi-largeur de la chaussée (deux voies). */
  ROAD_HALF: 1.7,
  /** Axe du trottoir côté ferme (1,2 m de large). */
  WALK_Z: 34.9,
  /** La route traverse tout le paysage, d'un horizon à l'autre. */
  ROAD_MIN_X: -230,
  ROAD_MAX_X: 310,
};
export const GRID_W = WORLD.PARCEL * WORLD.COLS;
export const GRID_H = WORLD.PARCEL * WORLD.ROWS;
/** Première ligne (z) de la grille, et bord sud (z) juste après la dernière ligne. */
export const GRID_Z0 = WORLD.Z0;
export const GRID_Z1 = WORLD.Z0 + GRID_H;

// ------------------------------------------------------------- Départ ----
export const START = {
  /** 500 € : de quoi acheter ses premières poules des deux races de départ et s'équiper. */
  money: 50000,
  grain: 20,
  reputation: 30,
};

// ------------------------------------------------------------ Besoins ----
/** Coqs rivaux : un combat quand un nouveau coq rencontre les autres, puis rarement. */
export const ROOSTER_FIGHTS = {
  /** Combats spontanés par jour et par paire de coqs adultes (déjà présentés). */
  perPairPerDay: 0.18,
  /** Durée du face-à-face (s). */
  duration: [4, 7] as [number, number],
  /** Bien-être perdu par les deux coqs, santé perdue par le vaincu. */
  wellbeingLoss: 5,
  loserHealthLoss: 3,
};

export const NEEDS = {
  /** Perte de satiété par jour (x appétit de la race). */
  satietyPerDay: 75,
  hydrationPerDay: 85,
  /** Multiplicateur de consommation pendant le sommeil (une poule qui dort ne boit presque pas). */
  nightFactor: 0.2,
  /** Satiété gagnée par seconde à la mangeoire. */
  eatRate: 14,
  /** Hydratation gagnée par seconde à l'abreuvoir. */
  drinkRate: 22,
  /** Satiété apportée par une ration (125 : une poule mange un cinquième de grain en moins qu'avant). */
  pointsPerRation: 125,
  /** Hydratation apportée par un litre (125 : un cinquième d'eau en moins). */
  pointsPerLiter: 125,
  /** Picorage : satiété gagnée par seconde sur une herbe pleine (x aptitude de la race). */
  forageRate: 1.0,
  /** Points de satiété contenus dans une case d'herbe pleine. */
  grassPoints: 60,
  /**
   * Seuils de faim et de soif : une poule ne file à la mangeoire ou à l'abreuvoir qu'une fois
   * l'estomac à moitié vide ; le reste du temps, elle picore et gratte le sol en se baladant.
   */
  hungryAt: 38,
  thirstyAt: 36,
  urgentAt: 26,
  /** Elle quitte la mangeoire (ou l'abreuvoir) une fois rassasiée à ce niveau. */
  fullAt: 92,
};

export const GRASS = {
  /** Repousse : base + logistique (par jour). */
  regrowBase: 0.03,
  regrowLogistic: 0.35,
  start: 0.95,
  reseedCost: 1500,
  reseedBoost: 0.45,
};

// ------------------------------------------------------- Santé / bien-être ----
export const HEALTH = {
  /** Une poule robuste : elle récupère vite et n'encaisse de vraies pertes qu'en cas de manque réel. */
  regenPerDay: 12,
  starvingLoss: 14,
  thirstLoss: 18,
  /** En dessous de ce niveau de satiété ou d'hydratation, la poule s'affaiblit. */
  starvingAt: 6,
  dirtyLoss: 5,
  unhappyLoss: 3,
  sickLoss: 6,
  /**
   * Plancher de santé tant que la poule n'est ni malade ni affamée ni assoiffée : le stress ou un
   * poulailler un peu sale la fatiguent, mais ne la tuent jamais.
   */
  safeFloor: 35,
  sickChancePerDay: 0.008,
  /** Guérison spontanée par jour d'une poule malade bien tenue (×2 avec un soigneur). */
  recoverPerDay: 0.7,
  vetCost: 600,
  vetHeal: 45,
  /** En dessous : la poule est signalée comme fragile. */
  warnAt: 40,
};

export const WELLBEING = {
  base: 56,
  comfortWeight: 22,
  cleanWeight: 12,
  grassWeight: 10,
  crowdPenalty: 14,
  dustbathBonus: [0, 8, 14],
  soieBonus: 4,
  needPenalty: 16,
  approachPerDay: 40,
};

export const COOP_HYGIENE = {
  /** Perte de propreté par jour à pleine occupation. */
  dirtPerDay: 22,
  cleanBase: 100,
  cleanPerSlot: 15,
};

// ---------------------------------------------------------------- Ponte ----
export const LAYING = {
  /** Durée de l'animation de ponte (s simulées). */
  layDuration: 3.2,
  /** Âge (jours) à partir duquel une poule est vieille : sa ponte décline doucement. */
  declineStart: 600,
  declineEnd: 800,
  declineFloor: 0.35,
  /** Montée en ponte des jeunes poules. */
  rampDays: 6,
  rampStart: 0.85,
  groundQualityPenalty: 0.22,
  /** Après cette heure, une poule garde son œuf pour le lendemain matin. */
  lastLayHour: 20.25,
  /**
   * Faute de place au pondoir, la poule patiente (file d'attente) ; elle ne se résout
   * à pondre par terre qu'au-delà de cette « urgence » (layProgress, plafonné à 1,5).
   */
  holdUntil: 1.4,
};

// ------------------------------------------------------------ Les œufs ----
export interface EggTypeDef {
  id: EggType;
  name: string;
  short: string;
  /** Prix de référence du marché (centimes). */
  ref: number;
  specialty: boolean;
  color: number;
}

export const EGG_TYPES: Record<EggType, EggTypeDef> = {
  roux: { id: 'roux', name: 'Œuf roux', short: 'Roux', ref: 120, specialty: false, color: 0xc98a55 },
  blanc: { id: 'blanc', name: 'Œuf blanc', short: 'Blanc', ref: 110, specialty: false, color: 0xf6f1e7 },
  creme: { id: 'creme', name: 'Gros œuf crème', short: 'Crème', ref: 155, specialty: false, color: 0xeedbb4 },
  mini: { id: 'mini', name: 'Petit œuf de Soie', short: 'Mini', ref: 95, specialty: false, color: 0xf3e6cf },
  bleu: { id: 'bleu', name: 'Œuf bleu', short: 'Bleu', ref: 280, specialty: true, color: 0x9fcad6 },
  chocolat: { id: 'chocolat', name: 'Œuf chocolat', short: 'Choco', ref: 330, specialty: true, color: 0x7b4a2d },
  // pondu par la poule aux œufs d'or ; il ne passe ni par le stockage ni par le marché (voir sim/eggs.ts)
  or: { id: 'or', name: 'Œuf d’or', short: 'Or', ref: 15000, specialty: true, color: 0xf2c230 },
};
export const EGG_ORDER: EggType[] = ['roux', 'blanc', 'creme', 'mini', 'bleu', 'chocolat'];

export const GRADES: Record<Grade, { name: string; mult: number; min: number }> = {
  extra: { name: 'Extra', mult: 1.15, min: 0.8 },
  A: { name: 'Catégorie A', mult: 1.0, min: 0.55 },
  B: { name: 'Catégorie B', mult: 0.8, min: 0 },
};
export const GRADE_RANK: Record<Grade, number> = { B: 0, A: 1, extra: 2 };

export function gradeOf(quality: number): Grade {
  if (quality >= GRADES.extra.min) return 'extra';
  if (quality >= GRADES.A.min) return 'A';
  return 'B';
}

export const FRESHNESS = {
  /** Perte de fraîcheur par jour en stockage de base. */
  decayPerDay: 9,
  /** Perte pour les œufs restés au pondoir / au sol. */
  nestDecayPerDay: 14,
  groundDecayPerDay: 30,
  /** Un œuf pondu au sol et non ramassé pourrit au bout d'un jour : invendable, perte sèche. */
  groundRotDays: 1,
  /** À partir de cet âge (jours), l'œuf au sol noircit et un écriteau prévient. */
  groundWarnDays: 0.6,
};
export function freshnessFactor(f: number): number {
  return 0.7 + 0.3 * Math.max(0, Math.min(100, f)) / 100;
}

// ---------------------------------------------------------- Le marché ----
export const MARKET = {
  /** Écart-type (log) du consentement à payer des clients. */
  wtpSigma: 0.22,
  gourmetShare: 0.35,
  gourmetSpecialtyBonus: 1.25,
  wantChoices: [2, 4, 6, 6, 6, 6, 10, 12, 12],
  walkSpeed: 2.1,
  /** File d'attente à l'étal : au-delà de maxQueue personnes qui attendent, les passants ne s'arrêtent pas. */
  maxQueue: 5,
  /** Patience d'un client dans la file (secondes simulées ; une heure de jeu = 7,5 s). */
  patience: [6, 13] as [number, number],
  /** Le vendeur sert plus vite (durée de service multipliée). */
  sellerServe: 0.7,
  /** Distance (le long de la route) à laquelle apparaissent les clients. */
  spawnDistance: 17,
  shopTime: 2.4,
  trendMin: 0.85,
  trendMax: 1.15,
  /** Tendance du marché : marche aléatoire lissée (élan), elle dérive lentement au lieu de sauter. */
  trendStep: 0.012,
  trendMomentum: 0.72,
  trendReversion: 0.06,
  grainMin: 0.88,
  grainMax: 1.14,
  /** Prix de gros de la coopérative (fraction du prix de référence). */
  wholesaleFactor: 0.55,
  palletFactor: 0.78,
  palletSize: 180,
  palletsPerDay: 3,
  repFlow(rep: number) {
    return 0.6 + 0.8 * rep / 100;
  },
  repWtp(rep: number) {
    return 0.95 + 0.15 * rep / 100;
  },
};

export const REPUTATION = {
  sale: 0.3,
  tooExpensive: -0.04,
  outOfStock: -0.02,
  /** Client reparti lassé d'attendre (ou qui a renoncé devant une file trop longue). */
  leftQueue: -0.05,
  /** En dessous de ce seuil, le bouche-à-oreille remonte doucement la réputation. */
  floor: 25,
  floorRecoveryPerDay: 1.5,
  orderDone: 3,
  orderFailed: -4,
  /** Annuler une commande acceptée (le client est prévenu à temps) ; résilier un contrat. */
  orderCancelled: -1.5,
  /** Vieille poule confiée à une association ou à un particulier. */
  rehomed: 1.2,
  contractCancelled: -2.5,
  contractDay: 0.4,
  contractMiss: -2,
  soiePerDay: 0.12,
};

// ------------------------------------------------- Commandes & contrats ----
/** Lots de poules : plus le lot est gros, moins chaque poule coûte. Livrés en camion. */
export const HEN_PACKS = [
  { count: 6, discount: 0.08 },
  { count: 12, discount: 0.15 },
  { count: 24, discount: 0.22 },
];
/** Livraison des lots : délai avant l'arrivée du camion, trajet, déchargement (secondes simulées). */
/**
 * Camion du couvoir : délai de livraison, trajet, et déchargement (une poule saute du hayon toutes
 * les henGap s et trottine jusqu'au portail). Jusqu'à `slots` camions en convoi, garés aux
 * places `stops` (m à l'est du portail ; le passage piéton reste dégagé).
 */
export const DELIVERY = { delay: 16, drive: 8, firstJump: 1.0, henGap: 0.5, henSpeed: 2.3, closeUp: 1.4, stops: [0, 8.4, 12.8], tail: 1.55, convoyGap: 1.1, joinMargin: 4, slots: 3 };

export const ORDERS = {
  maxOffers: 3,
  maxActive: 3,
  /** Tailles possibles des petites et des grosses commandes (les moyennes vont de 36 à 96 œufs). */
  smallQty: [6, 10, 12, 18, 20, 24, 30],
  largeQty: [120, 144, 150, 180, 200],
  priceMin: 1.15,
  priceMax: 1.4,
  daysMin: 2,
  daysMax: 4,
  offerDays: 2,
  xp: 12,
  clients: [
    'Boulangerie Martin',
    'Crêperie du Port',
    'Restaurant Le Coq d’Or',
    'Pâtisserie Lemoine',
    'Cantine de l’école',
    'Auberge des Tilleuls',
    'Traiteur Dubois',
    'Café de la Place',
    'Biscuiterie Rolland',
    'Hôtel du Lac',
  ],
};

export const CONTRACTS = {
  maxOffers: 2,
  maxActive: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3],
  priceMin: 0.98,
  priceMax: 1.12,
  daysMin: 6,
  daysMax: 12,
  offerDays: 3,
  missPenalty: 0.35,
  xpPerDay: 4,
  clients: [
    'Épicerie Duval',
    'Supérette du Bourg',
    'Marché Couvert',
    'Primeur Bonnet',
    'Coopérative Bio Vallée',
    'Grande Surface Hyper’Prix',
    'Collège Jean-Moulin',
  ],
};

// ---------------------------------------------------- Dépenses diverses ----
export const COSTS = {
  landTaxPerParcel: 30,
  /** Taux d'agios journalier appliqué à un solde négatif. */
  overdraftRate: 0.03,
  demolishRefund: 0.4,
  /** Revente d'une poule : fraction du prix d'achat (avant âge/santé). */
  henResale: 0.55,
};

export interface GrainSack {
  id: string;
  name: string;
  rations: number;
  price: number;
  reqLevel: number;
}
export const GRAIN_SACKS: GrainSack[] = [
  { id: 'small', name: 'Petit sac', rations: 25, price: 600, reqLevel: 1 },
  { id: 'medium', name: 'Sac de 100', rations: 100, price: 2000, reqLevel: 2 },
  { id: 'bigbag', name: 'Big bag', rations: 500, price: 8500, reqLevel: 5 },
];
export function sackPrice(sack: GrainSack, grainIndex: number): number {
  return Math.round(sack.price * grainIndex);
}

/** Réserve à grain et cuve d'eau : capacités par niveau (agrandissables en boutique). */
export interface StoreLevel {
  name: string;
  capacity: number;
  cost: number;
  reqLevel: number;
}
export const GRAIN_BINS: StoreLevel[] = [
  { name: 'Coffre à grain', capacity: 250, cost: 0, reqLevel: 1 },
  { name: 'Silo de stockage', capacity: 800, cost: 6000, reqLevel: 3 },
  { name: 'Grand silo', capacity: 2500, cost: 25000, reqLevel: 6 },
];
export const WATER_TANKS: StoreLevel[] = [
  { name: 'Cuve de 300 L', capacity: 300, cost: 0, reqLevel: 1 },
  { name: 'Citerne de 1 000 L', capacity: 1000, cost: 4500, reqLevel: 2 },
  { name: 'Réservoir de 4 000 L', capacity: 4000, cost: 18000, reqLevel: 5 },
];

/** L'eau s'achète (peu chère) et se stocke dans la cuve ; tarif dégressif selon la quantité. */
export const WATER = {
  start: 150,
  autoUnlock: 2,
  pricePerLiter(liters: number) {
    return liters >= 1000 ? 3 : liters >= 250 ? 3.5 : 4;
  },
};
export interface WaterPack {
  id: string;
  name: string;
  liters: number;
  reqLevel: number;
}
export const WATER_PACKS: WaterPack[] = [
  { id: 'w50', name: 'Bidons', liters: 50, reqLevel: 1 },
  { id: 'w250', name: 'Livraison', liters: 250, reqLevel: 1 },
  { id: 'w1000', name: 'Camion-citerne', liters: 1000, reqLevel: 3 },
];
export function waterPrice(liters: number) {
  return Math.max(1, Math.round(liters * WATER.pricePerLiter(liters)));
}

// --------------------------------------------------- Progression (XP) ----
export interface LevelDef {
  level: number;
  xp: number;
  title: string;
  phase: number;
  maxParcels: number;
  maxCoops: number;
}
/**
 * Niveaux requis pour acheter : désactivés (tout s'achète dès le début, seul l'argent limite).
 * Les niveaux restent (XP, titres, missions, débouchés commerciaux) ; remettre à true pour
 * réactiver les déblocages progressifs.
 */
export const LEVEL_GATES = false;

export const LEVELS: LevelDef[] = [
  { level: 1, xp: 0, title: 'Débutant', phase: 0, maxParcels: 1, maxCoops: 2 },
  { level: 2, xp: 45, title: 'Petit éleveur', phase: 1, maxParcels: 2, maxCoops: 2 },
  { level: 3, xp: 170, title: 'Petit éleveur', phase: 1, maxParcels: 3, maxCoops: 3 },
  { level: 4, xp: 420, title: 'Propriétaire de ferme', phase: 2, maxParcels: 4, maxCoops: 3 },
  { level: 5, xp: 850, title: 'Propriétaire de ferme', phase: 2, maxParcels: 5, maxCoops: 4 },
  { level: 6, xp: 1550, title: 'Entrepreneur avicole', phase: 3, maxParcels: 6, maxCoops: 4 },
  { level: 7, xp: 2600, title: 'Entrepreneur avicole', phase: 3, maxParcels: 8, maxCoops: 5 },
  { level: 8, xp: 4200, title: 'Grande exploitation', phase: 4, maxParcels: 10, maxCoops: 5 },
  { level: 9, xp: 6500, title: 'Grande exploitation', phase: 4, maxParcels: 12, maxCoops: 6 },
  { level: 10, xp: 9800, title: 'Grande exploitation', phase: 4, maxParcels: 12, maxCoops: 6 },
];
export const PHASES = ['Débutant', 'Petit éleveur', 'Propriétaire', 'Entrepreneur', 'Grande exploitation'];

export const XP = {
  eggCollected: 1,
  /** XP par tranche de 2 œufs vendus. */
  perTwoSold: 1,
  orderDelivered: ORDERS.xp,
};

/** Fonctionnalités débloquées par niveau. */
export const UNLOCKS = {
  wholesale: 2,
  orders: 3,
  autoGrain: 3,
  contracts: 5,
  autoWholesale: 6,
  pallets: 7,
};

// ---------------------------------------------------------------- Compost ----
/** Vers et insectes du compost : des protéines pour des poules plus heureuses et plus productives. */
/** Reproduction : coqs, œufs fécondés, couveuse, poussins. */
export const BREEDING = {
  /** Prix d'un coq par rapport à une poule de la même race. */
  roosterPriceMult: 1.5,
  /** Un coq suffit pour une dizaine de poules. */
  hensPerRooster: 10,
  /** Part maximale d'œufs fécondés (troupeau bien pourvu en coqs). */
  maxFertility: 0.9,
  /** Jours de couvaison avant l'éclosion. */
  incubationDays: 15,
  /** Jours de croissance avant l'âge adulte (ponte) ; le jeune change d'aspect par petites étapes. */
  growthDays: 30,
  /** Part de mâles à l'éclosion : un poussin sur deux, comme dans la nature. */
  roosterShare: 0.5,
  /** Taux d'éclosion : base + bonus de fraîcheur de l'œuf (+ bonus de la couveuse). */
  hatchBase: 0.55,
  hatchFresh: 0.35,
  /** Les jeunes mangent et boivent moins. */
  youngAppetite: 0.55,
  /** Valeur de revente d'un poussin (part du prix de la race). */
  chickValue: 0.3,
};

export const COMPOST = {
  /** Portions avalées par seconde de grattage. */
  eatRate: 0.6,
  /** Protéines gagnées par portion. */
  proteinPerPortion: 14,
  proteinDecayPerDay: 45,
  /** Effets à 100 de protéines. */
  wellbeing: 10,
  laying: 0.25,
  /** Les vers et insectes remplacent une partie du grain (à 100 de protéines). */
  grainSaving: 0.2,
  quality: 0.1,
  /** Une poule y retourne quand ses protéines descendent sous ce seuil. */
  seekBelow: 55,
  seekChance: 0.2,
};

// ------------------------------------------------------ Robot ramasseur ----
/** Robot ramasseur d'œufs (type aspirateur robot) : ramasse œufs au sol et pondoirs. */
export const ROBOT = {
  name: 'Robot ramasseur d’œufs',
  price: 15000,
  reqLevel: 2,
  max: (level: number) => (level >= 6 ? 3 : level >= 4 ? 2 : 1),
  /** Vitesse de déplacement (cases/s). */
  speed: 0.95,
  /** Contenance du bac (œufs). */
  capacity: 24,
  drainPerHour: 8,
  chargePerHour: 45,
  lowBattery: 18,
  /** Électricité, en centimes par jour et par robot. */
  upkeepPerDay: 100,
  resale: 0.5,
};

// --------------------------------------------------------- Chien de garde ----
/** Chien de garde : il patrouille, aboie et fait fuir renards et buses. */
export const DOG = {
  price: 15000,
  reqLevel: 1,
  /** Les prédateurs n'osent presque plus s'approcher : -96 % d'apparitions (et délai doublé). */
  predatorFactor: 0.04,
  walk: 1.05,
  run: 3.3,
  /** Distance à laquelle il fait détaler un renard (ou une buse au ras du sol). */
  scare: 1.8,
  /** Croquettes, en centimes par jour. */
  upkeepPerDay: 150,
  names: ['Rex', 'Filou', 'Médor', 'Pépite', 'Balto', 'Câline', 'Ouragan', 'Biscotte'],
};

// -------------------------------------------------------------- Clôture ----
// La ferme est clôturée d'office (grillage + portail) : les poules ne s'échappent pas.
export const FENCE = {
  /** Probabilité, par heure de jeu, qu'une poule non clôturée prenne la fuite. */
  escapePerHour: 0.035,
  /** Une poule rattrapée ne repart pas avant ce délai (heures de jeu). */
  recallHours: 3,
};

// ----------------------------------------------------------- Prédateurs ----
// De temps en temps, un renard (crépuscule, nuit, aube) ou une buse (en journée) tente
// d'emporter une poule. Le joueur les abat d'un clic ; le commis et le jardinier sortent le fusil.
export const PREDATORS = {
  /** Prime versée pour chaque renard abattu (centimes). */
  foxBounty: 500,
  /** Conditions minimales avant la première attaque. */
  minLevel: 2,
  minDay: 3,
  minHens: 5,
  /** Délai minimal entre deux attaques (heures de jeu) : un jour et demi. Doublé avec un chien. */
  minGapHours: 36,
  /** Probabilité d'apparition par heure de jeu (environ une attaque tous les 3 à 4 jours sans chien). */
  foxNightChance: 0.025,
  foxDayChance: 0.004,
  hawkLevel: 3,
  hawkChance: 0.012,
  /** Abandon d'une chasse infructueuse (secondes simulées). */
  maxLife: 75,
  /** Cadavre visible avant de disparaître. */
  corpseTime: 5,
  xpKill: 15,
  /** Rayon dans lequel les poules paniquent et s'enfuient. */
  fleeRadius: 3.4,
  fox: {
    hp: 2,
    /** À son arrivée, il observe la ferme depuis la lisière (le temps de réagir). */
    lurk: 2.6,
    trot: 1.7,
    stalk: 1.15,
    chase: 2.6,
    run: 3.3,
    /** Distance à laquelle le renard passe de l'approche à la traque, puis bondit. */
    stalkAt: 6,
    chaseAt: 2.6,
    grabAt: 0.42,
    grabTime: 2.0,
    raidTime: 2.4,
    prowlTime: 5,
    /** Un renard qui poursuit sans succès finit par changer de cible. */
    chaseMax: 6,
  },
  hawk: {
    hp: 1,
    altitude: 6.5,
    radius: 4.2,
    /** Vitesse angulaire en vol circulaire (rad/s). */
    spin: 0.6,
    circleMin: 9,
    circleMax: 13,
    fly: 5,
    diveTime: 1.7,
    grabTime: 1.3,
  },
  /** Salariés armés (commis, jardinier) : délai de réaction, portée et précision. */
  staff: {
    detectDelay: 1.2,
    range: 6.5,
    runFactor: 1.7,
    aimTime: 0.55,
    cooldown: 1.1,
    /** Un coup de fusil de chasse suffit (le joueur, lui, doit toucher le renard deux fois). */
    damage: 2,
    hitNear: 0.72,
    hitFar: 0.42,
    /** Malus de précision sur une buse en plein vol. */
    airFactor: 0.65,
  },
  /** Blessures d'une poule arrachée aux griffes d'un prédateur. */
  rescueDamage: 35,
};

/** Mares et arbres d'ombrage. */
export const NATURE = {
  /** Bonus de bien-être maximal apporté par les arbres d'une même parcelle. */
  shadeMax: 12,
  /** Ombre : soif en moins par arbre de la parcelle (×1,6 en été), plafonnée. */
  treeThirst: 0.06,
  treeThirstMax: 0.3,
  /** Une poule à moins de cette distance d'un arbre est à l'abri des buses. */
  shelterRadius: 2.4,
  /** Fraîcheur de la mare : soif en moins sur la parcelle (mare, grande mare). */
  pondThirst: [0, 0.12, 0.2],
  /** Bain de poussière : il débarrasse des parasites, les maladies se font plus rares (mult. par niveau). */
  dustSick: [1, 0.5, 0.3],
  /** La pluie remplit les mares : multiplicateur selon la saison (printemps, été, automne, hiver). */
  rainBySeason: [1.25, 0.45, 1.35, 0.8],
};

/**
 * Rareté : le coq entièrement noir (plumes à reflets verts, crête, peau, bec et pattes noirs,
 * comme l'Ayam Cemani). Il peut sortir d'un achat de coq ou d'une éclosion, très rarement, et se
 * revend une fortune.
 */
export const RARE = {
  /** Chance qu'un coq acheté soit entièrement noir. */
  blackRoosterBuy: 0.025,
  /** Chance qu'un coquelet né à la ferme soit entièrement noir. */
  blackRoosterHatch: 0.04,
  /** Valeur de revente d'un coq noir adulte en bonne santé (centimes, selon l'oiseau). */
  blackValue: [60000, 70000] as [number, number],
  /** Chance qu'une poussine née à la ferme ait des plumes d'or : dix fois plus rare que le coq noir. */
  goldenHenHatch: 0.004,
  /** La poule aux œufs d'or pond un œuf d'or tous les deux jours (en bonne forme). */
  goldEggsPerDay: 0.5,
  /** Prix d'un œuf d'or chez le collectionneur (centimes). */
  goldEggPrice: 15000,
  /** Valeur de la poule elle-même : une vingtaine d'œufs d'or. */
  goldHenEggs: 20,
};

export const PARCELS = {
  /** Une parcelle de 20 × 20 (quatre fois les anciennes) : prix en conséquence. */
  basePrice: 30000,
  growth: 1.45,
  /** Nombre de poules que peut accueillir une parcelle confortablement (limite dure). */
  hensPerParcel: 70,
};
export function parcelPrice(owned: number): number {
  return Math.round(PARCELS.basePrice * Math.pow(PARCELS.growth, Math.max(0, owned - 1)) / 100) * 100;
}

export const AUTOSAVE_SECONDS = 15;
export const SAVE_VERSION = 9;

/**
 * Mentions légales (obligatoires en France, même pour un site personnel non commercial).
 * Un particulier peut rester anonyme : il suffit d'indiquer comment le joindre et l'hébergeur.
 */
export const LEGAL = {
  editor: 'Cocotte est un jeu gratuit, sans publicité, édité à titre personnel et non commercial.',
  /** À compléter : une adresse e-mail de contact (ou un lien vers la page GitHub du projet). */
  contact: 'antownin@gmail.com',
  host: 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — vercel.com',
};

// Utilitaires de formules ---------------------------------------------------
export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
export function smoothstep(a: number, b: number, v: number) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

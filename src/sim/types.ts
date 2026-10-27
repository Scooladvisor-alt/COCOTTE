// Types partagés de la simulation. Toute la logique de jeu manipule ces structures,
// le rendu et l'interface ne font que les lire (et passer par actions.ts pour les modifier).

export type BreedId = 'rousse' | 'leghorn' | 'sussex' | 'soie' | 'araucana' | 'marans';
export type EggType = 'roux' | 'blanc' | 'creme' | 'mini' | 'bleu' | 'chocolat';
export type Grade = 'extra' | 'A' | 'B';
export type BuildingType = 'coop' | 'nest' | 'feeder' | 'drinker' | 'storage' | 'dustbath' | 'stand' | 'compost' | 'incubator' | 'pond' | 'tree';

export type HenAct =
  | 'idle'
  | 'walk'
  | 'peck'
  | 'scratch'
  | 'preen'
  | 'flap'
  | 'enter'
  | 'exit'
  | 'rest'
  | 'goEat'
  | 'eat'
  | 'goDrink'
  | 'drink'
  | 'goNest'
  | 'lay'
  | 'goBath'
  | 'bathe'
  | 'goCoop'
  | 'sleep'
  | 'wait'
  /** Panique : s'enfuit loin d'un prédateur. */
  | 'flee'
  /** Saisie par un prédateur (position imposée par celui-ci). */
  | 'caught'
  /** Va gratter le compost, puis s'y régale de vers et d'insectes. */
  | 'goCompost'
  | 'worms'
  /** Non clôturée, elle s'éloigne vers la route ou les bois. */
  | 'stray'
  /** Deux coqs se battent : face-à-face, sauts, coups d'ergots (transitoire, non sauvegardé). */
  | 'fight';

export interface Hen {
  id: number;
  name: string;
  breed: BreedId;
  /** Âge en jours de jeu depuis l'arrivée à la ferme. */
  age: number;
  /** 0..100 */
  health: number;
  /** 0..100 — 100 = repue (inverse de la faim). */
  satiety: number;
  /** 0..100 — 100 = bien hydratée (inverse de la soif). */
  hydration: number;
  /** 0..100 */
  wellbeing: number;
  /** Protéines (vers et insectes du compost) 0..100 : bien-être, ponte, qualité des œufs. */
  protein: number;
  /** Progression vers le prochain œuf (0..1+). */
  layProgress: number;
  eggsLaid: number;
  coopId: number;
  sick: boolean;
  dayBought: number;
  // --- comportement (positions en unités monde, 1 = une case) ---
  x: number;
  z: number;
  heading: number;
  act: HenAct;
  actT: number;
  tx: number;
  tz: number;
  targetId: number;
  /** Petit décalage aléatoire autour du point d'accès d'un bâtiment. */
  ox: number;
  oz: number;
  thinkT: number;
  /** Coq : ne pond pas, féconde les œufs des poules. */
  rooster?: boolean;
  /** Jeune né à la ferme : jours restants avant l'âge adulte (poussin puis poulette). */
  young?: number;
  /** Qualités héréditaires (1 à 5 étoiles) : ponte, robustesse, beauté. */
  genes?: Genes;
  /** Coq entièrement noir (rarissime, se revend très cher). */
  black?: boolean;
  /** Coq qui s'est déjà mesuré aux autres coqs (un nouveau venu se bat dès qu'il les croise). */
  ranked?: boolean;
  /** Plumage (variante de la race, voir BREEDS[].skins). */
  skin?: number;
}

/** Qualités héréditaires d'une volaille, de 1 à 5 étoiles. */
export interface Genes {
  /** Ponte : nombre d'œufs. */
  p: number;
  /** Robustesse : résistance aux maladies et aux mauvaises conditions. */
  r: number;
  /** Beauté : note au concours, valeur à la revente. */
  b: number;
}

/** Un trophée remporté au concours agricole. */
export interface Trophy {
  day: number;
  tier: number;
  place: number;
  hen: string;
  breed: BreedId;
}

/** Concours agricole hebdomadaire. */
export interface ShowState {
  /** Catégorie actuelle (0 village … 4 national). */
  tier: number;
  /** Volaille inscrite par le joueur pour le prochain concours (-1 : la meilleure, d'office). */
  entryId: number;
  /** Dernier jour de concours déjà disputé. */
  lastDay: number;
  /** Jour du dernier rappel envoyé. */
  remindDay: number;
  trophies: Trophy[];
}

export type WorkerRole = 'farmhand' | 'seller' | 'caretaker' | 'gardener';
export type WorkerJobKind =
  | 'commuteIn'
  | 'commuteOut'
  | 'collectNest'
  | 'collectGround'
  | 'deposit'
  | 'refillFeeder'
  | 'refillDrinker'
  | 'clean'
  | 'heal'
  | 'water'
  | 'stand'
  | 'wander'
  | 'waitCoop'
  | 'closeCoop'
  | 'openCoop'
  /** Salarié armé : traque un prédateur et lui tire dessus. */
  | 'hunt';

export interface WorkerJob {
  kind: WorkerJobKind;
  targetId: number;
  tx: number;
  tz: number;
  phase: 'walk' | 'work';
  t: number;
}

export interface BasketLot {
  type: EggType;
  grade: Grade;
  freshness: number;
  count: number;
  /** Œufs fécondés : race des poussins à naître. */
  fertile?: BreedId;
  genes?: string;
}

export interface Worker {
  id: number;
  role: WorkerRole;
  name: string;
  look: number;
  x: number;
  z: number;
  heading: number;
  /** Présent sur l'exploitation (sinon : chez lui). */
  onSite: boolean;
  job: WorkerJob | null;
  /** Points de passage restants (x0,z0,x1,z1…). */
  path: number[];
  /** Œufs transportés dans le panier (un lieu à part entière : jamais dupliqués). */
  basket: BasketLot[];
  today: WorkerTally;
  total: WorkerTally;
  hiredDay: number;
  /** Instant du dernier ramassage d'œufs « au passage » (animation). */
  lastPickT?: number;
  /** Instant du dernier coup de fusil (recul, éclair). */
  lastShotT?: number;
}

export interface WorkerTally {
  eggs: number;
  refills: number;
  cleans: number;
  heals: number;
  waterings: number;
  kills: number;
}

// ------------------------------------------------------------- Prédateurs ----
export type PredatorSpecies = 'fox' | 'hawk';
export type PredatorState =
  /** Renard : approche au trot, traque (accroupi), poursuite, prise. */
  | 'approach'
  | 'stalk'
  | 'chase'
  | 'grab'
  /** Renard : se glisse dans un poulailler resté ouvert. */
  | 'raid'
  /** Renard : rôde devant une trappe fermée. */
  | 'prowl'
  /** Renard : creuse sous un grillage simple. */
  | 'dig'
  /** Buse : arrivée, vol circulaire, piqué. */
  | 'arrive'
  | 'circle'
  | 'dive'
  /** Repart avec sa proie, s'enfuit blessé ou renonce. */
  | 'carry'
  | 'flee'
  | 'leave'
  | 'dead';

export interface Predator {
  id: number;
  species: PredatorSpecies;
  x: number;
  z: number;
  /** Altitude (buse). */
  y: number;
  heading: number;
  state: PredatorState;
  /** Minuteur de l'état courant. */
  t: number;
  /** Âge (secondes simulées). */
  age: number;
  hp: number;
  /** Poule visée (ou saisie). */
  targetHen: number;
  /** Poulailler visé (raid, rôde). */
  targetCoop: number;
  /** Proie emportée : race (pour l'affichage). */
  carrying: BreedId | null;
  /** Point de fuite (lisière d'où il est venu). */
  ex: number;
  ez: number;
  /** Vol circulaire de la buse : centre et angle. */
  cx: number;
  cz: number;
  ang: number;
  /** Vitesse courante (animation). */
  spd: number;
  path: number[];
  pathT: number;
  /** Repéré par le personnel armé. */
  spotted: boolean;
  /** Grillage en cours de creusement : arête codée (h ≥ 0, v < 0 : -(index+1)), -1 sinon. */
  digEdge: number;
  digX: number;
  digZ: number;
}

/** Robot ramasseur d'œufs : une machine autonome qui sillonne la ferme. */
export interface Robot {
  id: number;
  x: number;
  z: number;
  heading: number;
  /** Batterie 0..100. */
  battery: number;
  /** Œufs dans le bac du robot. */
  hopper: BasketLot[];
  task: 'idle' | 'egg' | 'nest' | 'unload' | 'dock';
  target: number;
  tx: number;
  tz: number;
  path: number[];
  /** Œufs ramassés depuis l'achat. */
  total: number;
  boughtDay: number;
}

/** Chien de garde. */
export interface GuardDog {
  name: string;
  x: number;
  z: number;
  heading: number;
  act: 'walk' | 'sit' | 'sleep' | 'chase';
  t: number;
  path: number[];
  spd: number;
  boughtDay: number;
}

export interface WorldEgg {
  id: number;
  type: EggType;
  quality: number;
  freshness: number;
  where: 'nest' | 'ground';
  nestId: number;
  x: number;
  z: number;
  /** Instant (temps sim absolu) de ponte — sert aux animations d'apparition. */
  laidAt: number;
  /** Œuf fécondé : race du poussin qui en sortira (couveuse). */
  fertile?: BreedId;
  /** Œuf fécondé : qualités héritées du poussin (« 343 » = ponte, robustesse, beauté). */
  genes?: string;
}

export interface EggLot {
  id: number;
  type: EggType;
  grade: Grade;
  count: number;
  freshness: number;
  day: number;
  /** Lot d'œufs fécondés : race des poussins à naître. */
  fertile?: BreedId;
  genes?: string;
}

/** Œuf en incubation dans une couveuse. */
export interface IncubatingEgg {
  breed: BreedId;
  /** Instant de mise en couveuse (temps sim). */
  t: number;
  /** L'embryon se développe-t-il (décidé à la mise en couveuse) ? */
  ok: boolean;
  /** Qualités héritées (« 343 »). */
  genes?: string;
}

export interface Building {
  id: number;
  type: BuildingType;
  level: number;
  /** Case haut-gauche de l'emprise. */
  x: number;
  z: number;
  /** Grain (rations) pour une mangeoire, eau (litres) pour un abreuvoir. */
  stock: number;
  /** Propreté 0..100 (poulaillers). */
  cleanliness: number;
  /** Poulailler : trappe fermée pour la nuit par le commis. */
  closed: boolean;
  /** Œufs présents dans un pondoir (ids de WorldEgg). */
  eggIds: number[];
  /** Couveuse : œufs fécondés en incubation. */
  hatch?: IncubatingEgg[];
  /** Couveuse : remplissage automatique avec les œufs fécondés du stockage (vrai par défaut). */
  auto?: boolean;
  /** Total investi (construction + améliorations), en centimes — sert au remboursement. */
  invested: number;
  builtAt: number;
}

export type CustomerKind = 'classique' | 'gourmet';
export type CustomerState = 'toStand' | 'queue' | 'shopping' | 'leaving';
export type CustomerMood = 'none' | 'happy' | 'expensive' | 'empty' | 'impatient';

export interface Customer {
  id: number;
  kind: CustomerKind;
  want: number;
  wtp: number;
  state: CustomerState;
  x: number;
  z: number;
  dir: 1 | -1;
  t: number;
  mood: CustomerMood;
  bought: number;
  look: number;
  /** Patience dans la file (secondes simulées) avant de repartir sans rien acheter. */
  patience?: number;
  /** Temps déjà passé à attendre son tour. */
  wait?: number;
  /** Guichet attribué (-1 : attend son tour dans la file). */
  counter?: number;
  /** Moment où il a rejoint la file (ordre d'arrivée). */
  qt?: number;
}

/** Bouton proposé dans une notification (ex. : livrer une commande dont le stock est prêt). */
export interface NotifyAction {
  kind: 'deliverOrder';
  id: number;
  label: string;
}

export interface Order {
  id: number;
  client: string;
  type: EggType;
  qty: number;
  minGrade: Grade;
  unitPrice: number;
  deadlineDay: number;
  status: 'offer' | 'active' | 'done' | 'failed';
  offerUntilDay: number;
  /** Le stock suffit pour livrer (le joueur a été prévenu). */
  ready?: boolean;
}

export interface Contract {
  id: number;
  client: string;
  type: EggType;
  qtyPerDay: number;
  unitPrice: number;
  days: number;
  daysLeft: number;
  status: 'offer' | 'active' | 'done';
  missed: number;
  delivered: number;
  offerUntilDay: number;
  /** Dernier jour déjà livré (avant 17 h, en avance, ou par la livraison automatique). */
  lastDay?: number;
}

export type IncomeCat = 'etal' | 'cooperative' | 'commandes' | 'contrats' | 'primes' | 'reventes' | 'emprunt';
export type ExpenseCat =
  | 'grain'
  | 'eau'
  | 'entretien'
  | 'foncier'
  | 'salaires'
  | 'poules'
  | 'constructions'
  | 'terrain'
  | 'soins'
  | 'litiere'
  | 'penalites'
  | 'agios'
  | 'interets'
  | 'capital';

export interface DayFinance {
  day: number;
  income: Partial<Record<IncomeCat, number>>;
  expense: Partial<Record<ExpenseCat, number>>;
  cashStart: number;
  cashEnd: number;
  /** Dette restante (capital) en fin de journée. */
  debtEnd?: number;
  /** Œufs pondus dans la journée. */
  eggs?: number;
  /** Taux de ponte moyen des pondeuses, relevé chaque heure (somme et nombre de relevés). */
  laySum?: number;
  layN?: number;
}

/** Prêt bancaire : versé tout de suite, remboursé par échéances quotidiennes fixes (à minuit). */
export interface Loan {
  id: number;
  /** Montant emprunté (centimes). */
  principal: number;
  /** Taux annuel (une année de jeu = 28 jours), fixé à la signature. */
  rate: number;
  /** Durée en jours. */
  days: number;
  /** Échéance quotidienne (centimes). */
  daily: number;
  /** Échéances déjà payées. */
  paid: number;
  capitalLeft: number;
  interestLeft: number;
  /** Jour de la signature. */
  day: number;
  /** Échéances suspendues jusqu'à ce jour inclus (pause pour remonter la pente). */
  pausedUntil?: number;
  /** Une pause a déjà été accordée sur ce prêt. */
  paused?: boolean;
}

export interface LogEntry {
  day: number;
  hour: number;
  label: string;
  amount: number;
  cat: IncomeCat | ExpenseCat;
}

export interface Stats {
  eggsLaid: number;
  eggsCollected: number;
  eggsSold: number;
  eggsSpoiled: number;
  eggsLost: number;
  salesRevenue: number;
  totalIncome: number;
  totalExpense: number;
  customersServed: number;
  /** Clients repartis sans acheter à cause de l'attente. */
  customersLost: number;
  ordersDelivered: number;
  ordersFailed: number;
  contractsCompleted: number;
  hensBought: number;
  hensDied: number;
  hensSold: number;
  /** Vieilles poules confiées à une association ou à un particulier. */
  hensRehomed: number;
  coopsCleaned: number;
  feederFills: number;
  /** Poules emportées par un prédateur (comptées à part des décès). */
  hensTaken: number;
  predatorsKilled: number;
  /** Œufs pondus au sol, pourris faute d'avoir été ramassés à temps. */
  eggsRotten: number;
  /** Poules échappées faute de clôture. */
  hensEscaped: number;
  /** Poussins nés à la couveuse. */
  chicksHatched: number;
  roostersBought: number;
  showsEntered: number;
  showsWon: number;
  grainBought: number;
  priceSet: boolean;
  soldByType: Partial<Record<EggType, number>>;
  boughtBreeds: Partial<Record<BreedId, number>>;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  musicVolume: number;
  offline: boolean;
  autoGrain: boolean;
  autoGrainThreshold: number;
  autoGrainSack: string;
  autoWater: boolean;
  /** Le commis commande lui-même l'eau et le grain quand les réserves baissent. */
  staffRestock: boolean;
  /** Seuil (en % de la cuve) sous lequel l'eau est rachetée automatiquement. */
  autoWaterThreshold: number;
  autoWholesale: boolean;
  autoWholesaleThreshold: number;
  labels: boolean;
  /** Renards et buses attaquent de temps en temps. */
  predators: boolean;
  /** Repasser en vitesse normale quand un prédateur surgit. */
  predatorSlowdown: boolean;
}

export interface GameState {
  version: number;
  farmName: string;
  seed: number;
  rng: number;
  nextId: number;
  clock: {
    /** Temps simulé absolu en secondes (jour 1 à 00:00 = 0). */
    t: number;
    speed: number;
    /** Dernier jour dont la clôture quotidienne a été appliquée. */
    lastClosedDay: number;
    /** Dernier jour où les contrats ont été livrés (17h). */
    lastContractDay: number;
    /** Dernière heure de jeu traitée par les tâches horaires (automatisations). */
    lastHourTick: number;
  };
  money: number;
  xp: number;
  reputation: number;
  grain: number;
  /** Litres d'eau dans la cuve. */
  water: number;
  /** Niveaux de la réserve à grain et de la cuve (1..3). */
  grainBin: number;
  waterTank: number;
  /** Consommation des stocks (aujourd'hui et hier) pour estimer l'autonomie. */
  usage: { day: number; grain: number; water: number; lastGrain: number; lastWater: number };
  hens: Hen[];
  buildings: Building[];
  worldEggs: WorldEgg[];
  lots: EggLot[];
  /** Parcelles possédées, clé "col,row". */
  parcels: string[];
  /** Niveau d'herbe 0..1 pour chaque case (W*H). */
  grass: number[];
  prices: Record<EggType, number>;
  market: {
    trend: Record<EggType, number>;
    grainIndex: number;
    palletDay: number;
    pallets: number;
    /** Élan de la tendance de chaque type d'œuf (variation lissée d'un jour à l'autre). */
    vel?: Partial<Record<EggType, number>>;
    /** Cours du marché jour après jour (prix de référence de chaque type, dans l'ordre EGG_ORDER). */
    history?: Array<{ d: number; p: number[] }>;
    /** Clients perdus aujourd'hui à cause de l'attente (jour de référence lostDay). */
    lost?: number;
    lostDay?: number;
  };
  customers: Customer[];
  orders: Order[];
  contracts: Contract[];
  workers: Worker[];
  /**
   * Clôtures sur les lignes de la grille : fenceH[z * W + x] = arête horizontale sur la ligne z
   * (entre les cases (x, z-1) et (x, z)) ; fenceV[z * (W + 1) + x] = arête verticale sur la ligne x.
   * 0 rien, 1 grillage, 2 renforcé, 3 portail, 4 grillage troué.
   */
  fenceH: number[];
  fenceV: number[];
  robots: Robot[];
  dog: GuardDog | null;
  /** Concours agricole : catégorie, inscription, palmarès. */
  show: ShowState;
  /** Prêts en cours. */
  loans: Loan[];
  /** Prédateurs présents (non sauvegardés, comme les clients de passage). */
  predators: Predator[];
  /** Instant de la dernière attaque (espacement des apparitions). */
  lastPredatorT: number;
  finance: {
    days: DayFinance[];
    log: LogEntry[];
  };
  stats: Stats;
  missionIndex: number;
  missionsDone: string[];
  tutorial: { step: number; done: boolean };
  settings: Settings;
  /** Horodatage réel de la dernière sauvegarde (ms). */
  savedAt: number;
  unlockedSeen: string[];
}

export type GameEvent =
  | { kind: 'eggLaid'; eggId: number; x: number; z: number; ground: boolean }
  | { kind: 'eggsCollected'; count: number; x: number; z: number }
  | { kind: 'sale'; amount: number; qty: number; x: number; z: number; channel: IncomeCat }
  | { kind: 'money'; amount: number; x: number; z: number; label?: string }
  | { kind: 'purchase'; amount: number; label: string }
  | { kind: 'build'; buildingId: number }
  | { kind: 'upgrade'; buildingId: number }
  | { kind: 'demolish'; buildingId: number; x: number; z: number }
  | { kind: 'parcel'; key: string }
  | { kind: 'henArrived'; henId: number }
  | { kind: 'hatch'; count: number; x: number; z: number }
  | { kind: 'showResult'; result: ShowResult }
  | { kind: 'incubated'; count: number; x: number; z: number }
  | { kind: 'crow'; x: number; z: number }
  | { kind: 'grownUp'; henId: number }
  | { kind: 'workerArrived'; workerId: number; x: number; z: number }
  | { kind: 'henGone'; henId: number; reason: 'died' | 'sold' | 'escaped' }
  | { kind: 'fence'; placed: number }
  | { kind: 'customerMood'; customerId: number; mood: CustomerMood }
  | { kind: 'levelUp'; level: number }
  | { kind: 'mission'; id: string; title: string }
  | { kind: 'notify'; text: string; tone: 'info' | 'good' | 'warn' | 'bad'; icon?: string; action?: NotifyAction }
  | { kind: 'newDay'; day: number }
  | { kind: 'cluck'; henId: number }
  | { kind: 'predatorSpawn'; id: number; species: PredatorSpecies; x: number; z: number }
  /** Coup de feu : `by` = id du salarié, -1 pour le joueur. */
  | { kind: 'shot'; by: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; hit: boolean }
  | { kind: 'predatorHit'; id: number; species: PredatorSpecies; x: number; y: number; z: number; killed: boolean }
  | { kind: 'henTaken'; henId: number; species: PredatorSpecies; x: number; z: number }
  | { kind: 'henRescued'; henId: number; x: number; z: number }
  | { kind: 'eggRotten'; x: number; z: number }
  | { kind: 'dogBark'; x: number; z: number };

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

/** Résultat d'un concours (affiché dans une fenêtre). */
export interface ShowResult {
  day: number;
  tier: number;
  place: number;
  prize: number;
  henId: number;
  henName: string;
  breed: BreedId;
  score: number;
  /** Tous les concurrents, du premier au dernier. */
  ranking: Array<{ name: string; farm: string; breed: BreedId; score: number; mine: boolean }>;
  promoted: boolean;
  auto: boolean;
}

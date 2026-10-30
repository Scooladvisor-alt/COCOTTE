import type { BreedId, EggType } from '../sim/types';

export interface HenLook {
  body: number;
  breast: number;
  hackle: number;
  cape: number;
  tail: number;
  tail2: number;
  wing: number;
  primaries: number;
  comb: number;
  lobes: number;
  legs: number;
  beak: number;
  combType: 'single' | 'big' | 'pea' | 'walnut';
  rumpless?: boolean;
  tufts?: boolean;
  fluffy?: boolean;
  /** 0 : pattes nues, 1 : légèrement emplumées, 2 : très emplumées. */
  featheredLegs?: 0 | 1 | 2;
  /** Haut de la poitrine (plus sombre que le plastron, dans le prolongement du cou). */
  chest?: number;
  /** Ventre, cuisses et duvet sous la queue. */
  fluff?: number;
  /** Plumes de couverture en relief sur le dos, les épaules et les ailes, bordées de cette teinte claire. */
  scales?: number;
  /** Queue plus relevée (0 : port normal, 1 : presque droite). */
  tailUp?: number;
  /** Peau nue de la face (sinon déduite de la crête), iris, et duvet du poussin (sinon celui de la race). */
  face?: number;
  iris?: number;
  down?: number;
  downBelly?: number;
}

export interface BreedDef {
  id: BreedId;
  name: string;
  description: string;
  /** Prix d'achat (centimes). */
  price: number;
  /** Œufs par jour dans des conditions idéales. */
  eggsPerDay: number;
  egg: EggType;
  /** Multiplicateur de la vitesse à laquelle la poule a faim. */
  appetite: number;
  /** Aptitude à se nourrir en picorant l'herbe. */
  forage: number;
  /** Sensibilité au bien-être (influence sur la ponte et la santé). */
  sensitivity: number;
  /** Bonus de qualité intrinsèque des œufs. */
  qualityBonus: number;
  /** Niveau de ferme requis. */
  reqLevel: number;
  /** Niveau minimum de poulailler requis pour l'héberger. */
  reqCoop: number;
  speed: number;
  /** Apparence */
  colors: { body: number; wing: number; tail: number; comb: number; legs: number; head?: number; neck?: number };
  /** Apparence détaillée du modèle 3D. */
  look: HenLook;
  fluffy?: boolean;
  scale: number;
  trait: string;
  /**
   * Étoiles à l'achat (fourchette min-max, plafonnée à 3) pour ponte, robustesse, beauté :
   * chaque race a ses points forts et ses faiblesses ; les races rares partent de plus haut.
   */
  genes: { p: [number, number]; r: [number, number]; b: [number, number] };
  /**
   * Plumages possibles (tirés au hasard à l'achat ou à l'éclosion, selon leur poids) : toutes les
   * poules d'une race ne se ressemblent pas. Sans cette liste, la race n'a qu'un plumage (look).
   */
  skins?: Array<{ name: string; weight: number; look: HenLook }>;
  /** Niveau exigé même quand les niveaux requis sont désactivés (les oies : niveau 10). */
  strictLevel?: boolean;
}

/**
 * Oie de Toulouse : dos et ailes gris-brun aux plumes bordées de clair, cou gris, poitrine plus
 * pâle, ventre et dessous de queue blancs, bec et pattes orange. (Les champs de crête servent au bec.)
 */
const GOOSE_TOULOUSE: HenLook = {
  body: 0x8a857e,
  breast: 0xa39e97,
  hackle: 0x7b766f,
  cape: 0x6d6862,
  tail: 0x5c5853,
  tail2: 0xd9d5cd,
  wing: 0x75706a,
  primaries: 0x4b4845,
  comb: 0xf09a3c,
  lobes: 0xf09a3c,
  legs: 0xf0863a,
  beak: 0xf0963c,
  combType: 'single',
  fluff: 0xf2efe9,
  scales: 0xcfc9bf,
  iris: 0x2c2420,
};
/** Oie blanche d'Emden : tout blanc, bec et pattes orange vif. */
const GOOSE_EMDEN: HenLook = {
  body: 0xf2f0ea,
  breast: 0xf6f4ef,
  hackle: 0xf4f2ec,
  cape: 0xeceae3,
  tail: 0xe6e3dc,
  tail2: 0xf6f4ef,
  wing: 0xeeece5,
  primaries: 0xdedad2,
  comb: 0xf29a3a,
  lobes: 0xf29a3a,
  legs: 0xf0863a,
  beak: 0xf29a3a,
  combType: 'single',
  fluff: 0xfaf9f6,
  scales: 0xfdfcfa,
  iris: 0x3a5f8a,
};

export const BREEDS: Record<BreedId, BreedDef> = {
  rousse: {
    id: 'rousse',
    name: 'Rousse des prés',
    description: 'Robuste et économique, la poule idéale pour débuter. Chaque poule a son plumage : rousse classique, acajou, dorée… ou Isa Brown.',
    price: 1200,
    eggsPerDay: 3.4,
    egg: 'roux',
    appetite: 1.0,
    forage: 1.0,
    sensitivity: 1.0,
    qualityBonus: 0,
    reqLevel: 1,
    reqCoop: 1,
    speed: 0.85,
    colors: { body: 0xb5602f, wing: 0x8f4523, tail: 0x5a2a16, comb: 0xe0412f, legs: 0xe9b04a, neck: 0xc9763f },
    look: { body: 0xa9542a, breast: 0xbb6a37, hackle: 0xcf8b48, cape: 0xc27a3e, tail: 0x3c2014, tail2: 0xd9c3a0, wing: 0x9a4a22, primaries: 0xd9c3a0, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xe9c46a, beak: 0xe6b54f, combType: 'single' },
    skins: [
      { name: 'Rousse classique', weight: 0.35, look: { body: 0xa9542a, breast: 0xbb6a37, hackle: 0xcf8b48, cape: 0xc27a3e, tail: 0x3c2014, tail2: 0xd9c3a0, wing: 0x9a4a22, primaries: 0xd9c3a0, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xe9c46a, beak: 0xe6b54f, combType: 'single' } },
      { name: 'Rousse acajou', weight: 0.22, look: { body: 0x83371b, breast: 0x8f401f, hackle: 0xa5532a, cape: 0x974822, tail: 0x26130c, tail2: 0x6a3a22, wing: 0x7a3218, primaries: 0x4a2414, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xe2b85a, beak: 0xd9a948, combType: 'single' } },
      { name: 'Rousse dorée', weight: 0.2, look: { body: 0xc27a3c, breast: 0xd08b4b, hackle: 0xe0a65f, cape: 0xd59650, tail: 0x5a3018, tail2: 0xe8d4ae, wing: 0xb46c33, primaries: 0xe6d3ab, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xeccb72, beak: 0xe8bb58, combType: 'single' } },
      {
        name: 'Isa Brown',
        weight: 0.23,
        // d'après photo : tête et cou acajou foncé, dos et ailes dorés aux plumes bordées de clair,
        // ventre chamois, queue relevée beige, petite crête simple, œil ambré, pattes beige pâle
      look: {
        body: 0xa65c29,
        breast: 0x9f5426,
        chest: 0x5e2316,
        hackle: 0x5a2115,
        cape: 0x8a3f1d,
        tail: 0xcd9a5e,
        tail2: 0xe3c28c,
        wing: 0xa35c2a,
        primaries: 0xc8975f,
        comb: 0xd8392a,
        lobes: 0xc8392a,
        legs: 0xe8d6aa,
        beak: 0xc9a46c,
        combType: 'single',
        fluff: 0xcf9d66,
        scales: 0xdba768,
        tailUp: 0.55,
      },
      },
    ],
    scale: 1,
    trait: 'Polyvalente',
    genes: { p: [2, 3], r: [2, 3], b: [1, 2] },
  },
  leghorn: {
    id: 'leghorn',
    name: 'Leghorn blanche',
    description: 'Pondeuse prolifique mais nerveuse : son rendement chute vite si elle est mal installée.',
    price: 2400,
    eggsPerDay: 4.0,
    egg: 'blanc',
    appetite: 1.05,
    forage: 0.85,
    sensitivity: 1.5,
    qualityBonus: 0,
    reqLevel: 1,
    reqCoop: 1,
    speed: 1.0,
    colors: { body: 0xf7f4ee, wing: 0xe8e3d8, tail: 0xdcd6ca, comb: 0xe23a2a, legs: 0xeac24f },
    look: { body: 0xf7f5ef, breast: 0xfaf8f3, hackle: 0xfbf9f4, cape: 0xf5f2ea, tail: 0xf0ece3, tail2: 0xe6e1d6, wing: 0xf2efe7, primaries: 0xe4dfd3, comb: 0xe03a2a, lobes: 0xf3f1ec, legs: 0xf0c946, beak: 0xf2cf5b, combType: 'big' },
    scale: 0.95,
    trait: 'Grosse pondeuse',
    genes: { p: [3, 3], r: [1, 2], b: [1, 2] },
  },
  sussex: {
    id: 'sussex',
    name: 'Sussex herminée',
    description: 'Excellente fourrageuse, très rustique. Gros œufs crème mais bon appétit.',
    price: 3200,
    eggsPerDay: 3.0,
    egg: 'creme',
    appetite: 1.15,
    forage: 1.45,
    sensitivity: 0.7,
    qualityBonus: 0.04,
    reqLevel: 3,
    reqCoop: 1,
    speed: 0.8,
    colors: { body: 0xf3efe6, wing: 0xe5dfd2, tail: 0x26262b, comb: 0xd8392a, legs: 0xf0d9b5, neck: 0x3a3a40 },
    look: { body: 0xf4f1ea, breast: 0xf6f3ec, hackle: 0x34343a, cape: 0xe8e4dc, tail: 0x1e1e22, tail2: 0x2c2c32, wing: 0xefebe3, primaries: 0x2a2a30, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xf2dfc8, beak: 0xe8dcc5, combType: 'single' },
    scale: 1.08,
    trait: 'Fourrageuse',
    genes: { p: [2, 3], r: [3, 3], b: [2, 3] },
  },
  soie: {
    id: 'soie',
    name: 'Poule soie',
    description: 'Peu productive, mais adorée des clients (+réputation) et apaisante pour le poulailler.',
    price: 4000,
    eggsPerDay: 1.5,
    egg: 'mini',
    appetite: 0.75,
    forage: 0.9,
    sensitivity: 0.9,
    qualityBonus: 0.06,
    reqLevel: 4,
    reqCoop: 1,
    speed: 0.7,
    colors: { body: 0xfbf7f0, wing: 0xf4eee4, tail: 0xf0e9dd, comb: 0x6b3b5a, legs: 0x5b5d66, head: 0xfdfaf5 },
    fluffy: true,
    look: { body: 0xfbf8f2, breast: 0xfdfbf7, hackle: 0xfcf9f4, cape: 0xf8f4ec, tail: 0xf6f1e8, tail2: 0xefe9dd, wing: 0xf7f2ea, primaries: 0xf1ebe0, comb: 0x5b2b4a, lobes: 0x5fa8b8, legs: 0x4b4d58, beak: 0x5a5a66, combType: 'walnut', fluffy: true, featheredLegs: 2 },
    scale: 0.85,
    trait: '+ Réputation',
    genes: { p: [1, 1], r: [2, 3], b: [3, 3] },
  },
  araucana: {
    id: 'araucana',
    name: 'Araucana',
    description: 'Pond de rares œufs bleus très recherchés des gourmets. Exige un poulailler confortable.',
    price: 6000,
    eggsPerDay: 2.5,
    egg: 'bleu',
    appetite: 1.0,
    forage: 1.1,
    sensitivity: 1.1,
    qualityBonus: 0.02,
    reqLevel: 5,
    reqCoop: 2,
    speed: 0.9,
    colors: { body: 0x8a8f99, wing: 0x6c717c, tail: 0x3d4049, comb: 0xd8392a, legs: 0x8d9a6a, neck: 0xc9a25a },
    look: { body: 0x9ea3b0, breast: 0xadb1bc, hackle: 0xb9bcc6, cape: 0xa7abb6, tail: 0x8f94a1, tail2: 0x8f94a1, wing: 0x8f94a1, primaries: 0x767b88, comb: 0xd8392a, lobes: 0xc8392a, legs: 0x7d8a5d, beak: 0x9a9a8a, combType: 'pea', rumpless: true, tufts: true },
    scale: 0.95,
    trait: 'Œufs bleus',
    genes: { p: [2, 3], r: [2, 3], b: [2, 3] },
  },
  marans: {
    id: 'marans',
    name: 'Marans noire cuivrée',
    description: 'Œufs chocolat de luxe, les plus chers du marché. Exige un poulailler isolé.',
    price: 9000,
    eggsPerDay: 2.3,
    egg: 'chocolat',
    appetite: 1.1,
    forage: 1.0,
    sensitivity: 1.2,
    qualityBonus: 0.05,
    reqLevel: 6,
    reqCoop: 3,
    speed: 0.85,
    colors: { body: 0x2a2a30, wing: 0x1f1f25, tail: 0x16161a, comb: 0xd8392a, legs: 0xd4c38f, neck: 0xb8742f },
    look: { body: 0x1d1f24, breast: 0x26282e, hackle: 0xb56a2c, cape: 0x9a5626, tail: 0x14161a, tail2: 0x1d2a26, wing: 0x1d1f24, primaries: 0x15171b, comb: 0xd8392a, lobes: 0xc8392a, legs: 0xd8cba4, beak: 0x8a7a5a, combType: 'single', featheredLegs: 1 },
    scale: 1.05,
    trait: 'Œufs chocolat',
    genes: { p: [2, 3], r: [2, 3], b: [3, 3] },
  },
  oie: {
    id: 'oie',
    name: 'Oie',
    description: 'Grande oie au bec et aux pattes orange : son plumage est tiré au hasard à l’achat, grise au ventre blanc (Oie de Toulouse) ou toute blanche (Oie d’Emden). Elle vit dans son abri à oies, broute beaucoup près de chez elle et pond de gros œufs d’oie très recherchés.',
    price: 9000,
    eggsPerDay: 1.3,
    egg: 'oie',
    appetite: 1.5,
    forage: 1.8,
    sensitivity: 0.8,
    qualityBonus: 0.06,
    reqLevel: 10,
    strictLevel: true,
    reqCoop: 1,
    speed: 0.75,
    colors: { body: 0x8c8780, wing: 0x6f6a65, tail: 0x5e5a56, comb: 0xf08a3a, legs: 0xf08a3a, neck: 0x7e7973 },
    look: GOOSE_TOULOUSE,
    skins: [
      { name: 'Grise de Toulouse', weight: 0.65, look: GOOSE_TOULOUSE },
      { name: 'Blanche d’Emden', weight: 0.35, look: GOOSE_EMDEN },
    ],
    scale: 1.55,
    trait: 'Grise ou blanche',
    genes: { p: [2, 3], r: [3, 3], b: [2, 3] },
  },
};

/** Les oies : une autre espèce (elles ne se croisent pas avec les poules). */
export const isGoose = (b: BreedId) => b === 'oie';

export const BREED_ORDER: BreedId[] = ['rousse', 'leghorn', 'sussex', 'soie', 'araucana', 'marans', 'oie'];

/** Nom du coq de chaque race (accordé au masculin). */
export const ROOSTER_TITLES: Record<BreedId, string> = {
  rousse: 'Coq roux des prés',
  leghorn: 'Coq Leghorn blanc',
  sussex: 'Coq Sussex herminé',
  soie: 'Coq soie',
  araucana: 'Coq Araucana',
  marans: 'Coq Marans noir cuivré',
  oie: 'Jars',
};

/** Noms des oies et des jars. */
export const GOOSE_NAMES = ['Gertrude', 'Augustine', 'Pétronille', 'Hortense', 'Philomène', 'Berthe', 'Mélisande', 'Clotilde', 'Ernestine', 'Léontine', 'Séraphine', 'Hermine', 'Bérénice', 'Joséphine', 'Eulalie', 'Adélaïde'];
export const GANDER_NAMES = ['Barnabé', 'Anatole', 'Isidore', 'Hippolyte', 'Onésime', 'Fulbert', 'Aristide', 'Bertrand', 'Casimir', 'Gédéon'];

/** Noms des coqs (achetés ou nés à la ferme). */
export const ROOSTER_NAMES = ['Gaston', 'Marcel', 'Hector', 'Fernand', 'Léon', 'Firmin', 'Albert', 'Achille', 'Barnabé', 'Célestin', 'Désiré', 'Eugène', 'Félix', 'Gustave', 'Honoré', 'Jules', 'Lucien', 'Maurice', 'Narcisse', 'Octave', 'Prosper', 'Raoul', 'Sosthène', 'Théodule', 'Victor', 'Zéphirin'];

export const HEN_NAMES = [
  'Cocotte', 'Paulette', 'Ginette', 'Roussette', 'Blanchette', 'Poupoule', 'Margot', 'Coco', 'Pâquerette',
  'Noisette', 'Caramel', 'Praline', 'Plume', 'Duvet', 'Mimosa', 'Rosalie', 'Capucine', 'Clémentine',
  'Suzette', 'Germaine', 'Huguette', 'Josette', 'Odette', 'Pierrette', 'Yvette', 'Lulu', 'Zaza', 'Fifi',
  'Nénette', 'Bichette', 'Cannelle', 'Vanille', 'Biscotte', 'Tartine', 'Brioche', 'Chouquette',
  'Madeleine', 'Pépite', 'Bulle', 'Perle', 'Nougat', 'Câline', 'Fleurette', 'Poulette', 'Gaufrette',
  'Myrtille', 'Framboise', 'Cerise', 'Violette', 'Marguerite', 'Simone', 'Lucette', 'Raymonde', 'Bernadette',
  'Colette', 'Jacqueline', 'Mirabelle', 'Reinette', 'Églantine', 'Bergamote', 'Sardine', 'Patate',
  'Cacahuète', 'Pistache', 'Réglisse', 'Guimauve', 'Meringue', 'Fanfreluche', 'Frimousse', 'Gribouille',
];

/** Plumage spécial : le coq entièrement noir (quelle que soit sa race). */
export const BLACK_SKIN = 99;
/**
 * Tout noir, comme l'Ayam Cemani : plumes noires à reflets verts, crête et barbillons noir violacé,
 * peau, bec, pattes et yeux noirs. Les formes de la race (huppe, touffes, pattes emplumées…) restent.
 */
const BLACK_COLORS = {
  body: 0x121316,
  breast: 0x15161a,
  hackle: 0x182320,
  cape: 0x161b1d,
  tail: 0x0e0f11,
  tail2: 0x121718,
  wing: 0x131418,
  primaries: 0x0d0e11,
  comb: 0x2b2030,
  lobes: 0x221c26,
  legs: 0x1c1b20,
  beak: 0x232228,
  face: 0x211b24,
  iris: 0x150f0c,
  down: 0x1b1a1e,
  downBelly: 0x2a282e,
};

/** Plumage spécial : la poule aux plumes d'or (quelle que soit sa race). */
export const GOLD_SKIN = 98;
/** Plumes d'or brillantes, plus claires au camail et au poitrail ; crête et barbillons bien rouges. */
const GOLD_COLORS = {
  body: 0xe2ad22,
  breast: 0xf0c443,
  hackle: 0xf7d867,
  cape: 0xe9b92f,
  tail: 0xc8901a,
  tail2: 0xe0a92a,
  wing: 0xd9a024,
  primaries: 0xb78216,
  legs: 0xe7b84a,
  beak: 0xedc75e,
  down: 0xf4d56a,
  downBelly: 0xf8e394,
};

/** Plumage d'une volaille (variante tirée à l'achat ; 0 = plumage de base de la race). */
export function skinLook(breed: BreedId, skin = 0): HenLook {
  const b = BREEDS[breed];
  if (skin === BLACK_SKIN) return { ...b.look, ...BLACK_COLORS, scales: undefined, chest: undefined, fluff: undefined };
  if (skin === GOLD_SKIN) return { ...b.look, ...GOLD_COLORS, scales: undefined, chest: undefined };
  return b.skins?.[skin]?.look ?? b.look;
}
/** Nom du plumage, s'il y en a plusieurs pour la race. */
export function skinName(breed: BreedId, skin = 0): string | null {
  return BREEDS[breed].skins?.[skin]?.name ?? null;
}
/** Tire un plumage au hasard selon les poids (r dans [0, 1[). */
export function pickSkin(breed: BreedId, r: number): number {
  const skins = BREEDS[breed].skins;
  if (!skins) return 0;
  const total = skins.reduce((a, k) => a + k.weight, 0);
  let x = r * total;
  for (let i = 0; i < skins.length; i++) {
    x -= skins[i].weight;
    if (x < 0) return i;
  }
  return skins.length - 1;
}

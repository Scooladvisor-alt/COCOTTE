// Rendu de la ferme : synchronise l'état de simulation avec la scène three.js.
import * as THREE from 'three';
import { BIRD_ORDERS, inTruckBay, FRESHNESS, GRID_H, GRID_W, GRID_Z0, GRID_Z1, NEEDS, TIME, WORLD, clamp, smoothstep } from '../config/balance';
import { hatchWanted } from '../sim/petshop';
import { COOP_SCALE, PET_POS, penGate, STAND_POS, petLayout, sizeOf, standLayout, HALL_ALLEY, HALL_COURT, HALL_DOOR, HALL_FRONT } from '../config/buildings';
import { nurseryPlan, incubatorSeat } from '../sim/nursery';
import { nurseryGateOpen } from '../sim/hens';
import { feedPose, type FeedPose } from '../sim/feeding';
import { vaultOf } from '../sim/vault';
import { cellIndex, cellX, cellZ, coopDoorCells, currentHour, inGrid, isShelter, parcelCenter, parcelCoords, parcelKeyOfCell, rt, toLocal } from '../sim/core';
import { lvl } from '../sim/queries';
import { rtHen } from '../sim/hens';
import { simAlpha } from '../sim/simulation';
import type { BreedId, Building, BuildingType, GameState, Hen, Predator } from '../sim/types';
import { BLACK_SKIN, BREEDS, GOLD_SKIN, LEGEND_SKIN, isGoose } from '../config/breeds';
import { ROLES, femName } from '../config/staff';
import { C, GLOW, GRASS_MAT, GRASS_WIND, SNOW_UNIFORM, box, cyl, merge, mesh } from './geo';
import { Particles, Shots } from './fx';
import { createPredatorView, preyModel, type PredatorView } from './predatorModels';
import { Highlight, haloTexture } from './highlight';
import { FenceLayer } from './fences';
import { buildVillage, type Village } from './village';
import { buildStreet, type Street } from './street';
import { buildWildlife, type Wildlife } from './wildlife';
import { buildDeliveryTruck, type DeliveryTruck } from './delivery';
import { nearTruckRoad } from './truckRoad';
import { ringTrees, wildPlants } from '../sim/wild';
import { Droppings } from './droppings';
import { createRobotView, type RobotView } from './robotModel';
import { applyDogPose, createDogView, dogPose, type DogView } from './dogModel';
import { HOUSE_DOG, kennelPoint } from '../sim/dog';
import { growth, growthStage, hatchesGeese, isIncubator } from '../sim/breeding';
import { seasonBlend, snowCover, weatherOf } from '../sim/seasons';
import { Snowfall } from './snowfall';
import { FallingLeaves } from './leaves';
import { dockOf } from '../sim/robots';
import { sound } from '../audio/sound';
import { buildCountryside } from './countryside';
import { townHall, type TownHall } from './farmBuildings';
import { buildDecor, inDecorZone, type Decor } from './decor';
import { SHADOW_RADIUS, contactShadows, plant, setNatureSeason, setVegetationQuality, setVegetationZoom, speciesGeometry, type Plant, type Species } from './nature';
import { LabelLayer } from './labels';
import {
  EGG_MAT,
  GOLD_EGG_MAT,
  PHOENIX_EGG_MAT,
  EGG_ROT_MAT,
  EGG_STALE_MAT,
  bench,
  buildingModel,
  createHenView,
  HenBatch,
  HenFarBatch,
  henGeometryFar,
  henGeometryMid,
  LANTERN_GLOW,
  GOLD_HEN_MAT,
  LEGEND_HEN_MAT,
  LEGEND_TIME,
  HEN_RIM,
  HEN_PIVOT,
  ADULT_STAGE,
  henGeometry,
  type HenKind,
  cartonBox,
  cartonHead,
  createPerson,
  eggGeometry,
  flowerGeometry,
  forSaleSign,
  hayBale,
  mailbox,
  tractor,
  grassPatchGeometry,
  type BuildingView,
  type HenView,
  createWorkerView,
  type WorkerView,
  type PersonView,
  wildPlantHit,
} from './models';

export type PickResult =
  | { kind: 'predator'; id: number }
  | { kind: 'robot'; id: number }
  | { kind: 'dog' }
  | { kind: 'hen'; id: number }
  | { kind: 'worker'; id: number }
  | { kind: 'egg'; id: number }
  | { kind: 'building'; id: number }
  | { kind: 'petbird'; id: number }
  | { kind: 'petplot' }
  | { kind: 'parcel'; key: string; x: number; z: number }
  | { kind: 'ground'; x: number; z: number };

interface HenState extends HenView {
  /** Dernière image où elle existait encore dans la simulation. */
  stamp: number;
  drawnFar: boolean;
  /** Elle partait dans le camion du revendeur. */
  ship: boolean;
  breed: BreedId;
  /** Lot d'instances : race (poule), « race:rooster » (coq, coquelet) ou « chick » (poussin). */
  key: string;
  walk: number;
  vis: number;
  spawn: number;
  yawT: number;
  yaw: number;
  tilt: number;
  y: number;
  /** Temps avant le prochain clignement (s). */
  blinkT: number;
}

interface BState extends BuildingView {
  id: number;
  type: BuildingType;
  level: number;
  bounce: number;
}

const ELEV = THREE.MathUtils.degToRad(40);
const AZIM = THREE.MathUtils.degToRad(45);
const CAM_DIR = new THREE.Vector3(Math.sin(AZIM) * Math.cos(ELEV), Math.sin(ELEV), Math.cos(AZIM) * Math.cos(ELEV));

const GRASS_TOP = 0.1;
/** Au-delà de tant d'oiseaux à l'écran, on passe au modèle suivant ; d'un seul tenant vus de très haut. */
const HEN_FULL_MAX = 240;
const HEN_MID_MAX = 1400;
const HEN_FAR_ZOOM = 0.42;
const WHITE = new THREE.Color(1, 1, 1);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0x18240f, transparent: true, opacity: 0.26, depthWrite: false });
const colLush = new THREE.Color(0x67a93f);
const colDry = new THREE.Color(0xa7ae5f);
const colDirt = new THREE.Color(0xc8ab7a);
// prairie sauvage des parcelles à vendre : un pré naturel, un ton plus doux que l'herbe de la ferme
const colWild = new THREE.Color(0x8fbd5c);
/** Brins d'herbe broutés : ils jaunissent. */
const DRY_BLADE = new THREE.Color(0xd8c46a);
const HOVER = new THREE.Color(0xbfd1ff);
const tuftC = new THREE.Color();
const colWild2 = new THREE.Color(0x88b656);
/** Teinte de la nature selon la saison : printemps (rien), été (herbe jaunie), automne (dorée), hiver (givre). */
const SEASON_LOOK = [
  { tint: new THREE.Color(0x9fcd62), amt: 0, flowers: 1.6, tufts: 1 },
  { tint: new THREE.Color(0xd8cc72), amt: 0.3, flowers: 0.7, tufts: 0.9 },
  { tint: new THREE.Color(0xcf9a4c), amt: 0.34, flowers: 0.12, tufts: 0.85 },
  { tint: new THREE.Color(0xc9d3c6), amt: 0.22, flowers: 0, tufts: 0.7 },
];
// sol de la campagne : un pré (et non plus un fond crème), pour que le paysage n’ait pas de bord
const GROUND_BASE = new THREE.Color(0x93bf5f);
/** Neige au sol : blanc à peine bleuté. */
const SNOW = new THREE.Color(0xf7f9fc);
const seasonTint = new THREE.Color();
const tmpC = new THREE.Color();
const tmpO = new THREE.Object3D();
const tmpV = new THREE.Vector3();
/**
 * Lot d'instances d'un oiseau : race, sexe et stade de croissance (le poussin change de modèle
 * par petites étapes : duvet, premières plumes, jeune emplumé, crête et queue qui poussent…).
 */
function henKey(h: Hen) {
  const st = growthStage(h);
  const base = st >= ADULT_STAGE ? (h.rooster ? `${h.breed}:rooster` : h.breed) : `${h.breed}:${h.rooster ? 'rooster' : 'hen'}:${st}`;
  // plumage : un lot d'instances par variante (les rousses ne se ressemblent pas toutes)
  const skin = h.legendary ? LEGEND_SKIN : h.golden ? GOLD_SKIN : h.black ? BLACK_SKIN : h.skin;
  return skin ? `${base}#${skin}` : base;
}
/**
 * Passage par la trappe d'un poulailler (selon son niveau) : profondeur du mur de façade, hauteur
 * du seuil et pied de la rampe, en coordonnées locales (z depuis le bord arrière du bâtiment).
 */
const COOP_DOORS: Record<number, { door: number; sill: number; foot: number }> = Object.fromEntries(
  Object.entries({
    1: { door: 1.55, sill: 0.32, foot: 2.09 },
    2: { door: 1.65, sill: 0.22, foot: 2.11 },
    3: { door: 1.72, sill: 0.1, foot: 2.12 },
    4: { door: 1.78, sill: 0.09, foot: 2.17 },
    5: { door: 2.2, sill: 0.12, foot: 2.62 },
    6: { door: 2.66, sill: 0.1, foot: 3.1 },
    // modèles dessinés à l'échelle 1, agrandis COOP_SCALE fois
  }).map(([k, d]) => [k, { door: d.door * COOP_SCALE, sill: d.sill * COOP_SCALE, foot: d.foot * COOP_SCALE }]),
);
/**
 * Inclinaison du corps et du cou pour atteindre la nourriture (voir sim/feeding.ts) : à hauteur
 * de poitrine (auge, abreuvoir en long) ou au ras du sol (assiettes, coupelles, mare).
 */
const FEED_POSES: Record<FeedPose, { body: number; head: number }> = { mid: { body: 0.3, head: 1.25 }, low: { body: 0.45, head: 1.45 } };
/** Abris à oies (échelle 1) : porte de plain-pied, juste un petit seuil. */
const GOOSE_DOORS: Record<number, { door: number; sill: number; foot: number }> = {
  1: { door: 2.45, sill: 0.03, foot: 2.75 },
  2: { door: 2.45, sill: 0.03, foot: 2.75 },
  3: { door: 3.45, sill: 0.03, foot: 3.75 },
};
/**
 * Décalage du coin du modèle pivoté de rot quarts de tour (rotation autour de son coin
 * nord-ouest) pour qu'il retombe sur son emprise au sol.
 */
function turnOffset(type: BuildingType, level: number, rot: number): [number, number] {
  const { w, d } = sizeOf(type, level);
  const q = ((rot % 4) + 4) % 4;
  return q === 1 ? [0, w] : q === 2 ? [w, d] : q === 3 ? [d, 0] : [0, 0];
}
/** Hauteur de la poule sur la rampe, pente, et si elle est déjà entièrement à l'intérieur. */
function coopPassage(type: BuildingType, level: number, lz: number) {
  let d = type === 'goosehouse' ? GOOSE_DOORS[level] ?? GOOSE_DOORS[1] : COOP_DOORS[level] ?? COOP_DOORS[1];
  // la trappe de la poussinière donne sur le parc : petite rampe, puis le poussin passe le mur
  if (type === 'nursery') {
    const z1 = nurseryPlan(level).house.z1;
    d = { door: z1, sill: 0.07, foot: z1 + 0.32 };
  }
  if (lz >= d.foot) return { y: 0, slope: 0, inside: false };
  if (lz >= d.door) {
    const t = (d.foot - lz) / (d.foot - d.door);
    return { y: d.sill * t, slope: Math.atan2(d.sill, d.foot - d.door), inside: false };
  }
  // au seuil puis sur le plancher : cachée dès que la queue a passé le mur
  return { y: d.sill, slope: 0, inside: lz < d.door - 0.32 };
}

/** Taille : le jeune grandit en continu, jour après jour (le coq finit plus grand). */
function growthScale(h: Hen) {
  const g = growth(h);
  const adult = h.rooster ? 1 + 0.17 * g : 1;
  return (0.42 + 0.58 * g) * adult;
}
/** Le jeune a une grosse tête par rapport au corps : elle s'affine en grandissant. */
function headScale(h: Hen) {
  if (!h.young || growthStage(h) < 3) return 1;
  return 1 + 0.32 * clamp(1 - (growth(h) - 0.36) / 0.64, 0, 1);
}
const sweepA = new THREE.Vector3();
const sweepB = new THREE.Vector3();
const sweepC = new THREE.Vector3();
const sweepD = new THREE.Vector3();
const sweepE = new THREE.Vector3();
const sweepF = new THREE.Vector3();
const sweepG = new THREE.Vector3();
const sweepH = new THREE.Vector3();
const sweepQ = new THREE.Quaternion();
const sweepM = new THREE.Matrix4();
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GRASS_TOP);

/** Lueur dorée au sol (dégradé de la lanterne, teinté d'or, en mélange additif). */
const LEGEND_GLOW = new THREE.MeshBasicMaterial({ map: LANTERN_GLOW.map, color: 0xff7ab8, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
const GOLD_GLOW = new THREE.MeshBasicMaterial({ map: LANTERN_GLOW.map, color: 0xffc94a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Finesse de l'image : sur un téléphone (petit écran très dense), deux pixels par point, sans quoi tout
 * paraît flou ; sur un grand écran, 1,5 suffit et ménage la carte graphique.
 */
function fullRatio() {
  const dpr = window.devicePixelRatio || 1;
  const small = Math.min(window.screen.width, window.screen.height) < 600;
  return Math.min(dpr, small ? 2 : 1.5);
}

export class FarmRenderer {
  private hall: TownHall | null = null;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  target = new THREE.Vector3(15, 0, 25);
  zoom = 1.35;
  viewHeight = 22;
  labels: LabelLayer;
  particles: Particles;
  shots: Shots;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  /** Sol du terrain : un sommet à chaque coin de case, couleurs fondues d'une case à l'autre. */
  private terrain!: THREE.Mesh;
  private cellCol = new Float32Array(GRID_W * GRID_H * 3);
  /** Prairie : un tapis de brins par case, regroupés par parcelle (seules les parcelles à l'écran sont dessinées). */
  private grassChunks = new Map<string, { lawn: THREE.InstancedMesh; wild: THREE.InstancedMesh; nl: number; nw: number }>();
  private lawnGeo = [grassPatchGeometry(false, 1, true), grassPatchGeometry(false, 1, false)];
  private wildGeo = [grassPatchGeometry(true, 2, true), grassPatchGeometry(true, 2, false)];
  /** Densité de la prairie : pleine de près, allégée quand on dézoome (les brins y sont minuscules). */
  private grassDense = true;
  private flowers!: THREE.InstancedMesh;
  private fenceGroup = new THREE.Group();
  private signGroup = new THREE.Group();
  private batches = new Map<string, HenBatch>();
  private farBatches = new Map<string, HenFarBatch>();
  private henStamp = 0;
  /** Zoom à partir duquel l'herbe est dessinée brin par brin. */
  private grassMinZoom = 0.85;
  private grassHover = '';
  private henOnScreen = 0;
  private henLod = 0;
  /** Modèles préparés à l'avance, un par image, pour ne jamais figer le jeu quand on zoome. */
  private henWarm = new Set<string>();
  private henWarmQueue: string[] = [];
  private bG = new THREE.Group();
  private eggsG = new THREE.Group();
  private peopleG = new THREE.Group();
  private hens = new Map<number, HenState>();
  private droppings: Droppings;
  private weather: Snowfall;
  private leaves: FallingLeaves;
  private groundMat = new THREE.MeshLambertMaterial({ color: 0xf0e7d5 });
  private buildings = new Map<number, BState>();
  private eggs = new Map<number, THREE.Mesh>();
  private people = new Map<number, PersonView & { px: number; pz: number; phase: number; carton?: THREE.Object3D }>();
  /** Les volailles dans les parcs de la vente de poules : une copie pour le rendu, qui vit sa vie de poule. */
  private petBirds = new Map<number, { hen: Hen; view: HenState; tx: number; tz: number; wait: number; k: number }>();
  /** Les volailles qui marchent entre un camion et la ferme. */
  private ghosts = new Map<number, { hen: Hen; view: HenState; fx: number; fz: number }>();
  /** Ombres toutes simples sous les oiseaux vus de loin. */
  private blobs = new HenFarBatch(new THREE.CircleGeometry(0.2, 8).rotateX(-Math.PI / 2), BLOB_MAT);
  private petSeller: ReturnType<typeof createWorkerView> | null = null;
  private staffG = new THREE.Group();
  private staff = new Map<number, WorkerView & { walk: number; role: string; sweepT: number }>();
  private predG = new THREE.Group();
  private preds = new Map<number, PredatorView & { alive: boolean }>();
  private shakeT = 0;
  fences: FenceLayer;
  private robotsG = new THREE.Group();
  private robots = new Map<number, RobotView>();
  /** Halo doré sous chaque poule aux œufs d'or. */
  private goldGlows = new Map<number, THREE.Mesh>();
  /** Vitrine de l'œuf d'or devant l'étal (créée à la première occasion). */
  private goldShowcase: THREE.Group | null = null;
  selectedRobot = -1;
  selectedDog = false;
  private dogView: DogView | null = null;
  private fenceVersion = -1;
  private layoutKey = '';
  private wildKey = 0;
  private grassTimer = 0;
  private selRing: THREE.Mesh;
  private selBox: THREE.LineSegments;
  private ghost: THREE.Group | null = null;
  private decor!: Decor;
  private village!: Village;
  private street!: Street;
  private wildlife!: Wildlife;
  private truck!: DeliveryTruck;
  /** Annonce d'un passage d'animaux sauvages (branchée par le jeu sur ses notifications). */
  onWildlife: ((text: string) => void) | null = null;
  private ghostKey = '';
  private ghostTiles: THREE.Mesh;
  private time = 0;
  private width = 1;
  private height = 1;
  private bgDay = new THREE.Color(0xf1e9da);
  private bgNight = new THREE.Color(0xc5cad8);
  selectedHen = -1;
  selectedPetBird = -1;
  selectedBuilding = -1;
  selectedWorker = -1;
  hoverParcel = '';
  private highlight = new Highlight();
  private halo: THREE.Mesh;
  private selTint = new THREE.Color();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(fullRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'farm-canvas';

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
    this.scene.background = this.bgDay.clone();

    this.hemi = new THREE.HemisphereLight(0xfff6e8, 0xc6cfa0, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 26;
    sc.bottom = -26;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.labels = new LabelLayer(container);
    this.particles = new Particles(this.scene);
    this.shots = new Shots(this.scene);
    this.fences = new FenceLayer(this.scene);
    this.scene.add(this.robotsG);

    this.buildStatic();
    this.decor = buildDecor(this.scene);
    // la campagne alentour, jusqu'à perte de vue : plus aucun bord vide
    buildCountryside(this.scene);
    this.village = buildVillage(this.scene);
    this.droppings = new Droppings(this.scene, GRASS_TOP + 0.002);
    this.weather = new Snowfall(this.scene);
    this.leaves = new FallingLeaves(this.scene);
    this.scene.add(this.wildGroup);
    this.scene.add(this.fenceGroup, this.signGroup, this.bG, this.eggsG, this.peopleG, this.staffG, this.predG);

    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.selRing.renderOrder = 2;
    // halo lumineux posé au sol sous l'élément sélectionné
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    haloGeo.rotateX(-Math.PI / 2);
    this.halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ map: haloTexture(), color: 0xfff8e6, transparent: true, opacity: 0.6, depthWrite: false }));
    this.halo.renderOrder = 1;
    this.halo.visible = false;
    this.scene.add(this.halo);
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.blobs.mesh.renderOrder = 1;
    this.scene.add(this.blobs.mesh);
    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.05, 1)), new THREE.LineBasicMaterial({ color: C.blue }));
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    const tileGeo = new THREE.PlaneGeometry(1, 1);
    tileGeo.rotateX(-Math.PI / 2);
    this.ghostTiles = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghostTiles.visible = false;
    this.scene.add(this.ghostTiles);

    this.resize();
    // téléphones : on part directement d'un cran au-dessous
  }

  // --------------------------------------------------------- Décor fixe ----
  private buildStatic() {
    // sol crème infini
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID_W / 2, -0.01, (GRID_Z0 + GRID_Z1) / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // la place de l'étal, le trottoir, la route et sa circulation (voir street.ts)
    // (autour des parcelles, c'est le sol d'un seul tenant de la campagne : voir countryside.ts)
    this.street = buildStreet(this.scene);
    this.truck = buildDeliveryTruck(this.street, this.scene);
    this.wildlife = buildWildlife(this.scene, (text) => this.onWildlife?.(text));
    // allée de la maison jusqu'au trottoir, chemin de ferme le long de la clôture jusqu'au portail
    const statics: THREE.BufferGeometry[] = [];
    statics.push(box(HALL_COURT.x1 - HALL_COURT.x0, 0.04, HALL_COURT.z1 - HALL_COURT.z0, 0xe7dcc6, [(HALL_COURT.x0 + HALL_COURT.x1) / 2, 0.025, (HALL_COURT.z0 + HALL_COURT.z1) / 2]));
    const walkN = WORLD.WALK_Z - 0.6;
    statics.push(box(1.0, 0.05, walkN - 28.35, 0xe6d7b8, [HALL_ALLEY, 0.03, (walkN + 28.35) / 2]));
    statics.push(box(11.2 + 5.5, 0.05, 0.8, 0xe6d7b8, [(11.2 - 5.5) / 2, 0.03, GRID_Z1 + 1.4]));
    const st = mesh(merge(statics), false, true);
    this.scene.add(st);

    // l'hôtel de ville, où logent les salariés : sa porte donne droit sur l'allée
    this.hall = townHall();
    this.hall.group.position.set(HALL_DOOR[0], 0, HALL_FRONT);
    this.scene.add(this.hall.group);
    const mb = mesh(mailbox());
    mb.position.set(-4.9, 0, walkN - 0.3);
    this.scene.add(mb);
    // un banc face à la mare
    const b = mesh(bench());
    b.position.set(-15.5, 0, 7.6);
    b.rotation.y = Math.PI / 2;
    this.scene.add(b);
    const tr = mesh(tractor());
    tr.position.set(-1.3, 0, 16.6);
    tr.rotation.y = 0.5;
    this.scene.add(tr);
    for (const [x, z, r] of [
      [-2.5, 19.4, 0.2],
      [-1.8, 18.3, 1.4],
      [-3.4, 18.6, 0.8],
    ]) {
      const h = mesh(hayBale());
      h.position.set(x, 0, z);
      h.rotation.y = r;
      this.scene.add(h);
    }

    // arbres autour du domaine
    const treeSpots = ringTrees();
    const ringSpecies: Species[] = ['oak', 'lime', 'birch', 'pine'];
    const ring: Plant[][] = [[], [], [], []];
    const contact: Array<[number, number, number]> = [];
    treeSpots
      .filter(([x, z]) => !inDecorZone(x, z) && !nearTruckRoad(x, z, 2.6))
      .forEach(([x, z], i) => {
        const v = Math.floor(hash(i * 7.3) * 4) % 4;
        const sc = 0.92 + hash(x + z * 1.7) * 0.42;
        ring[v].push([x, z, hash(x * 3.1 + z) * 6, sc]);
        contact.push([x, z, SHADOW_RADIUS[ringSpecies[v]] * sc]);
      });
    ring.forEach((items, v) => plant(this.scene, speciesGeometry(ringSpecies[v]), speciesGeometry(ringSpecies[v], true), items, { cast: true, spread: 0.11 }));
    const hedges: Plant[] = [];
    for (let i = 0; i < 26; i++) {
      const side = i % 3;
      const x = side === 0 ? -1.6 - hash(i) : side === 1 ? GRID_W + 1.3 + hash(i) : hash(i * 2) * (GRID_W + 10) - 8;
      const z = side === 2 ? (i % 2 ? GRID_Z0 - 1.6 : WORLD.ROAD_Z + WORLD.ROAD_HALF + 2.6) - hash(i) * 0.5 : GRID_Z0 + hash(i * 3) * GRID_H;
      // pas dans la cour de la mairie ni sur le chemin qui longe la clôture
      if ((x < 0 && z > 16 && z < 33) || nearTruckRoad(x, z, 2)) continue;
      const sc = 0.8 + hash(i * 9) * 0.6;
      hedges.push([x, z, hash(i * 5) * 6, sc]);
      contact.push([x, z, SHADOW_RADIUS.bush * sc]);
    }
    plant(this.scene, speciesGeometry('bush'), speciesGeometry('bush', true), hedges, { cast: true, spread: 0.12 });
    this.scene.add(contactShadows(contact));

    // terrain : grille de sommets (coins des cases), hauteur selon le terrain possédé
    const VW = GRID_W + 1;
    const VH = GRID_H + 1;
    const tpos = new Float32Array(VW * VH * 3);
    for (let j = 0; j < VH; j++)
      for (let i = 0; i < VW; i++) {
        const k = (j * VW + i) * 3;
        tpos[k] = i;
        tpos[k + 1] = 0.045;
        tpos[k + 2] = GRID_Z0 + j;
      }
    const idx: number[] = [];
    for (let j = 0; j < GRID_H; j++)
      for (let i = 0; i < GRID_W; i++) {
        const a = j * VW + i;
        idx.push(a, a + VW, a + 1, a + 1, a + VW, a + VW + 1);
      }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VW * VH * 3).fill(0.8), 3));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    this.terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    // prairie (ondule au vent) : un lot d'instances par parcelle, pelouse de la ferme et herbes folles
    const N = GRID_W * GRID_H;
    const P = WORLD.PARCEL;
    for (let c = 0; c < WORLD.COLS; c++)
      for (let r = 0; r < WORLD.ROWS; r++) {
        const [cx, cz] = parcelCenter(c, r);
        const make = (geo: THREE.BufferGeometry) => {
          const im = new THREE.InstancedMesh(geo, GRASS_MAT, P * P);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.receiveShadow = true;
          im.setColorAt(0, new THREE.Color(1, 1, 1));
          im.count = 0;
          im.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0.2, cz), P * 0.75);
          this.scene.add(im);
          return im;
        };
        this.grassChunks.set(`${c},${r}`, { lawn: make(this.lawnGeo[0]), wild: make(this.wildGeo[0]), nl: 0, nw: 0 });
      }
    this.flowers = new THREE.InstancedMesh(flowerGeometry(), GRASS_MAT, N);
    this.flowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flowers.count = 0;
    this.scene.add(this.flowers);
  }

  // ------------------------------------------------------------ Caméra ----
  resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.updateCamera();
  }

  updateCamera() {
    const aspect = this.width / this.height;
    const halfH = this.viewHeight / 2 / this.zoom;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.target.x = clamp(this.target.x, -16, GRID_W + 6);
    this.target.z = clamp(this.target.z, GRID_Z0 - 4, GRID_Z1 + 23);
    this.camera.position.copy(this.target).addScaledVector(CAM_DIR, 80);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  static readonly MIN_ZOOM = 0.28;
  static readonly MAX_ZOOM = 8;

  setZoom(z: number) {
    this.zoom = clamp(z, FarmRenderer.MIN_ZOOM, FarmRenderer.MAX_ZOOM);
    this.updateCamera();
  }

  /** Changement de partie (ferme vitrine de l'accueil → vraie partie) : scène vierge, sans effets. */
  resetWorld() {
    for (const v of this.buildings.values()) this.bG.remove(v.group);
    this.buildings.clear();
    this.hens.clear();
    for (const m of this.eggs.values()) this.eggsG.remove(m);
    this.eggs.clear();
    for (const p of this.people.values()) this.peopleG.remove(p.root);
    this.people.clear();
    for (const w of this.staff.values()) this.staffG.remove(w.root);
    this.staff.clear();
    for (const p of this.preds.values()) this.predG.remove(p.root);
    this.preds.clear();
    for (const r of this.robots.values()) this.robotsG.remove(r.root);
    this.robots.clear();
    this.droppings.reset();
    this.fenceVersion = -1;
    this.layoutKey = '';
  }

  focusOn(x: number, z: number) {
    this.target.set(x, 0, z);
    this.updateCamera();
  }

  ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(groundPlane, p) ? p : null;
  }

  /** Le clic tombe-t-il sur l'hôtel de ville ? */
  pickTownHall(clientX: number, clientY: number) {
    if (!this.hall) return false;
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return ray.intersectObject(this.hall.group, true).length > 0;
  }

  /** Sélection : prédateurs (tir) > œufs > personnel > poules > bâtiments > parcelle. */
  pick(clientX: number, clientY: number): PickResult | null {
    ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    {
      // tolérance large : on vise vite quand un renard détale
      const r = this.renderer.domElement.getBoundingClientRect();
      let best = -1;
      let bestD = Math.max(34, 44 * this.zoom);
      for (const [id, v] of this.preds) {
        if (!v.alive) continue;
        tmpV.set(v.root.position.x, v.root.position.y + (v.species === 'fox' ? 0.3 : 0), v.root.position.z).project(this.camera);
        const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      if (best >= 0) return { kind: 'predator', id: best };
      let bestR = -1;
      let bestRD = Math.max(16, 22 * this.zoom);
      for (const [id, v] of this.robots) {
        tmpV.set(v.root.position.x, v.root.position.y + 0.1, v.root.position.z).project(this.camera);
        const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
        if (d < bestRD) {
          bestRD = d;
          bestR = id;
        }
      }
      if (bestR >= 0) return { kind: 'robot', id: bestR };
      if (this.dogView) {
        const p = this.dogView.root.position;
        tmpV.set(p.x, p.y + 0.3, p.z).project(this.camera);
        const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
        if (d < Math.max(16, 22 * this.zoom)) return { kind: 'dog' };
      }
    }
    const eggHits = ray.intersectObjects(this.eggsG.children, true);
    for (const h of eggHits) {
      const id = h.object.userData.eggId ?? h.object.parent?.userData.eggId;
      if (id !== undefined && h.object.userData.ground !== false) return { kind: 'egg', id };
    }
    // personnel puis poules : test en espace écran, plus tolérant qu'un lancer de rayon
    const r = this.renderer.domElement.getBoundingClientRect();
    {
      let bestW = -1;
      let bestWD = Math.max(18, 26 * this.zoom);
      for (const [id, v] of this.staff) {
        tmpV.set(v.root.position.x, v.root.position.y + 0.55, v.root.position.z).project(this.camera);
        const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
        if (d < bestWD) {
          bestWD = d;
          bestW = id;
        }
      }
      if (bestW >= 0) return { kind: 'worker', id: bestW };
    }
    const radius = Math.max(14, 20 * this.zoom);
    let best = -1;
    let bestD = radius;
    for (const [id, v] of this.hens) {
      if (!v.root.visible) continue;
      tmpV.set(v.root.position.x, v.root.position.y + 0.25, v.root.position.z).project(this.camera);
      const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best >= 0) return { kind: 'hen', id: best };
    // les volailles dans les parcs de la vente de poules
    best = -1;
    bestD = radius;
    for (const [id, v] of this.petBirds) {
      tmpV.set(v.hen.x, 0.32, v.hen.z).project(this.camera);
      const d = Math.hypot((tmpV.x * 0.5 + 0.5) * r.width + r.left - clientX, (-tmpV.y * 0.5 + 0.5) * r.height + r.top - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best >= 0) return { kind: 'petbird', id: best };
    const bHits = ray.intersectObjects(this.bG.children, true);
    // une couveuse est un petit meuble dans sa poussinière : elle passe devant le grillage et le sol
    for (const h of bHits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      if (o && this.buildings.get(o.userData.buildingId)?.type === 'incubator') return { kind: 'building', id: o.userData.buildingId };
    }
    for (const h of bHits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.buildingId === undefined) o = o.parent;
      if (o) return { kind: 'building', id: o.userData.buildingId };
    }
    // l'emplacement de la vente de poules, tant qu'elle n'est pas construite
    if (this.decor.petPlot.visible && ray.intersectObject(this.decor.petPlot, true).length) return { kind: 'petplot' };
    const g = this.groundAt(clientX, clientY);
    if (!g) return null;
    const cx = Math.floor(g.x);
    const cz = Math.floor(g.z);
    if (inGrid(cx, cz)) return { kind: 'parcel', key: parcelKeyOfCell(cx, cz), x: g.x, z: g.z };
    return { kind: 'ground', x: g.x, z: g.z };
  }

  // ------------------------------------------------------------ Terrain ----
  private wildGroup = new THREE.Group();
  private parcelOfCell: string[] = [];
  /** Clé de la parcelle d'une case (précalculée : la boucle de l'herbe passe sur toutes les cases). */
  private cellParcel(i: number) {
    if (!this.parcelOfCell.length) for (let k = 0; k < GRID_W * GRID_H; k++) this.parcelOfCell.push(parcelKeyOfCell(cellX(k), cellZ(k)));
    return this.parcelOfCell[i];
  }

  private rebuildLayout(s: GameState) {
    const owned = new Set(s.parcels);
    // un sommet est au niveau de la pelouse s'il touche une case possédée (le bord forme un petit talus)
    const tpos = this.terrain.geometry.attributes.position as THREE.BufferAttribute;
    const VW = GRID_W + 1;
    const ownedCell = (i: number, j: number) => i >= 0 && j >= 0 && i < GRID_W && j < GRID_H && owned.has(this.cellParcel(j * GRID_W + i));
    for (let j = 0; j <= GRID_H; j++)
      for (let i = 0; i <= GRID_W; i++) {
        const up = ownedCell(i, j) || ownedCell(i - 1, j) || ownedCell(i, j - 1) || ownedCell(i - 1, j - 1);
        tpos.setY(j * VW + i, up ? GRASS_TOP : 0.045);
      }
    tpos.needsUpdate = true;
    this.terrain.geometry.computeVertexNormals();

    // nature sauvage des parcelles à vendre : bosquets et buissons (défrichés à l'achat)
    for (const m of this.wildGroup.children) (m as THREE.InstancedMesh).dispose?.();
    this.wildGroup.clear();
    const wildTrees: Array<Array<[number, number, number]>> = [[], [], [], []];
    const wildBushes: Array<[number, number, number]> = [];
    for (let c = 0; c < WORLD.COLS; c++)
      for (let r = 0; r < WORLD.ROWS; r++) {
        if (owned.has(`${c},${r}`)) continue;
        for (const p of wildPlants(c, r)) {
          if (p.kind === 'tree') wildTrees[p.sp].push([p.x, p.z, p.sc]);
          else wildBushes.push([p.x, p.z, p.sc]);
        }
      }
    // ceux des parcelles achetées restent à leur place tant qu'on ne les enlève pas
    for (const b of s.buildings) {
      if (!b.wild) continue;
      const x = b.x + b.wild.ox;
      const z = b.z + b.wild.oz;
      if (b.type === 'tree') wildTrees[b.wild.sp].push([x, z, b.wild.sc]);
      else wildBushes.push([x, z, b.wild.sc]);
    }
    const wildSpecies: Species[] = ['oak', 'lime', 'birch', 'pine'];
    const wildContact: Array<[number, number, number]> = [];
    wildTrees.forEach((list, v) => {
      if (!list.length) return;
      plant(this.wildGroup, speciesGeometry(wildSpecies[v]), null, list.map(([x, z, sc]) => [x, z, hash(x * 3 + z) * 6, sc] as Plant), { cast: true, spread: 0.11, chunk: 1000 });
      for (const [x, z, sc] of list) wildContact.push([x, z, SHADOW_RADIUS[wildSpecies[v]] * sc]);
    });
    if (wildBushes.length) {
      const list = wildBushes.map(([x, z, sc]) => [x, z, hash(x + z) * 6, sc] as Plant);
      plant(this.wildGroup, speciesGeometry('bush'), null, list, { spread: 0.12, chunk: 1000 });
      for (const [x, z, , sc] of list) wildContact.push([x, z, SHADOW_RADIUS.bush * sc]);
    }
    if (wildContact.length) this.wildGroup.add(contactShadows(wildContact));

    // panneaux « À vendre »
    this.signGroup.clear();
    const signGeo = forSaleSign();
    for (let c = 0; c < WORLD.COLS; c++)
      for (let r = 0; r < WORLD.ROWS; r++) {
        const key = `${c},${r}`;
        if (owned.has(key)) continue;
        const m = mesh(signGeo);
        const [px, pz] = parcelCenter(c, r);
        m.position.set(px, 0, pz);
        this.signGroup.add(m);
      }
    this.grassTimer = 999;
  }

  private updateGrass(s: GameState) {
    const owned = new Set(s.parcels);
    // la nature change avec les saisons (fondu pendant le dernier jour de la saison)
    const sb = seasonBlend(s);
    const A = SEASON_LOOK[sb.a];
    const B = SEASON_LOOK[sb.b];
    seasonTint.copy(A.tint).lerp(B.tint, sb.k);
    const amt = A.amt + (B.amt - A.amt) * sb.k;
    const flowerK = A.flowers + (B.flowers - A.flowers) * sb.k;
    const tuftK = A.tufts + (B.tufts - A.tufts) * sb.k;
    // neige au sol : elle s'accumule au fil de l'hiver, par plaques, puis fond
    // la neige reste légère au sol : la ferme doit rester lisible
    const snow = snowCover(s) * 0.7;
    SNOW_UNIFORM.value = snow; // toits, poteaux, cimes des arbres
    this.groundMat.color.copy(GROUND_BASE).lerp(seasonTint, amt * 0.35).lerp(SNOW, snow * 0.8);
    setNatureSeason(sb.a, sb.b, sb.k, seasonTint, amt, snow);
    const N = GRID_W * GRID_H;
    const blocked = rt(s).blocked;
    // devant les trappes, l'herbe est foulée : pas de brins au travers des rampes
    const doorway = new Set<number>();
    // dans une poussinière, seul le bâtiment est bâti : l'herbe pousse dans le parc et sur les abords
    const parkLawn = new Set<number>();
    for (const b of s.buildings) {
      if (isShelter(b)) for (const [cx, cz] of coopDoorCells(b)) if (inGrid(cx, cz)) doorway.add(cellIndex(cx, cz));
      // l'herbe pousse au pied des arbres et des buissons
      if ((b.type === 'tree' || b.type === 'bush') && inGrid(b.x, b.z)) parkLawn.add(cellIndex(b.x, b.z));
      if (b.type !== 'nursery') continue;
      const { house, seats } = nurseryPlan(b.level);
      const fp = sizeOf(b.type, b.level, b.rot);
      for (let z = b.z; z < b.z + fp.d; z++)
        for (let x = b.x; x < b.x + fp.w; x++) {
          const [lx, lz] = toLocal(b, x + 0.5, z + 0.5);
          const roofed = lx > house.x0 - 0.35 && lx < house.x1 + 0.35 && lz > house.z0 - 0.35 && lz < house.z1 + 0.35;
          // ni sur le dallage des couveuses
          const paved = seats.some((q) => Math.abs(lx - q.x) < ((q.rot % 2 ? 1.14 : 2.14) * q.k) / 2 + 0.35 && Math.abs(lz - q.z) < ((q.rot % 2 ? 2.14 : 1.14) * q.k) / 2 + 0.35);
          if (!roofed && !paved && inGrid(x, z)) parkLawn.add(cellIndex(x, z));
        }
    }
    for (const ch of this.grassChunks.values()) ch.nl = ch.nw = 0;
    let f = 0;
    for (let i = 0; i < N; i++) {
      const x = cellX(i);
      const z = cellZ(i);
      const key = this.cellParcel(i);
      const pc = Math.floor(x / WORLD.PARCEL) + Math.floor((z - GRID_Z0) / WORLD.PARCEL);
      const own = owned.has(key);
      const n = (hash(i) - 0.5) * 0.05;
      if (own) {
        const g = s.grass[i];
        if (g < 0.5) tmpC.copy(colDirt).lerp(colDry, g / 0.5);
        else tmpC.copy(colDry).lerp(colLush, (g - 0.5) / 0.5);
        tmpC.lerp(seasonTint, amt).offsetHSL(0, 0, n);
        // plaques de neige : certaines cases blanchissent avant les autres
        const patch = snow > 0 ? clamp(snow * 1.35 - 0.35 + (hash(i * 5) - 0.5) * 0.5, 0, 1) : 0;
        if (patch > 0) tmpC.lerp(SNOW, patch * 0.8);
        this.cellCol[i * 3] = tmpC.r;
        this.cellCol[i * 3 + 1] = tmpC.g;
        this.cellCol[i * 3 + 2] = tmpC.b;
        // pas d'herbe haute sous un bâtiment (elle traverserait l'eau d'une mare)
        const under = (blocked[i] === 1 && !parkLawn.has(i)) || doorway.has(i) || inTruckBay(cellX(i), cellZ(i));
        // teinte des brins : l'herbe broutée jaunit, la saison et la neige s'y ajoutent
        tuftC.setRGB(1, 1, 1).lerp(DRY_BLADE, clamp((0.75 - g) * 1.4, 0, 0.85)).lerp(seasonTint, amt * 0.55);
        if (patch > 0) tuftC.lerp(SNOW, patch * 0.6);
        // tapis d'herbe de la case : sa hauteur suit l'herbe restante (rase là où les poules ont brouté)
        const hs = under || g < 0.08 ? 0 : (0.25 + Math.pow(g, 0.85) * 0.9) * tuftK * (1 - patch * 0.7);
        const ch = this.grassChunks.get(key);
        if (ch && hs > 0.03) {
          tmpO.position.set(x + 0.5 + (hash(i * 7) - 0.5) * 0.12, GRASS_TOP, z + 0.5 + (hash(i * 11) - 0.5) * 0.12);
          tmpO.rotation.set(0, Math.floor(hash(i) * 4) * (Math.PI / 2) + (hash(i * 13) - 0.5) * 0.5, 0);
          tmpO.scale.set(1, hs, 1);
          tmpO.updateMatrix();
          ch.lawn.setColorAt(ch.nl, tuftC);
          ch.lawn.setMatrixAt(ch.nl++, tmpO.matrix);
        }
        if (!under && hash(i * 13) < 0.1 * flowerK && g > 0.72) {
          tmpO.position.set(x + hash(i * 17) * 0.8 + 0.1, GRASS_TOP, z + hash(i * 19) * 0.8 + 0.1);
          tmpO.scale.setScalar(0.8 + hash(i) * 0.5);
          tmpO.rotation.set(0, hash(i * 3) * 6, 0);
          tmpO.updateMatrix();
          this.flowers.setMatrixAt(f++, tmpO.matrix);
        }
      } else {
        // prairie sauvage : touffes hautes clairsemées et fleurs des champs
        const wild = (hash(i * 23) - 0.5) * 0.08;
        const ch = this.grassChunks.get(key);
        if (ch) {
          const sc = (0.8 + hash(i * 31) * 0.5) * tuftK;
          tmpO.position.set(x + 0.5 + (hash(i * 37) - 0.5) * 0.2, 0.045, z + 0.5 + (hash(i * 41) - 0.5) * 0.2);
          tmpO.rotation.set(0, hash(i * 43) * 6.28, 0);
          tmpO.scale.set(1, sc, 1);
          tmpO.updateMatrix();
          // herbes folles : un peu plus sèches et blondes que la pelouse de la ferme
          tuftC.setRGB(1, 1, 1).lerp(DRY_BLADE, 0.04 + hash(i * 67) * 0.14).lerp(seasonTint, amt * 0.55);
          if (snow > 0) tuftC.lerp(SNOW, snow * 0.6);
          ch.wild.setColorAt(ch.nw, tuftC);
          ch.wild.setMatrixAt(ch.nw++, tmpO.matrix);
        }
        if (hash(i * 47) < 0.05 * flowerK) {
          tmpO.position.set(x + hash(i * 53) * 0.8 + 0.1, 0.045, z + hash(i * 59) * 0.8 + 0.1);
          tmpO.scale.setScalar(0.75 + hash(i * 61) * 0.4);
          tmpO.rotation.set(0, hash(i * 71) * 6, 0);
          tmpO.updateMatrix();
          this.flowers.setMatrixAt(f++, tmpO.matrix);
        }
        tmpC.copy(pc % 2 ? colWild : colWild2).lerp(seasonTint, amt * 0.75).offsetHSL(0, 0, n * 0.5 + wild);
        if (snow > 0) tmpC.lerp(SNOW, clamp(snow * 1.2 - 0.2 + (hash(i * 5) - 0.5) * 0.3, 0, 0.95));
        if (this.hoverParcel === key) tmpC.lerp(HOVER, 0.45);
        this.cellCol[i * 3] = tmpC.r;
        this.cellCol[i * 3 + 1] = tmpC.g;
        this.cellCol[i * 3 + 2] = tmpC.b;
      }
    }
    // couleurs des sommets : moyenne des cases voisines (dégradés doux, plus de damier),
    // avec une légère marbrure à grande échelle pour que le pré ne soit pas uniforme
    const tcol = this.terrain.geometry.attributes.color as THREE.BufferAttribute;
    const VW = GRID_W + 1;
    const cc = this.cellCol;
    for (let j = 0; j <= GRID_H; j++)
      for (let i = 0; i <= GRID_W; i++) {
        let r = 0;
        let gg = 0;
        let b = 0;
        let n = 0;
        for (let dj = -1; dj <= 0; dj++)
          for (let di = -1; di <= 0; di++) {
            const ci = i + di;
            const cj = j + dj;
            if (ci < 0 || cj < 0 || ci >= GRID_W || cj >= GRID_H) continue;
            const k = (cj * GRID_W + ci) * 3;
            r += cc[k];
            gg += cc[k + 1];
            b += cc[k + 2];
            n++;
          }
        const v = j * VW + i;
        const m = (1 + Math.sin(i * 0.37 + j * 0.11) * Math.cos(j * 0.29 - i * 0.07) * 0.06 + (hash(v * 7.1) - 0.5) * 0.05) / n;
        tcol.setXYZ(v, r * m, gg * m, b * m);
      }
    tcol.needsUpdate = true;
    this.flowers.count = f;
    this.flowers.instanceMatrix.needsUpdate = true;
    for (const ch of this.grassChunks.values()) {
      for (const [im, n] of [[ch.lawn, ch.nl], [ch.wild, ch.nw]] as const) {
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------- Bâtiments ----
  private syncBuildings(s: GameState, dt: number) {
    const seen = new Set<number>();
    for (const b of s.buildings) {
      seen.add(b.id);
      let v = this.buildings.get(b.id);
      if (!v || v.level !== b.level || v.type !== b.type) {
        if (v) this.bG.remove(v.group);
        const m = b.wild ? wildPlantHit(b.type, b.wild.ox, b.wild.oz) : buildingModel(b.type, b.level);
        v = { ...m, id: b.id, type: b.type, level: b.level, bounce: b.wild ? 0 : v ? 1 : this.layoutKey ? 1 : 0 };
        v.group.userData.buildingId = b.id;
        this.bG.add(v.group);
        this.buildings.set(b.id, v);
        const c = this.center(b);
        if (v.bounce) this.particles.burst(c.x, 0.3, c.z, 0xe8d9b8, 18, { speed: 1.8, up: 1.2 });
      }
      const y = b.type === 'stand' || b.type === 'petshop' ? 0 : GRASS_TOP - 0.02;
      v.group.position.set(b.type === 'stand' ? STAND_POS.x : b.x, y, b.type === 'stand' ? STAND_POS.z - 0.2 : b.z);
      // pivoté : le modèle tourne autour de son coin, puis se recale sur son emprise
      const [ox, oz] = turnOffset(b.type, b.level, b.rot ?? 0);
      v.group.rotation.y = ((b.rot ?? 0) * Math.PI) / 2;
      v.group.position.x += ox;
      v.group.position.z += oz;
      if (v.bounce > 0) {
        v.bounce = Math.max(0, v.bounce - dt * 2.2);
        const k = v.bounce;
        v.group.scale.set(1 + Math.sin(k * Math.PI) * 0.08, 1 - Math.sin(k * Math.PI * 2) * 0.12 * k, 1 + Math.sin(k * Math.PI) * 0.08);
      } else v.group.scale.set(1, 1, 1);
      // la couveuse est à l'échelle de son emplacement, et suit sa poussinière quand on la déplace
      const seated = b.type === 'incubator' ? incubatorSeat(s, b) : null;
      if (seated) {
        v.group.scale.multiplyScalar(seated.seat.k);
        const hostView = this.buildings.get(seated.host.id);
        if (hostView) v.group.visible = hostView.group.visible;
      }
      const L = lvl(b);
      if (v.fill) {
        const ratio = clamp(b.stock / Math.max(1, L.capacity), 0, 1);
        if (v.fillMode === 'scale') {
          v.fill.scale.y = Math.max(0.001, ratio * (v.fillHeight ?? 0.1));
          v.fill.visible = ratio > 0.01;
        } else if (v.fillMode === 'heap') {
          // le tas de compost est un tas de terre : il ne bouge pas, quoi qu'en grattent les poules
          v.fill.scale.set(1, v.fillHeight ?? 0.5, 1);
          v.fill.visible = true;
        } else {
          v.fill.position.y = (v.fillBase ?? 0) + ratio * (v.fillHeight ?? 0.1);
          v.fill.visible = ratio > 0.01;
        }
      }
      if (b.type === 'nest') this.syncNestEggs(s, b, v);
      if (b.type === 'stand') this.syncGoldShowcase(s, v);
      if (isIncubator(b)) this.syncIncubatorEggs(b, v);
      if (v.autoKit) v.autoKit.visible = !!b.autoDoor;
      // le magasin porte le nom de la ferme (celle qu'on visite, le cas échéant)
      v.setSign?.(s.farmName);
      // les trappes des parcs se rabattent au sol devant les volailles, et se referment derrière
      if (v.hatches) {
        const hens = hatchWanted(s, false);
        const geese = hatchWanted(s, true);
        for (const h of v.hatches) {
          const open = h.goose === null ? hens || geese : h.goose ? geese : hens;
          const target = open ? h.side * 1.5 : 0;
          h.pivot.rotation.x += (target - h.pivot.rotation.x) * Math.min(1, dt * 5);
        }
      }
      if (v.gate) {
        const open = nurseryGateOpen(s, b) ? -1.5 : 0;
        v.gate.rotation.y += (open - v.gate.rotation.y) * Math.min(1, dt * 6);
      }
      if (v.door) {
        // la trappe glisse vers le bas quand le commis ferme le poulailler
        const target = b.closed ? 1 : 0;
        v.door.scale.y += (target - v.door.scale.y) * Math.min(1, dt * 5);
        v.door.visible = v.door.scale.y > 0.02;
      }
      if (v.crates) {
        const st = s.lots.reduce((a, l) => a + l.count, 0);
        const ratio = st / Math.max(1, L.capacity);
        const n = st === 0 ? 0 : Math.ceil(ratio * v.crates.length);
        v.crates.forEach((c, i) => (c.visible = i < n));
      }
    }
    for (const [id, v] of this.buildings) {
      if (!seen.has(id)) {
        this.bG.remove(v.group);
        this.buildings.delete(id);
      }
    }
  }

  /** Œufs en couvaison derrière la vitre ; la couveuse les retourne doucement. */
  private syncIncubatorEggs(b: Building, v: BState) {
    const list = b.hatch ?? [];
    const n = Math.min(list.length, v.eggSlots.length);
    while (v.eggMeshes.length < n) {
      const m = new THREE.Mesh(eggGeometry('roux'), EGG_MAT);
      m.castShadow = false;
      v.group.add(m);
      v.eggMeshes.push(m);
    }
    const turn = Math.sin(this.time * 0.35) * 0.45;
    for (let i = 0; i < v.eggMeshes.length; i++) {
      const m = v.eggMeshes[i];
      m.visible = i < n;
      if (!m.visible) continue;
      const type = BREEDS[list[i].breed].egg;
      if (m.userData.type !== type) {
        m.geometry = eggGeometry(type);
        m.userData.type = type;
      }
      // couché sur le flanc (axe le long de x), la grille bascule lentement d'un côté puis de l'autre
      const tau = turn * 0.5;
      const k = hatchesGeese(b) ? 0.8 : 0.6;
      const big = type === 'oie';
      const half = 0.088 * k * (big ? 1.5 : 1);
      m.scale.setScalar(k);
      m.rotation.set(0, 0, -Math.PI / 2 + tau);
      m.position.copy(v.eggSlots[i]);
      m.position.x -= Math.cos(tau) * half;
      m.position.y += 0.062 * k * (big ? 1.45 : 1) - Math.sin(tau) * half;
    }
  }

  /**
   * Vitrine de l'œuf d'or devant l'étal : piédestal de bois, coussin de velours rouge, œufs d'or
   * sous une cloche de verre et petite étiquette de prix ; visible tant qu'il reste des œufs d'or.
   */
  private syncGoldShowcase(s: GameState, v: BState) {
    const n = Math.min(3, s.goldEggs ?? 0);
    if (!this.goldShowcase) {
      const g = new THREE.Group();
      g.add(
        mesh(
          merge([
            cyl(0.16, 0.2, 0.06, 14, C.woodDark, [0, 0.03, 0]),
            cyl(0.07, 0.09, 0.62, 12, C.wood, [0, 0.37, 0]),
            cyl(0.17, 0.15, 0.05, 14, C.woodDark, [0, 0.7, 0]),
            cyl(0.14, 0.14, 0.05, 14, 0x9c1f2e, [0, 0.745, 0]),
            box(0.2, 0.12, 0.02, 0xf6efe2, [0.0, 0.62, 0.19], [-0.2, 0, 0]),
            box(0.14, 0.03, 0.022, 0xd4a017, [0.0, 0.63, 0.198], [-0.2, 0, 0]),
          ]),
        ),
      );
      const eggs: THREE.Mesh[] = [];
      for (const [x, z, r] of [
        [0, 0, 0],
        [-0.065, 0.03, 0.35],
        [0.065, 0.03, -0.35],
      ]) {
        const e = new THREE.Mesh(eggGeometry('or'), GOLD_EGG_MAT);
        e.position.set(x, 0.77, z);
        e.rotation.z = r;
        e.scale.setScalar(0.9);
        g.add(e);
        eggs.push(e);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.22, shininess: 120, specular: 0xffffff, depthWrite: false }));
      dome.position.y = 0.77;
      dome.scale.y = 1.35;
      dome.renderOrder = 4;
      g.add(dome);
      g.userData.eggs = eggs;
      v.group.add(g);
      this.goldShowcase = g;
    }
    const g = this.goldShowcase;
    // devant l'étal, du côté de la file des clients ; au magasin, sur la terrasse, près de la porte
    if (v.setSign) g.position.set(6.6, 0.09, 3.1);
    else g.position.set(2.45, 0, 1.25);
    // l'étal est reconstruit à chaque amélioration (et au lancement de la partie) : la vitrine suit
    if (g.parent !== v.group) v.group.add(g);
    g.visible = n > 0;
    (g.userData.eggs as THREE.Mesh[]).forEach((e, i) => (e.visible = i < n));
    if (n > 0 && Math.random() < 0.05) {
      const w = g.getWorldPosition(new THREE.Vector3());
      this.particles.burst(w.x + (Math.random() - 0.5) * 0.2, 0.95, w.z + (Math.random() - 0.5) * 0.2, 0xffe27a, 1, { speed: 0.1, up: 0.3, gravity: 0, size: 0.3, life: 0.8 });
    }
  }

  private syncNestEggs(s: GameState, b: Building, v: BState) {
    const n = Math.min(b.eggIds.length, v.eggSlots.length);
    while (v.eggMeshes.length < n) {
      const m = new THREE.Mesh(eggGeometry('roux'), EGG_MAT);
      m.castShadow = false;
      v.group.add(m);
      v.eggMeshes.push(m);
    }
    for (let i = 0; i < v.eggMeshes.length; i++) {
      const m = v.eggMeshes[i];
      if (i < n) {
        const egg = s.worldEggs.find((e) => e.id === b.eggIds[i]);
        if (egg && m.userData.type !== egg.type) {
          m.geometry = eggGeometry(egg.type);
          m.material = egg.type === 'phenix' ? PHOENIX_EGG_MAT : egg.type === 'or' ? GOLD_EGG_MAT : EGG_MAT;
          m.userData.type = egg.type;
        }
        m.position.copy(v.eggSlots[i]);
        const age = egg ? s.clock.t - egg.laidAt : 10;
        const pop = age < 0.5 ? Math.sin((age / 0.5) * Math.PI) * 0.4 + age / 0.5 : 1;
        m.scale.setScalar(Math.max(0.05, pop));
        m.rotation.z = (i % 3) * 0.3 - 0.3;
        m.visible = true;
      } else m.visible = false;
    }
  }

  center(b: { type: BuildingType; x: number; z: number; level?: number; rot?: number }) {
    const d = sizeOf(b.type, b.level, b.rot);
    if (b.type === 'stand') return standLayout(b.level).center;
    if (b.type === 'petshop') return petLayout(b.level).center;
    return { x: b.x + d.w / 2, z: b.z + d.d / 2 };
  }

  // -------------------------------------------------------------- Poules ----
  private syncHens(s: GameState, dt: number) {
    const stamp = ++this.henStamp;
    const alpha = simAlpha(s);
    // niveau de détail : tout le monde au modèle complet tant que les oiseaux à l'écran restent peu nombreux,
    // un modèle à peine allégé pour un grand troupeau, et d'un seul tenant seulement pour une vraie foule
    // ou vus de très haut. Une marge évite que l'image change à chaque poule qui entre dans le cadre.
    const seen = this.henOnScreen;
    if (this.henLod === 0 && seen > HEN_FULL_MAX) this.henLod = 1;
    else if (this.henLod === 1 && seen < HEN_FULL_MAX * 0.75) this.henLod = 0;
    else if (this.henLod === 1 && seen > HEN_MID_MAX) this.henLod = 2;
    else if (this.henLod === 2 && seen < HEN_MID_MAX * 0.75) this.henLod = 1;
    const far = this.lowGraphics ? this.zoom < 0.85 || seen > 350 : this.henLod === 2 || this.zoom < HEN_FAR_ZOOM;
    const full = this.lowGraphics ? this.zoom >= 3 : this.henLod === 0;
    let onScreen = 0;
    // cadre visible, en coordonnées du sol : ce qui est hors champ n'est ni animé ni dessiné
    const e = this.camera.matrixWorld.elements;
    const rx = e[0];
    const rz = e[2];
    const ux = e[4];
    const uz = e[6];
    const tx = this.target.x;
    const tz = this.target.z;
    const hw = this.camera.right / this.camera.zoom + 1.2;
    const hh = this.camera.top / this.camera.zoom + 1.2;
    for (const b of this.batches.values()) b.begin();
    for (const b of this.farBatches.values()) b.begin();
    this.blobs.begin();
    for (const h of s.hens) {
      let v = this.hens.get(h.id);
      if (!v) {
        const hv = createHenView(h.breed, h.id);
        v = { ...hv, breed: h.breed, key: henKey(h), walk: 0, vis: h.act === 'sleep' ? 0 : 1, spawn: 0, yawT: 0, yaw: 0, tilt: 0, y: GRASS_TOP, blinkT: 1 + Math.random() * 4, stamp, drawnFar: false, ship: false };
        this.hens.set(h.id, v);
      }
      v.stamp = stamp;
      v.ship = !!h.ship;
      const r = rtHen(h);
      const x = r.px + (h.x - r.px) * alpha;
      const z = r.pz + (h.z - r.pz) * alpha;
      const dx = x - tx;
      const dz = z - tz;
      v.drawnFar = false;
      // hors champ : on garde juste sa position à jour (étiquettes, clics, caméra qui la suit)
      if (Math.abs(dx * rx + dz * rz) > hw || Math.abs(dx * ux + dz * uz) > hh) {
        v.root.position.set(x, v.y, z);
        v.root.visible = false;
        const glow = h.golden || h.legendary ? this.goldGlows.get(h.id) : undefined;
        if (glow) glow.visible = false;
        continue;
      }
      onScreen++;
      const key = henKey(h);
      if (!this.henWarm.has(key)) {
        this.henWarm.add(key);
        this.henWarmQueue.push(`full|${key}`, `mid|${key}`, `far|${key}`);
      }
      if (far && !h.golden && !h.legendary && h.id !== this.selectedHen) {
        v.key = key;
        const hidden = h.act === 'sleep' || h.act === 'enter';
        v.root.visible = !hidden;
        v.root.position.set(x, v.y, z);
        if (hidden) continue;
        v.drawnFar = true;
        let hd = h.heading - r.ph;
        while (hd > Math.PI) hd -= Math.PI * 2;
        while (hd < -Math.PI) hd += Math.PI * 2;
        this.farBatch(key).push(x, GRASS_TOP, z, r.ph + hd * alpha, v.size * growthScale(h), v.tint);
        this.blobs.push(x, GRASS_TOP + 0.008, z, 0, v.size * growthScale(h), WHITE);
        continue;
      }
      // il change de plumage : quelques brins de duvet s'envolent (jamais de transformation « magique »)
      if (key !== v.key && (h.young || v.key.split(':').length === 3) && v.root.visible) {
        this.particles.burst(h.x, 0.3, h.z, 0xf6e3a0, 7, { speed: 0.35, up: 0.55, gravity: 0.35, size: 0.5, life: 1.8 });
      }
      v.key = key;
      this.animateHen(s, h, v, dt, alpha);
      // autour de la poule légendaire, de temps en temps, un éclat vert, rose ou rouge
      if (h.legendary && v.root.visible && Math.random() < dt * 1.2) {
        const ember = [0x4fd68f, 0xff7ab8, 0xff4a62][Math.floor(Math.random() * 3)];
        this.particles.burst(v.root.position.x + (Math.random() - 0.5) * 0.5, 0.15 + Math.random() * 0.5, v.root.position.z + (Math.random() - 0.5) * 0.5, ember, 1, { speed: 0.25, up: 1.1, gravity: -0.1, size: 0.7, life: 1.3 });
      }
      // la poule aux œufs d'or scintille
      if (h.golden || h.legendary) {
        if (h.golden && v.root.visible && Math.random() < dt * 5)
          this.particles.burst(v.root.position.x + (Math.random() - 0.5) * 0.35, 0.2 + Math.random() * 0.45, v.root.position.z + (Math.random() - 0.5) * 0.35, 0xffe27a, 1, { speed: 0.25, up: 0.5, gravity: 0.2, size: 0.55, life: 0.9 });
        // halo doré au sol, qui respire doucement
        let glow = this.goldGlows.get(h.id);
        if (!glow) {
          glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), h.legendary ? LEGEND_GLOW : GOLD_GLOW);
          glow.renderOrder = 2;
          this.scene.add(glow);
          this.goldGlows.set(h.id, glow);
        }
        glow.visible = v.root.visible;
        glow.position.set(v.root.position.x, GRASS_TOP + 0.02, v.root.position.z);
        glow.scale.setScalar((h.legendary ? 1.7 : 0.9) + Math.sin(this.time * 2.3 + h.id) * 0.08);
      }
      if (h.young) {
        v.headPivot.scale.setScalar(headScale(h));
        // pendant la mue juvénile, un brin de duvet se détache de temps en temps
        const st = growthStage(h);
        if (st >= 2 && st <= 5 && v.root.visible && Math.random() < dt * 0.04) this.particles.burst(h.x, 0.28, h.z, 0xf6e3a0, 1, { speed: 0.2, up: 0.35, gravity: 0.3, size: 0.4, life: 2 });
      } else if (v.headPivot.scale.x !== 1) v.headPivot.scale.setScalar(1);
      // recopie du squelette animé dans les maillages instanciés (la poule sélectionnée s'illumine doucement)
      if (!v.root.visible) continue;
      const lot = this.batch(key, full || h.id === this.selectedHen);
      if (h.id === this.selectedHen) lot.push(v, this.selTint.copy(v.tint).multiplyScalar(1.25 + 0.15 * Math.sin(this.time * 3.6)));
      else lot.push(v);
    }
    for (const [id, gl] of this.goldGlows)
      if (this.hens.get(id)?.stamp !== stamp || !s.hens.some((x) => x.id === id && (x.golden || x.legendary))) {
        this.scene.remove(gl);
        this.goldGlows.delete(id);
      }
    for (const [id, v] of this.hens) {
      if (v.stamp !== stamp) {
        // (partie en vitrine ou dans le camion : elle s'en va sans plumes qui volent)
        if (!v.ship && !s.petShop.birds.some((b) => b.id === id)) this.particles.burst(v.root.position.x, 0.35, v.root.position.z, 0xf6f1e7, 14, { speed: 1, up: 1.2, gravity: 1.5, life: 1.3 });
        this.hens.delete(id);
      }
    }
    // les volailles hors du troupeau, dessinées exactement comme les autres : en vente dans leur parc, ou
    // qui marchent entre un camion et la ferme (mêmes modèles selon le zoom, même ombre, mêmes gestes)
    const drawBird = (h: Hen, v: HenState, lift = 0) => {
      const dx = h.x - tx;
      const dz = h.z - tz;
      if (Math.abs(dx * rx + dz * rz) > hw || Math.abs(dx * ux + dz * uz) > hh) return;
      onScreen++;
      const key = henKey(h);
      const selected = h.id === this.selectedPetBird;
      if (far && !selected) {
        this.farBatch(key).push(h.x, GRASS_TOP + lift, h.z, h.heading, v.size, v.tint);
        this.blobs.push(h.x, GRASS_TOP + 0.008 + lift, h.z, 0, v.size, WHITE);
        return;
      }
      this.animateHen(s, h, v, dt, 1);
      if (lift) v.root.position.y += lift;
      const lot = this.batch(key, full || selected);
      if (selected) lot.push(v, this.selTint.copy(v.tint).multiplyScalar(1.25 + 0.15 * Math.sin(this.time * 3.6)));
      else lot.push(v);
    };
    this.truck.birds(s, (b) => {
      let g = this.ghosts.get(b.seed);
      if (!g) {
        // elle sort de son parc : c'est la même volaille, qui continue depuis là où elle est
        const pet = this.petBirds.get(b.seed);
        const hen = pet?.hen ?? ({ id: b.seed, breed: b.breed, skin: b.skin, rooster: b.rooster, black: b.black, x: b.x, z: b.z, heading: 0, act: 'walk', actT: 5, targetId: -1, health: 100 } as unknown as Hen);
        hen.act = 'walk';
        g = { hen, view: pet?.view ?? this.birdView(hen), fx: hen.x, fz: hen.z };
        g.view.root.rotation.order = 'YXZ';
        this.ghosts.set(b.seed, g);
        this.petBirds.delete(b.seed);
      }
      g.view.stamp = stamp;
      const hen = g.hen;
      const k = Math.min(1, b.age / 0.8);
      hen.x = g.fx + (b.x - g.fx) * k;
      hen.z = g.fz + (b.z - g.fz) * k;
      if (b.dx || b.dz) hen.heading = Math.atan2(b.dx, b.dz);
      const r = rtHen(hen);
      r.px = hen.x;
      r.pz = hen.z;
      r.ph = hen.heading;
      r.spd = 1;
      // sur la rampe : le corps suit la pente
      g.view.root.rotation.x = -b.slope;
      drawBird(hen, g.view, b.lift);
    });
    this.syncPetBirds(s, dt, drawBird);
    for (const [id, g] of this.ghosts) if (g.view.stamp !== stamp) this.ghosts.delete(id);
    // un modèle de plus préparé à l'avance, s'il en reste
    const warm = this.henWarmQueue.shift();
    if (warm) {
      const [lod, key] = warm.split('|');
      const [head, skin] = key.split('#');
      const [breed, kind, stage] = head.split(':') as [BreedId, HenKind?, string?];
      const make = lod === 'full' ? henGeometry : lod === 'mid' ? henGeometryMid : henGeometryFar;
      make(breed, kind ?? 'hen', stage === undefined ? ADULT_STAGE : Number(stage), Number(skin ?? 0));
    }
    for (const b of this.batches.values()) b.end();
    for (const b of this.farBatches.values()) b.end();
    this.blobs.end();
    this.henOnScreen = onScreen;
  }

  /** Lot des vues d'ensemble : l'ombre portée n'est gardée que tant qu'il y a peu d'oiseaux à l'écran. */
  private farBatch(key: string) {
    let b = this.farBatches.get(key);
    if (!b) {
      const [head, skin] = key.split('#');
      const [breed, kind, stage] = head.split(':') as [BreedId, HenKind?, string?];
      b = new HenFarBatch(henGeometryFar(breed, kind ?? 'hen', stage === undefined ? ADULT_STAGE : Number(stage), Number(skin ?? 0)));
      this.farBatches.set(key, b);
      this.scene.add(b.mesh);
    }
    return b;
  }

  /** Lot d'instances d'un type d'oiseau (créé à la première apparition pour les coqs et poussins). */
  private batch(key: string, full = false) {
    const id = full ? `${key}|full` : key;
    let b = this.batches.get(id);
    if (!b) {
      const [head, skin] = key.split('#');
      const [breed, kind, stage] = head.split(':') as [BreedId, HenKind?, string?];
      // la poule aux œufs d'or a son propre matériau, brillant
      const gold = Number(skin ?? 0) === GOLD_SKIN;
      const legend = Number(skin ?? 0) === LEGEND_SKIN;
      const make = full || gold || legend ? henGeometry : henGeometryMid;
      b = new HenBatch(make(breed, kind ?? 'hen', stage === undefined ? ADULT_STAGE : Number(stage), Number(skin ?? 0)), full ? 8 : 32, legend ? LEGEND_HEN_MAT : gold ? GOLD_HEN_MAT : undefined);
      this.batches.set(id, b);
      this.scene.add(...b.meshes());
    }
    return b;
  }

  private animateHen(s: GameState, h: Hen, v: HenState, dt: number, alpha: number) {
    const r = rtHen(h);
    const t = this.time + v.phase;
    // position exacte : interpolation entre les deux derniers pas de simulation
    const x = r.px + (h.x - r.px) * alpha;
    const z = r.pz + (h.z - r.pz) * alpha;
    let dh = h.heading - r.ph;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const heading = r.ph + dh * alpha;
    const target = h.targetId >= 0 ? s.buildings.find((b) => b.id === h.targetId) : undefined;
    const onNest = target?.type === 'nest' && (h.act === 'lay' || ((h.act === 'enter' || h.act === 'exit') && toLocal(target, h.x, h.z)[1] < 1.02));
    const inBath = target?.type === 'dustbath' && (h.act === 'bathe' || h.act === 'enter' || h.act === 'exit');
    // poulailler : la poule gravit la rampe, passe le seuil de la trappe et disparaît derrière le mur
    const coopWay = target && (isShelter(target) || target.type === 'nursery') && (h.act === 'enter' || h.act === 'exit') ? coopPassage(target.type, target.level, toLocal(target, x, z)[1]) : null;
    const yTarget = onNest ? 0.36 : inBath ? GRASS_TOP + 0.02 : coopWay ? GRASS_TOP - 0.02 + coopWay.y : GRASS_TOP;
    v.y += (yTarget - v.y) * Math.min(1, dt * (coopWay ? 30 : 14));
    // petit saut pour monter dans le nid
    const hop = onNest && Math.abs(v.y - yTarget) > 0.04 ? Math.sin(((v.y - GRASS_TOP) / 0.26) * Math.PI) * 0.06 : 0;
    v.root.position.set(x, v.y + hop, z);
    v.root.rotation.y = heading;

    // visibilité : la poule dort dans le poulailler ; elle n'y rétrécit jamais, elle disparaît
    // seulement une fois passée tout entière derrière le mur (et réapparaît au seuil le matin)
    v.vis = h.act === 'sleep' || coopWay?.inside ? 0 : 1;
    v.spawn = Math.min(1, v.spawn + dt * 2.5);
    const grow = v.spawn < 1 ? 0.3 + 0.7 * Math.sin((v.spawn * Math.PI) / 2) : 1;
    // (la poule légendaire est nettement plus grosse que les autres)
    v.root.scale.setScalar(v.size * (h.legendary ? 1.6 : 1) * growthScale(h) * grow * Math.max(0.001, v.vis) * (h.health < 30 ? 0.94 : 1));
    v.root.visible = v.vis > 0.03;
    if (!v.root.visible) return;

    // ---- postures ----
    const spd = r.spd;
    const walking = spd > 0.05 && h.act !== 'lay' && h.act !== 'rest' && h.act !== 'bathe';
    let headX = 0.05;
    let headY = 0;
    let headZ = 0;
    let headFwd = 0;
    let bodyX = 0;
    let bodyZ = 0;
    let bodyY = 0;
    let sit = 0;
    let wing = 0;
    let wingLift = 0;
    let legL = 0;
    let legR = 0;
    let fluff = 1;
    if (walking) {
      v.walk += spd * dt * 10.5;
      const ph = v.walk;
      legL = Math.sin(ph) * 0.62;
      legR = -legL;
      bodyY = Math.abs(Math.cos(ph)) * 0.012;
      bodyZ = Math.sin(ph) * 0.05;
      // dodelinement : la tête reste fixe puis se projette en avant à chaque pas
      const saw = (ph / Math.PI) % 1;
      headFwd = (0.03 - saw * 0.055) * Math.min(1, spd / 0.4);
      headX = -0.05;
      if (spd > 0.95) wing = 0.18 + Math.sin(t * 20) * 0.08;
    }
    // regard saccadé : la poule tourne la tête par à-coups
    v.yawT -= dt;
    if (v.yawT <= 0) {
      v.yawT = 0.35 + Math.random() * 0.9;
      v.yaw = (Math.random() - 0.5) * 1.5;
      v.tilt = (Math.random() - 0.5) * 0.5;
    }
    // à la mangeoire, à l'abreuvoir ou à la mare : le cou plonge jusqu'au grain ou à l'eau
    const feed = (h.act === 'eat' || h.act === 'drink') && target ? FEED_POSES[feedPose(target)] : null;
    switch (h.act) {
      case 'peck':
      case 'eat': {
        if (walking) break;
        const rate = h.act === 'eat' ? 1.7 : 1.1;
        const cyc = (t * rate) % 1;
        const pecking = cyc < (h.act === 'eat' ? 0.75 : 0.5);
        const dip = Math.max(0, Math.sin(t * 19));
        headX = pecking ? (feed ? feed.head - 0.12 + 0.24 * dip : 0.95 + 0.4 * dip) : 0.1;
        headY = pecking ? 0 : v.yaw * 0.6;
        headZ = pecking ? 0 : v.tilt;
        bodyX = pecking ? (feed ? feed.body : 0.24) : 0.05;
        break;
      }
      case 'scratch': {
        if (walking) break;
        // deux ou trois coups de patte vers l'arrière, en se penchant, puis des coups de bec
        // dans la terre retournée, et la tête se relève pour surveiller
        const cyc = (t * 0.55) % 1;
        if (cyc < 0.45) {
          const k = Math.sin(t * 11);
          legL = -Math.max(0, k) * 0.95;
          legR = -Math.max(0, -k) * 0.95;
          bodyX = 0.16;
          headX = 0.5;
          bodyZ = k * 0.06;
        } else if (cyc < 0.85) {
          headX = 0.95 + 0.4 * Math.max(0, Math.sin(t * 19));
          bodyX = 0.24;
        } else {
          headX = -0.1;
          headY = v.yaw * 0.8;
          headZ = v.tilt;
        }
        break;
      }
      case 'drink': {
        // le bec trempe dans l'eau, puis la tête se relève pour avaler
        const cyc = (t * 0.75) % 1;
        if (cyc < 0.4) {
          headX = feed ? feed.head + 0.06 : 1.15;
          bodyX = feed ? feed.body : 0.22;
        } else {
          headX = -0.75; // tête levée pour avaler
          bodyX = -0.02;
        }
        break;
      }
      case 'preen': {
        const side = Math.sin(v.phase * 3) > 0 ? 1 : -1;
        headY = side * 1.75 + Math.sin(t * 22) * 0.06;
        headX = 0.5;
        headZ = side * 0.3;
        wingLift = side;
        break;
      }
      case 'flap': {
        wing = 0.6 + Math.sin(t * 24) * 0.55;
        bodyY = 0.02;
        headX = -0.35;
        bodyX = -0.18;
        break;
      }
      case 'rest':
        sit = 1;
        fluff = 1.07;
        headX = 0.15 + Math.sin(t * 0.7) * 0.05;
        headY = v.yaw * 0.5;
        break;
      case 'lay':
        sit = 1;
        fluff = 1.05;
        bodyZ = Math.sin(t * 9) * 0.05 * (Math.sin(t * 1.3) > 0.4 ? 1 : 0.15);
        headX = -0.2;
        headY = v.yaw * 0.4;
        break;
      case 'worms': {
        // elle gratte puis pique du bec dans le compost
        const cyc = (t * 0.9) % 1;
        if (cyc < 0.35) {
          const k = Math.sin(t * 10);
          legL = -Math.max(0, k) * 0.95;
          legR = -Math.max(0, -k) * 0.95;
          bodyX = 0.18;
          headX = 0.55;
          if (Math.random() < dt * 6) this.particles.burst(x + Math.sin(heading) * 0.2, 0.16, z + Math.cos(heading) * 0.2, 0x5a4029, 2, { speed: 0.5, up: 0.7, size: 0.5, life: 0.5 });
        } else {
          headX = 0.95 + 0.4 * Math.max(0, Math.sin(t * 19));
          bodyX = 0.24;
        }
        break;
      }
      case 'fight': {
        // combat de coqs : collerette hérissée, bonds ailes battantes, coups de bec et d'ergots
        const hop = Math.max(0, Math.sin(t * 7 + v.phase));
        bodyY = hop * 0.11;
        wing = 0.35 + Math.sin(t * 22) * (hop > 0.2 ? 0.45 : 0.12);
        bodyX = 0.2 - hop * 0.3;
        headX = 0.25 + Math.sin(t * 11) * 0.3;
        headY = 0;
        headZ = 0;
        if (hop > 0.3) {
          legL = -0.9 * hop;
          legR = -0.7 * hop;
        }
        fluff = 1.13;
        if (hop > 0.6 && Math.random() < dt * 5) this.particles.burst(x, 0.38, z, BREEDS[h.breed].look.body, 2, { speed: 0.9, up: 1.2, gravity: 1.2, size: 0.75, life: 1.2 });
        break;
      }
      case 'flee':
        // course paniquée, ailes à demi ouvertes
        wing = 0.45 + Math.sin(t * 26) * 0.3;
        headX = -0.2;
        bodyX = 0.1;
        break;
      case 'caught':
        wing = 0.95 + Math.sin(t * 30) * 0.6;
        bodyZ = Math.sin(t * 24) * 0.35;
        headX = -0.9 + Math.sin(t * 18) * 0.3;
        legL = Math.sin(t * 20) * 0.8;
        legR = -legL;
        if (Math.random() < dt * 9) this.particles.burst(x, 0.35, z, BREEDS[h.breed].look.body, 2, { speed: 0.8, up: 1.1, gravity: 1.2, size: 0.8, life: 1.2 });
        break;
      case 'bathe':
        sit = 1.3;
        bodyZ = Math.sin(t * 15) * 0.14;
        bodyX = Math.sin(t * 9) * 0.1;
        wing = 0.55 + Math.sin(t * 18) * 0.35;
        headX = 0.3;
        if (Math.random() < dt * 7) this.particles.burst(x, 0.15, z, 0xe2cf9e, 2, { speed: 0.6, up: 0.9, size: 0.6, life: 0.6 });
        break;
      default:
        if (!walking) {
          headY = v.yaw;
          headZ = v.tilt;
          headX = 0.0;
        }
    }
    // clignement des yeux : un battement rapide toutes les 2 à 6 s, parfois double ;
    // au repos ou en couvant, les paupières restent mi-closes
    v.blinkT -= dt;
    if (v.blinkT <= -0.16) v.blinkT = Math.random() < 0.2 ? 0.25 : 2 + Math.random() * 4;
    const blinking = v.blinkT < 0 ? Math.sin((-v.blinkT / 0.16) * Math.PI) : 0;
    const drowsy = h.act === 'rest' || h.act === 'lay' ? 0.45 : 0;
    v.eyeOpen = Math.max(0.06, 1 - drowsy - blinking * (1 - drowsy));
    // respiration : la poitrine se soulève doucement quand elle ne marche pas
    if (!walking) fluff *= 1 + Math.sin(t * 2.3) * 0.012;
    // sur la rampe : le corps suit la pente (tête vers le haut en montant, vers le bas en descendant)
    if (coopWay && coopWay.slope) {
      const up = h.act === 'enter' ? 1 : -1;
      bodyX -= coopWay.slope * 0.75 * up;
      headX -= coopWay.slope * 0.35 * up;
    }
    const k = Math.min(1, dt * 16);
    const kh = Math.min(1, dt * 22);
    const bp = v.bodyPivot;
    bp.position.y += (HEN_PIVOT.body + bodyY - sit * 0.1 - bp.position.y) * k;
    bp.rotation.x += (bodyX - bp.rotation.x) * k;
    bp.rotation.z += (bodyZ - bp.rotation.z) * k;
    bp.scale.setScalar(fluff);
    const hp = v.headPivot;
    hp.rotation.x += (headX - hp.rotation.x) * kh;
    hp.rotation.y += (headY - hp.rotation.y) * kh;
    hp.rotation.z += (headZ - hp.rotation.z) * kh;
    hp.position.z += (HEN_PIVOT.neck[2] + headFwd - hp.position.z) * kh;
    hp.position.y = HEN_PIVOT.neck[1] - HEN_PIVOT.body - sit * 0.025;
    const wl = wing + (wingLift > 0 ? 0.35 : 0);
    const wr = wing + (wingLift < 0 ? 0.35 : 0);
    v.wingL.rotation.z += (-wl - v.wingL.rotation.z) * kh;
    v.wingR.rotation.z += (wr - v.wingR.rotation.z) * kh;
    v.wingL.rotation.y = v.wingR.rotation.y = 0;
    const legScale = Math.max(0.01, 1 - sit * 0.95);
    v.legL.rotation.x = legL;
    v.legR.rotation.x = legR;
    v.legL.scale.y = v.legR.scale.y = legScale;
  }


  // ---------------------------------------------------------------- Œufs ----
  private syncEggs(s: GameState) {
    const seen = new Set<number>();
    for (const e of s.worldEggs) {
      if (e.where !== 'ground') continue;
      seen.add(e.id);
      let m = this.eggs.get(e.id);
      if (!m) {
        m = new THREE.Mesh(eggGeometry(e.type), EGG_MAT);
        m.castShadow = true;
        m.userData.eggId = e.id;
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.eggId = e.id;
        m.add(hit);
        m.rotation.set(0.3 + hash(e.id) * 0.5, hash(e.id * 3) * 6, 0.2);
        this.eggsG.add(m);
        this.eggs.set(e.id, m);
      }
      const age = s.clock.t - e.laidAt;
      const pop = age < 0.6 ? 0.3 + Math.sin((age / 0.6) * Math.PI * 0.5) * 0.9 : 1;
      const days = age / TIME.DAY;
      // l'œuf d'or ne s'abîme pas : il brille toujours
      m.material = e.type === 'phenix' ? PHOENIX_EGG_MAT : e.type === 'or' ? GOLD_EGG_MAT : days > 0.8 ? EGG_ROT_MAT : days > FRESHNESS.groundWarnDays ? EGG_STALE_MAT : EGG_MAT;
      m.position.set(e.x, GRASS_TOP + 0.02 + Math.sin(this.time * 3 + e.id) * 0.0, e.z);
      m.scale.setScalar(pop * 1.25);
    }
    for (const [id, m] of this.eggs) {
      if (!seen.has(id)) {
        this.particles.burst(m.position.x, 0.2, m.position.z, 0xfff3c4, 8, { speed: 0.7, up: 1.6, size: 0.7 });
        this.eggsG.remove(m);
        this.eggs.delete(id);
      }
    }
  }

  // ------------------------------------------------------------- Clients ----
  /** Vue d'une volaille dessinée hors du troupeau (mêmes taille et teinte que dans la ferme). */
  private birdView(h: Hen): HenState {
    return { ...createHenView(h.breed, h.id), breed: h.breed, key: henKey(h), walk: 0, vis: 1, spawn: 1, yawT: 0, yaw: 0, tilt: 0, y: GRASS_TOP, blinkT: 1 + Math.random() * 4, stamp: 0, drawnFar: false, ship: false };
  }

  /** Les volailles en vente : chacune dans le parc de son espèce, elles se promènent, picorent, grattent. */
  private syncPetBirds(s: GameState, dt: number, draw: (h: Hen, v: HenState) => void) {
    const shop = s.buildings.find((b) => b.type === 'petshop');
    const seen = new Set<number>();
    if (shop) {
      const L = petLayout(shop.level);
      const hour = currentHour(s);
      const night = hour < 6.4 || hour > 20.6;
      const shown = { hens: 0, geese: 0 };
      // la file devant chaque trappe, dans l'ordre où elles vont partir
      const waiting = { hens: 0, geese: 0 };
      const ranks = new Map<number, number>();
      if (s.birdLoad?.henIds.length) {
        const byId = new Map(s.petShop.birds.map((h) => [h.id, h]));
        for (const id of s.birdLoad.henIds) {
          const h = byId.get(id);
          if (h) ranks.set(id, isGoose(h.breed) ? waiting.geese++ : waiting.hens++);
        }
      }
      for (const h of s.petShop.birds) {
        const goose = isGoose(h.breed);
        const pen = goose ? L.geese : L.hens;
        // on n'en dessine que ce que le parc peut montrer sans qu'elles se montent dessus
        const room = Math.floor((pen.x1 - pen.x0) * (pen.z1 - pen.z0) * (goose ? 1.1 : 3));
        if ((goose ? shown.geese : shown.hens) >= room) continue;
        if (goose) shown.geese++;
        else shown.hens++;
        seen.add(h.id);
        // (elles restent devant les cabanes, en bas du parc)
        const m = 0.35;
        const pick = (k: number): [number, number] => [PET_POS.x + pen.x0 + m + hash(k * 1.7 + h.id) * (pen.x1 - pen.x0 - 2 * m), PET_POS.z + pen.z0 + 0.95 + hash(k * 2.3 + h.id * 3) * (pen.z1 - pen.z0 - 0.95 - m)];
        let b = this.petBirds.get(h.id);
        if (!b) {
          const [x, z] = pick(1);
          const hen: Hen = { ...h, x, z, heading: hash(h.id) * 6.28, act: 'idle', actT: 0, targetId: -1 };
          b = { hen, view: this.birdView(hen), tx: x, tz: z, wait: hash(h.id * 7) * 3, k: 2 };
          this.petBirds.set(h.id, b);
        }
        const g = b.hen;
        // la boutique a grandi et les parcs se sont décalés : on la retrouve dans le sien
        if (g.x < PET_POS.x + pen.x0 || g.x > PET_POS.x + pen.x1 || g.z < PET_POS.z + pen.z0 || g.z > PET_POS.z + pen.z1) {
          [g.x, g.z] = pick(b.k);
          b.tx = g.x;
          b.tz = g.z;
        }
        b.wait -= dt;
        // réservée pour le camion : elle va attendre son tour près de la trappe
        if (h.ship) {
          const [gx, gz] = penGate(shop.level, goose);
          // en rangs devant les cabanes, sans se monter dessus : la prochaine à partir est la plus près de la trappe
          const sp = goose ? 1.15 : 0.8;
          const n = goose ? waiting.geese : waiting.hens;
          const rank = ranks.get(h.id) ?? 0;
          const px0 = PET_POS.x + pen.x0 + 0.25;
          const px1 = PET_POS.x + pen.x1 - 0.25;
          const rows = Math.max(1, Math.floor((pen.z1 - pen.z0 - 1.85) / sp) + 1);
          const cols = Math.max(1, Math.min(Math.floor((px1 - px0) / sp) + 1, Math.max(Math.ceil(Math.sqrt(n * 2)), Math.ceil(n / rows))));
          const col = rank % cols;
          const side = Math.floor(cols / 2) * sp;
          const mid = clamp(gx, px0 + side, Math.max(px0 + side, px1 - side));
          b.tx = clamp(mid + (col % 2 ? (col + 1) / 2 : -col / 2) * sp, px0, px1);
          b.tz = gz + 1.6 + (Math.floor(rank / cols) % rows) * sp;
        }
        const r = rtHen(g);
        const dx = b.tx - g.x;
        const dz = b.tz - g.z;
        const d = Math.hypot(dx, dz);
        if (night && !h.ship) {
          g.act = 'rest';
          r.spd = 0;
        } else if (d > 0.05) {
          g.act = 'walk';
          const step = Math.min(d, dt * (h.ship ? 0.9 : 0.5));
          g.x += (dx / d) * step;
          g.z += (dz / d) * step;
          let dh = Math.atan2(dx, dz) - g.heading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          g.heading += clamp(dh, -6 * dt, 6 * dt);
          r.spd = 0.5;
        } else {
          r.spd = 0;
          if (g.act === 'walk' || g.act === 'rest') g.act = 'idle';
          if (b.wait <= 0) {
            b.k++;
            const next = hash(b.k * 1.3 + h.id);
            if (next < 0.42) [b.tx, b.tz] = pick(b.k);
            else g.act = next < 0.72 ? 'peck' : next < 0.84 ? 'scratch' : next < 0.92 ? 'preen' : 'idle';
            b.wait = 1.5 + hash(b.k * 3.1 + h.id) * 4;
          }
        }
        r.px = g.x;
        r.pz = g.z;
        r.ph = g.heading;
        draw(g, b.view);
      }
    }
    for (const id of this.petBirds.keys()) if (!seen.has(id)) this.petBirds.delete(id);
  }

  /** Le vendeur de poules : devant la boutique, au bout de l'auvent ; il rejoint le client qu'on sert. */
  private syncPetSeller(s: GameState, dt: number) {
    const shop = s.buildings.find((b) => b.type === 'petshop');
    const hired = !!shop && !!s.petShop.seller;
    if (hired && !this.petSeller) {
      const L = petLayout(shop!.level);
      this.petSeller = createWorkerView('seller', ROLES.seller.outfit, 41, false);
      this.petSeller.root.position.set(L.cx + L.gap * L.counters * 0.5 + 1.1, 0.06, PET_POS.z + 4.1);
      this.peopleG.add(this.petSeller.root);
    } else if (!hired && this.petSeller) {
      this.peopleG.remove(this.petSeller.root);
      this.petSeller = null;
    }
    if (this.petSeller) {
      const L = petLayout(shop!.level);
      const c = s.petCustomers.find((o) => o.state === 'shopping' && (o.counter ?? -1) >= 0);
      const tx = c ? L.cx + (c.counter! - (L.counters - 1) / 2) * L.gap + 0.55 : L.cx + L.gap * L.counters * 0.5 + 1.1;
      const tz = c ? L.stopZ - 0.1 : PET_POS.z + 4.1;
      const p = this.petSeller.root.position;
      const dx = tx - p.x;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      const moving = d > 0.04;
      if (moving) {
        const step = Math.min(d, dt * 1.6);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        this.petSeller.root.rotation.y = Math.atan2(dx, dz);
      } else this.petSeller.root.rotation.y = c ? -Math.PI / 2 : Math.PI * 0.15;
      const sw = moving ? Math.sin(this.time * 9) * 0.5 : 0;
      this.petSeller.legL.rotation.x = sw;
      this.petSeller.legR.rotation.x = -sw;
    }
  }

  private syncPeople(s: GameState, dt: number) {
    this.syncPetSeller(s, dt);
    const seen = new Set<number>();
    for (const c of s.petCustomers) {
      // client de la vente de poules : il arrive avec son carton sous le bras, et repart avec une tête qui dépasse
      let v = this.people.get(c.id);
      if (!v) {
        v = { ...createPerson(c.look), px: c.x, pz: c.z, phase: Math.random() * 6 };
        v.root.position.set(c.x, 0.05, c.z);
        const carton = mesh(cartonBox(), true, false);
        const head = mesh(cartonHead(), false, false);
        const holder = new THREE.Group();
        holder.position.set(0, 0.52, 0.17);
        holder.add(carton, head);
        head.visible = false;
        v.carton = head;
        v.root.add(holder);
        this.peopleG.add(v.root);
        this.people.set(c.id, v);
      }
      if (v.carton) v.carton.visible = c.bought > 0;
    }
    for (const c of [...s.customers, ...s.petCustomers]) {
      seen.add(c.id);
      let v = this.people.get(c.id);
      if (!v) {
        v = { ...createPerson(c.look), px: c.x, pz: c.z, phase: Math.random() * 6 };
        v.root.position.set(c.x, 0.05, c.z);
        this.peopleG.add(v.root);
        this.people.set(c.id, v);
      }
      const k = 1 - Math.exp(-dt * 16);
      const nx = v.root.position.x + (c.x - v.root.position.x) * k;
      const nz = v.root.position.z + (c.z - v.root.position.z) * k;
      const dx = nx - v.root.position.x;
      const dz = nz - v.root.position.z;
      const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
      if (sp > 0.05) v.root.rotation.y = Math.atan2(dx, dz);
      else if (c.state === 'shopping') v.root.rotation.y = Math.PI;
      // dans la file, on regarde vers le guichet (en trépignant un peu quand ça traîne)
      else if (c.state === 'queue') v.root.rotation.y = -Math.PI / 2 - 0.25 + ((c.wait ?? 0) > (c.patience ?? 12) * 0.55 ? Math.sin(this.time * 3 + v.phase) * 0.35 : 0);
      v.root.position.set(nx, 0.05, nz);
      const sw = sp > 0.1 ? Math.sin(this.time * 9 + v.phase) * 0.5 : 0;
      v.legL.rotation.x = sw;
      v.legR.rotation.x = -sw;
      v.basket.visible = !v.carton && c.bought > 0 && c.state !== 'toStand' && c.state !== 'queue';
    }
    for (const [id, v] of this.people) {
      if (!seen.has(id)) {
        this.peopleG.remove(v.root);
        this.people.delete(id);
      }
    }
  }

  // ---------------------------------------------------------- Prédateurs ----
  private syncPredators(s: GameState, dt: number) {
    const seen = new Set<number>();
    for (const p of s.predators) {
      seen.add(p.id);
      let v = this.preds.get(p.id);
      if (!v) {
        v = { ...createPredatorView(p.species), alive: true };
        v.px = p.x;
        v.pz = p.z;
        v.py = p.y;
        v.root.rotation.y = p.heading;
        this.predG.add(v.root, v.ring, v.shadow);
        this.preds.set(p.id, v);
        // le renard surgit des hautes herbes
        if (p.species === 'fox') this.particles.burst(p.x, 0.25, p.z, 0x9fcd62, 12, { speed: 0.9, up: 1.4 });
      }
      this.animatePredator(p, v, dt);
    }
    for (const [id, v] of this.preds) {
      if (!seen.has(id)) {
        this.predG.remove(v.root, v.ring, v.shadow);
        this.preds.delete(id);
      }
    }
  }

  private animatePredator(p: Predator, v: PredatorView & { alive: boolean }, dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    v.px += (p.x - v.px) * k;
    v.pz += (p.z - v.pz) * k;
    v.py += (p.y - v.py) * k;
    let dh = p.heading - v.root.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    v.root.rotation.y += dh * Math.min(1, dt * (p.species === 'hawk' ? 6 : 10));
    const t = this.time + v.phase;
    const alive = p.state !== 'dead';
    v.alive = alive;
    const kk = Math.min(1, dt * 12);
    // proie emportée
    if (p.carrying && !v.prey) {
      v.prey = preyModel(p.carrying);
      if (p.species === 'hawk') {
        // suspendue sous les serres
        const hen = v.prey.children[0];
        hen.rotation.set(0.25, 0, 0);
        hen.position.set(0, -0.36, 0);
      }
      v.mouth.add(v.prey);
    } else if (!p.carrying && v.prey) {
      v.mouth.remove(v.prey);
      v.prey = null;
    }
    // anneau de danger : pulse sous le prédateur vivant
    v.ring.visible = alive;
    v.ring.position.set(v.px, GRASS_TOP + 0.025, v.pz);
    v.ring.scale.setScalar((p.species === 'hawk' ? 1.25 : 1) * (1 + Math.sin(t * 7) * 0.12));
    (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 7) * 0.3;
    // disparition du cadavre
    const fade = p.state === 'dead' && p.t < 1 && (p.species === 'fox' || p.y <= 0.13) ? Math.max(0.001, p.t) : 1;
    v.root.scale.setScalar(fade);

    if (p.species === 'fox') {
      // par-dessus le grillage d'un bond souple
      const vlt = vaultOf(p);
      const vk = vlt ? Math.min(1, vlt.t / vlt.dur) : -1;
      v.root.position.set(v.px, GRASS_TOP + (vk >= 0 ? Math.sin(Math.PI * vk) * 0.95 : 0), v.pz);
      v.root.rotation.x = vk >= 0 ? -Math.cos(Math.PI * vk) * 0.55 : 0;
      v.shadow.visible = false;
      const run = p.state === 'chase' || p.state === 'flee' || p.state === 'carry';
      const moving = alive && p.spd > 0.05 && p.state !== 'grab' && !((p.state === 'raid' || p.state === 'prowl') && p.t >= 0);
      let bodyY = 0.3;
      let bodyX = 0;
      let bodyZ = 0;
      let headX = 0;
      let headY = 0;
      let tailX = 0.35;
      let tailY = Math.sin(t * 3) * 0.25;
      let rollZ = 0;
      const legs = [0, 0, 0, 0];
      if (moving) {
        v.gait += p.spd * dt * (run ? 5.5 : 8.5);
        const g = v.gait;
        if (run) {
          // galop : pattes avant ensemble, puis pattes arrière
          legs[0] = legs[1] = Math.sin(g) * 0.95;
          legs[2] = legs[3] = Math.sin(g + Math.PI) * 0.95;
          bodyX = Math.sin(g) * 0.1;
          bodyY += Math.abs(Math.cos(g)) * 0.04;
          tailX = 0.05;
          tailY = Math.sin(g * 0.5) * 0.1;
        } else {
          // trot : diagonales alternées
          legs[0] = legs[3] = Math.sin(g) * 0.6;
          legs[1] = legs[2] = -Math.sin(g) * 0.6;
          bodyY += Math.abs(Math.cos(g)) * 0.015;
        }
      }
      if (p.state === 'stalk' && alive) {
        // à l'affût, ventre au ras de l'herbe
        bodyY -= 0.07;
        headX = 0.3;
        tailX = 0.0;
      } else if (p.state === 'approach' && !moving) {
        // tapi à la lisière : il observe
        headY = Math.sin(t * 0.9) * 0.6;
        headX = -0.1;
      } else if (p.state === 'grab') {
        headY = Math.sin(t * 22) * 0.45;
        bodyZ = Math.sin(t * 22) * 0.06;
        tailY = Math.sin(t * 9) * 0.5;
        if (Math.random() < dt * 10) this.particles.burst(v.px + Math.sin(v.root.rotation.y) * 0.5, 0.35, v.pz + Math.cos(v.root.rotation.y) * 0.5, 0xf6f1e7, 2, { speed: 0.9, up: 1.2, gravity: 1.2, life: 1.2 });
      } else if ((p.state === 'raid' || p.state === 'prowl') && p.t >= 0) {
        // museau dans la trappe : il gratte et renifle
        headX = p.state === 'raid' ? 0.15 : 0.35 + Math.sin(t * 6) * 0.2;
        bodyY -= 0.04;
        legs[0] = Math.max(0, Math.sin(t * 10)) * -0.9;
        tailY = Math.sin(t * 7) * 0.45;
        if (p.state === 'raid' && Math.random() < dt * 6) this.particles.burst(v.px + Math.sin(v.root.rotation.y) * 0.3, 0.4, v.pz + Math.cos(v.root.rotation.y) * 0.3, 0xf6f1e7, 2, { speed: 0.8, up: 1.4, gravity: 1.2, life: 1.1 });
      } else if (!alive) {
        // abattu : couché sur le flanc
        rollZ = Math.PI / 2;
        bodyY = 0.16;
        legs[0] = legs[1] = 0.3;
        legs[2] = legs[3] = -0.3;
        tailX = 0;
        tailY = 0;
      }
      v.root.rotation.z += (rollZ - v.root.rotation.z) * kk;
      v.body.position.y += (bodyY - v.body.position.y) * kk;
      v.body.rotation.x += (bodyX - v.body.rotation.x) * kk;
      v.body.rotation.z = bodyZ;
      v.head.rotation.x += (headX - v.head.rotation.x) * kk;
      v.head.rotation.y += (headY - v.head.rotation.y) * Math.min(1, dt * 20);
      v.tail.rotation.x += (tailX - v.tail.rotation.x) * kk;
      v.tail.rotation.y += (tailY - v.tail.rotation.y) * kk;
      if (vk >= 0) {
        // pattes avant tendues vers l'avant, pattes arrière poussées vers l'arrière
        legs[0] = legs[1] = -1.1;
        legs[2] = legs[3] = 1.0;
      }
      v.legs.forEach((l, i) => (l.rotation.x = legs[i]));
      return;
    }

    // ---- buse ----
    const y = alive ? v.py : p.y;
    v.root.position.set(v.px, GRASS_TOP + y, v.pz);
    v.shadow.visible = y > 0.25;
    v.shadow.position.set(v.px, GRASS_TOP + 0.015, v.pz);
    v.shadow.scale.setScalar(0.7 + 0.5 * Math.max(0, 1 - y / 9));
    (v.shadow.material as THREE.MeshBasicMaterial).opacity = 0.26 * Math.max(0.25, 1 - y / 12);
    let wingZ = 0.12;
    let wingY = 0;
    let pitch = 0;
    let roll = 0;
    let tailX = 0;
    let claws = 0.6;
    switch (p.state) {
      case 'arrive':
      case 'circle': {
        // vol plané, quelques battements de temps en temps
        const flap = Math.sin(t * 0.6) > 0.8 ? Math.sin(t * 13) * 0.55 : Math.sin(t * 1.3) * 0.06;
        wingZ = 0.1 + flap;
        roll = p.state === 'circle' ? -0.38 : 0;
        claws = 0.9;
        break;
      }
      case 'dive':
        // ailes repliées en arrière, piqué
        wingZ = 0.35;
        wingY = -0.95;
        pitch = 0.75;
        claws = -0.4;
        break;
      case 'grab':
        // ailes déployées en manteau sur la proie
        wingZ = 0.25 + Math.sin(t * 16) * 0.45;
        pitch = 0.15;
        tailX = -0.3;
        claws = -0.2;
        if (Math.random() < dt * 9) this.particles.burst(v.px, 0.3, v.pz, 0xf6f1e7, 2, { speed: 0.9, up: 1.2, gravity: 1.2, life: 1.2 });
        break;
      case 'carry':
      case 'flee':
      case 'leave':
        wingZ = Math.sin(t * (p.state === 'carry' ? 11 : 13)) * 0.8;
        pitch = -0.25;
        claws = p.state === 'carry' ? -0.2 : 0.9;
        break;
      case 'dead':
        if (p.y > 0.13) {
          wingZ = -0.5 + Math.sin(t * 20) * 0.2;
          pitch = 0.9;
        } else {
          wingZ = -0.05;
          pitch = 0;
          roll = 0.25;
        }
        break;
    }
    v.root.rotation.z += (roll - v.root.rotation.z) * Math.min(1, dt * 3);
    v.body.rotation.x += (pitch - v.body.rotation.x) * kk;
    v.wings[0].rotation.z += (wingZ - v.wings[0].rotation.z) * Math.min(1, dt * 18);
    v.wings[1].rotation.z += (-wingZ - v.wings[1].rotation.z) * Math.min(1, dt * 18);
    v.wings[0].rotation.y += (wingY - v.wings[0].rotation.y) * kk;
    v.wings[1].rotation.y += (-wingY - v.wings[1].rotation.y) * kk;
    v.tail.rotation.x += (tailX - v.tail.rotation.x) * kk;
    for (const l of v.legs) l.rotation.x += (claws - l.rotation.x) * kk;
  }

  // ------------------------------------------------------------- Robots ----
  private syncRobots(s: GameState, dt: number) {
    const seen = new Set<number>();
    for (const r of s.robots) {
      seen.add(r.id);
      let v = this.robots.get(r.id);
      if (!v) {
        v = createRobotView();
        v.px = r.x;
        v.pz = r.z;
        v.root.rotation.y = r.heading;
        this.robotsG.add(v.root, v.dock);
        this.robots.set(r.id, v);
        this.particles.burst(r.x, 0.3, r.z, 0xffffff, 12, { speed: 1, up: 1.4 });
      }
      const k = 1 - Math.exp(-dt * 14);
      const ox = v.px;
      const oz = v.pz;
      v.px += (r.x - v.px) * k;
      v.pz += (r.z - v.pz) * k;
      const moving = Math.hypot(v.px - ox, v.pz - oz) / Math.max(dt, 1e-3) > 0.05;
      let dh = r.heading - v.root.rotation.y;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.root.rotation.y += dh * Math.min(1, dt * 10);
      const t = this.time + v.phase;
      v.root.position.set(v.px, GRASS_TOP + (moving ? Math.abs(Math.sin(t * 18)) * 0.004 : 0), v.pz);
      v.brush.rotation.y += dt * (moving ? 18 : 2);
      // bac : les œufs ramassés y apparaissent
      const n = r.hopper.reduce((a, l) => a + l.count, 0);
      const shown = Math.min(v.eggs.length, Math.ceil(n / 4));
      v.eggs.forEach((e, i) => (e.visible = i < shown));
      // voyant : vert qui respire en charge, bleu en tournée, rouge si batterie faible
      const charging = r.task === 'dock' && !r.path.length;
      const col = r.battery < 18 && !charging ? 0xff4d4d : charging ? 0x48d47a : 0x3aa0ff;
      v.ledMat.color.setHex(col);
      v.led.scale.setScalar(charging ? 0.8 + Math.sin(t * 3) * 0.3 : moving ? 1 : 0.9 + Math.sin(t * 8) * 0.1);
      if (moving && Math.random() < dt * 3) this.particles.burst(v.px, 0.12, v.pz, 0xd9c28f, 1, { speed: 0.3, up: 0.3, size: 0.4, life: 0.5 });
      // sa borne, le long du stockage : colonne côté bâtiment, balise verte quand il charge
      const [dx, dz, nx, nz] = dockOf(s, r);
      v.dock.position.set(dx, GRASS_TOP, dz);
      v.dock.rotation.y = Math.atan2(nx, nz);
      v.dockLedMat.color.setHex(charging ? 0x48d47a : r.battery < 18 ? 0xff4d4d : 0x3aa0ff);
      v.dockLedMat.color.multiplyScalar(charging ? 0.75 + Math.sin(t * 3) * 0.25 : 0.7);
    }
    for (const [id, v] of this.robots) {
      if (!seen.has(id)) {
        this.robotsG.remove(v.root, v.dock);
        this.robots.delete(id);
      }
    }
  }

  // --------------------------------------------------------------- Chien ----
  private syncDog(s: GameState, dt: number) {
    // sans chien de garde, c'est le chien de la maison qui somnole devant le perron
    const d = s.dog ?? { x: HOUSE_DOG[0], z: HOUSE_DOG[1], heading: 0.6, act: 'sleep' as const, spd: 0 };
    let v = this.dogView;
    if (!v) {
      v = this.dogView = createDogView();
      v.px = d.x;
      v.pz = d.z;
      v.root.rotation.y = d.heading;
      this.scene.add(v.root, v.kennel);
    }
    const [kx, kz] = kennelPoint(s);
    v.kennel.position.set(kx, GRASS_TOP, kz);
    // replacé d'un coup (enclos agrandi sous ses pattes) : il saute à sa place au lieu de glisser
    // à travers le grillage
    if (Math.hypot(d.x - v.px, d.z - v.pz) > 1.2) {
      v.px = d.x;
      v.pz = d.z;
    }
    const k = 1 - Math.exp(-dt * 14);
    v.px += (d.x - v.px) * k;
    v.pz += (d.z - v.pz) * k;
    let dh = d.heading - v.root.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    v.root.rotation.y += dh * Math.min(1, dt * 10);
    const run = d.act === 'chase' && d.spd > 0.3;
    const walk = !run && d.spd > 0.05;
    if (run) v.gait += dt * 15;
    else if (walk) v.gait += dt * (6 + d.spd * 3);
    const act = run ? 'run' : walk ? 'walk' : d.act === 'sit' ? 'sit' : d.act === 'sleep' ? 'sleep' : 'stand';
    v.root.position.set(v.px, GRASS_TOP, v.pz);
    applyDogPose(v, dogPose(act, this.time, v.gait), Math.min(1, dt * 6), Math.min(1, dt * (run || walk ? 22 : 6)));
  }

  dogRoot() {
    return this.dogView?.root ?? null;
  }

  robotRoot(id: number) {
    return this.robots.get(id)?.root ?? null;
  }

  /** Position affichée d'un prédateur (étiquette, caméra). */
  predatorPosition(id: number) {
    const v = this.preds.get(id);
    return v ? v.root.position : null;
  }

  /** Bout du canon d'un salarié qui tire (éclair de bouche). */
  muzzleOf(workerId: number): THREE.Vector3 | null {
    const v = this.staff.get(workerId);
    if (!v || !v.tools.rifle.visible) return null;
    v.root.updateMatrixWorld(true);
    return v.muzzle.getWorldPosition(new THREE.Vector3());
  }

  /** Secousse de caméra (tir du joueur). */
  shake(seconds = 0.22) {
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  // ------------------------------------------------------------ Salariés ----
  private syncStaff(s: GameState, dt: number) {
    const seen = new Set<number>();
    const hourNow = currentHour(s);
    for (const w of s.workers) {
      if (!w.onSite) continue;
      seen.add(w.id);
      let v = this.staff.get(w.id);
      if (!v) {
        v = { ...createWorkerView(w.role, ROLES[w.role].outfit, w.look, femName(w.name)), walk: 0, role: w.role, sweepT: -1 };
        v.root.position.set(w.x, 0.05, w.z);
        v.root.rotation.y = w.heading;
        this.staffG.add(v.root);
        this.staff.set(w.id, v);
      }
      const k = 1 - Math.exp(-dt * 16);
      const ox = v.root.position.x;
      const oz = v.root.position.z;
      v.root.position.x += (w.x - ox) * k;
      v.root.position.z += (w.z - oz) * k;
      const spd = Math.hypot(v.root.position.x - ox, v.root.position.z - oz) / Math.max(dt, 1e-3);
      let dh = w.heading - v.root.rotation.y;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.root.rotation.y += dh * Math.min(1, dt * 10);
      const t = this.time + v.phase;
      const job = w.job;
      const working = job?.phase === 'work';
      let legA = 0;
      let armL = 0;
      let armR = 0;
      let armRz = 0;
      let torsoX = 0;
      let headY = 0;
      let crouch = 0;
      let armLz = 0;
      // pieds posés sur l'herbe dans la ferme, sur le chemin ailleurs
      const cx = Math.floor(v.root.position.x);
      const cz = Math.floor(v.root.position.z);
      let y = inGrid(cx, cz) && s.parcels.includes(parcelKeyOfCell(cx, cz)) ? GRASS_TOP : 0.065;
      for (const o of Object.values(v.tools)) o.visible = false;
      // la nuit, lanterne à la main et halo au sol
      const dark = hourNow >= 20.3 || hourNow < 6.2;
      v.tools.lantern.visible = dark;
      v.glow.visible = dark;
      if (dark) {
        // flamme vivante : la flaque de lumière respire légèrement
        const f = 0.95 + Math.sin((this.time + v.phase) * 11) * 0.025 + Math.sin((this.time + v.phase) * 6.7) * 0.025;
        v.glow.scale.set(f, f * 1.18, 1);
      }
      if (spd > 0.12) {
        v.walk += spd * dt * 6.5;
        legA = Math.sin(v.walk) * 0.6;
        armL = -legA * 0.8;
        armR = legA * 0.8;
        y += Math.abs(Math.cos(v.walk)) * 0.025;
        if (w.basket.length && w.role === 'farmhand') {
          v.tools.basket.visible = true;
          armR = -0.35;
        }
      } else if (working && job) {
        const front = (d: number) => [v.root.position.x + Math.sin(v.root.rotation.y) * d, v.root.position.z + Math.cos(v.root.rotation.y) * d] as const;
        switch (job.kind) {
          case 'collectNest':
          case 'collectGround':
          case 'deposit':
            torsoX = 0.7;
            armL = armR = -0.95 + Math.sin(t * 6) * 0.15;
            v.tools.basket.visible = true;
            break;
          case 'refillFeeder': {
            v.tools.sack.visible = true;
            torsoX = 0.25;
            armL = armR = -1.25 + Math.sin(t * 5) * 0.1;
            if (Math.random() < dt * 8) {
              const [fx, fz] = front(0.55);
              this.particles.burst(fx, 0.45, fz, 0xe2b752, 2, { speed: 0.3, up: 0.2, size: 0.45, life: 0.5, gravity: 3 });
            }
            break;
          }
          case 'refillDrinker':
          case 'water': {
            v.tools[job.kind === 'water' ? 'can' : 'bucket'].visible = true;
            torsoX = 0.2;
            armR = -1.2 + Math.sin(t * 3) * 0.08;
            armRz = -0.25;
            if (Math.random() < dt * 14) {
              const [fx, fz] = front(0.55);
              this.particles.burst(fx, 0.4, fz, 0x7cc7ee, 2, { speed: 0.25, up: 0.1, size: 0.4, life: 0.5, gravity: 4 });
            }
            break;
          }
          case 'clean': {
            // la pose du balai (mains sur le manche, brosse au sol) est calculée après coup par poseSweep
            v.tools.broom.visible = true;
            crouch = 0.12;
            torsoX = 0.3;
            headY = 0;
            break;
          }
          case 'loadTruck':
            // bras en avant, il agite les mains pour faire avancer les volailles vers la rampe
            crouch = 0.12;
            torsoX = 0.14;
            armL = -1.25 + Math.sin(t * 5.5) * 0.4;
            armR = -1.25 - Math.sin(t * 5.5) * 0.4;
            break;
          case 'heal':
            crouch = 1;
            v.tools.kit.visible = true;
            torsoX = 0.45;
            armL = -1.0 + Math.sin(t * 4) * 0.15;
            armR = -0.9;
            break;
          case 'stand': {
            const someone = s.customers.some((c) => c.state === 'shopping');
            armL = armR = someone ? -0.55 : -0.3;
            if (someone && Math.sin(t * 2) > 0.6) armR = -2.4 + Math.sin(t * 12) * 0.25; // salue le client
            headY = Math.sin(t * 0.8) * 0.4;
            break;
          }
          default:
            headY = Math.sin(t * 0.9) * 0.6;
        }
      } else headY = Math.sin(t * 0.7) * 0.4;
      // mission commando : fusil à la main, il court puis épaule (à genoux pour les tirs lointains)
      if (job?.kind === 'hunt') {
        for (const o of Object.values(v.tools)) o.visible = false;
        v.tools.rifle.visible = true;
        const prey = s.predators.find((p) => p.id === job.targetId);
        const dist = prey ? Math.hypot(prey.x - w.x, prey.z - w.z) : 0;
        if (spd > 0.12) {
          armR = -0.8;
          armL = -0.95;
          armLz = -0.3;
          torsoX = 0.18;
        } else {
          crouch = dist > 4 ? 1 : 0;
          const elev = prey && prey.species === 'hawk' ? Math.atan2(prey.y + 0.3 - 0.8, Math.max(0.6, dist)) : -0.08;
          armR = -Math.PI / 2 - elev;
          armL = -Math.PI / 2 + 0.12 - elev;
          armRz = 0.12;
          armLz = -0.42;
          torsoX = crouch ? 0.12 : 0.04;
          headY = 0;
          legA = 0;
          const since = w.lastShotT !== undefined ? s.clock.t - w.lastShotT : 9;
          if (since < 0.25) {
            // recul
            armR += 0.4 * (1 - since / 0.25);
            armL += 0.3 * (1 - since / 0.25);
            torsoX -= 0.12 * (1 - since / 0.25);
          }
        }
        v.tools.lantern.visible = false;
      }
      const kk = Math.min(1, dt * 12);
      if (dark && spd > 0.12 && job?.kind !== 'hunt') armL = -0.35;
      // ramassage d'œufs au passage : il se penche un instant, panier à la main
      if (w.lastPickT !== undefined && s.clock.t - w.lastPickT < 0.8) {
        torsoX = 0.65;
        armR = -0.9;
        v.tools.basket.visible = true;
      }
      v.root.position.y = y - crouch * 0.18;
      // il enjambe le grillage d'un saut : jambe d'attaque repliée, buste penché, bras en balancier
      const vw = vaultOf(w);
      if (vw) {
        const vk = Math.min(1, vw.t / vw.dur);
        v.root.position.y += Math.sin(Math.PI * vk) * 1.0;
        legA = 0;
        crouch = 0.9;
        torsoX = 0.45;
        armL = armR = -1.6;
      }
      v.legL.rotation.x = legA - crouch * 1.1;
      v.legR.rotation.x = -legA - crouch * 0.5;
      v.torso.rotation.x += (torsoX - v.torso.rotation.x) * kk;
      v.armL.rotation.x += (armL - v.armL.rotation.x) * kk;
      v.armR.rotation.x += (armR - v.armR.rotation.x) * kk;
      v.armR.rotation.z += (armRz - v.armR.rotation.z) * kk;
      v.armL.rotation.z += (armLz - v.armL.rotation.z) * kk;
      v.head.rotation.y += (headY - v.head.rotation.y) * kk;
      if (v.tools.broom.visible) {
        this.poseSweep(v, t, dt);
        v.legL.rotation.x = -0.22;
        v.legR.rotation.x = 0.18;
      } else v.torso.rotation.y += (0 - v.torso.rotation.y) * kk;
    }
    for (const [id, v] of this.staff) {
      if (!seen.has(id)) {
        this.staffG.remove(v.root);
        this.staff.delete(id);
      }
    }
  }

  /**
   * Coup de balai réaliste : la brosse reste au sol et décrit un arc devant le fermier (poussée
   * appuyée, puis retour en l'effleurant) ; le buste accompagne le geste ; la main droite tient le
   * manche en bas, la main gauche plus haut ; le manche passe toujours par les deux mains.
   */
  private poseSweep(v: WorkerView & { sweepT: number }, t: number, dt: number) {
    const P = 1.15; // durée d'un aller-retour (s)
    const cyc = (t / P) % 1;
    const push = cyc < 0.58;
    const u = push ? cyc / 0.58 : (cyc - 0.58) / 0.42;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const sw = push ? ease(u) : 1 - ease(u); // 0 : brosse à droite, 1 : brosse à gauche
    const lift = push ? 0 : Math.sin(u * Math.PI) * 0.06;
    // brosse dans le repère du personnage (il regarde vers +z ; sa droite est vers -x)
    const hx = -0.34 + sw * 0.62;
    const hz = 0.4 + Math.sin(sw * Math.PI) * 0.12;
    const hy = 0.015 + lift;
    // le buste suit la brosse
    v.torso.rotation.y = (sw - 0.5) * 0.42;
    v.torso.rotation.x = 0.3 + Math.sin(sw * Math.PI) * 0.06;
    v.root.updateWorldMatrix(true, true);
    const aim = (arm: THREE.Group, target: THREE.Vector3) => {
      // oriente le bras (pendant selon -y au repos) vers une cible donnée dans le repère du personnage
      const shoulder = arm.getWorldPosition(sweepA);
      const dir = v.root.localToWorld(sweepB.copy(target)).sub(shoulder).normalize();
      sweepQ.copy(v.torso.getWorldQuaternion(sweepQ)).invert();
      dir.applyQuaternion(sweepQ);
      arm.rotation.set(Math.atan2(-dir.z, -dir.y), 0, Math.asin(clamp(dir.x, -1, 1)));
      arm.updateWorldMatrix(false, true);
      return v.root.worldToLocal(arm.localToWorld(sweepC.set(0, -0.35, 0)));
    };
    // main droite basse sur le manche, du côté de la brosse
    const right = aim(v.armR, sweepD.set(-0.1 + hx * 0.4, 0.56, 0.24)).clone();
    // le manche part de la brosse et passe par la main droite
    const head = sweepE.set(hx, hy, hz);
    const axis = sweepF.copy(right).sub(head);
    const len = axis.length();
    axis.normalize();
    // base : y le long du manche, x (largeur de la brosse) horizontal et perpendiculaire au manche
    const side = sweepG.set(0, 0, 1).cross(axis);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const fwd = sweepH.copy(side).cross(axis).normalize();
    sweepM.makeBasis(side, axis, fwd);
    v.tools.broom.position.copy(head);
    v.tools.broom.quaternion.setFromRotationMatrix(sweepM);
    // main gauche plus haut sur le manche
    aim(v.armL, sweepD.copy(head).addScaledVector(axis, len + 0.22));
    // poussière et brins de paille pendant la poussée, bruit de balai à chaque coup
    if (push && u > 0.08 && u < 0.85 && Math.random() < dt * 24) {
      const p = v.broomTip.getWorldPosition(tmpV);
      this.particles.burst(p.x, 0.12, p.z, Math.random() < 0.5 ? 0xd9c28f : 0xe8dcc0, 2, { speed: 0.5, up: 0.35, size: 0.42, life: 0.7, gravity: 1.2 });
      if (Math.random() < 0.12) this.particles.burst(p.x, 0.13, p.z, 0xe2cf8a, 1, { speed: 0.8, up: 0.7, size: 0.55, life: 0.9 });
    }
    const stroke = Math.floor(t / P);
    if (push && v.sweepT !== stroke) {
      v.sweepT = stroke;
      if (this.onScreen(v.root.position)) sound.play('sweep');
    }
  }

  workerPosition(id: number) {
    return this.staff.get(id)?.root.position ?? null;
  }

  // ------------------------------------------------------------ Lumière ----
  private updateLighting(s: GameState) {
    const h = currentHour(s);
    const day = smoothstep(4.8, 7.2, h) * (1 - smoothstep(19.2, 21.8, h));
    const warm = Math.exp(-(((h - 6.6) / 1.1) ** 2)) + Math.exp(-(((h - 19.9) / 1.2) ** 2));
    const night = 1 - day;
    this.sun.intensity = 0.5 + 1.7 * day;
    // lumière rasante sur le plumage : douce le jour, presque éteinte la nuit
    HEN_RIM.value = 0.04 + 0.12 * day;
    // jour : soleil chaud ; nuit : clair de lune bleuté
    this.sun.color.setRGB(1 - 0.45 * night, 0.95 - 0.22 * warm - 0.3 * night, 0.88 - 0.38 * warm + 0.1 * night);
    this.hemi.intensity = 1.0 + 0.6 * day;
    this.hemi.color.setRGB(0.62 + 0.38 * day, 0.7 + 0.27 * day, 1 - 0.09 * day);
    this.hemi.groundColor.setRGB(0.55 + 0.23 * day, 0.6 + 0.21 * day, 0.62 + 0.0 * day);
    const bg = this.scene.background as THREE.Color;
    bg.copy(this.bgNight).lerp(this.bgDay, day);
    const ang = ((h - 6) / 12) * Math.PI;
    const dir = new THREE.Vector3(-Math.cos(ang) * 0.9 + 0.2, 1.4 + Math.sin(ang) * 0.4, 0.55);
    dir.normalize();
    this.sun.position.copy(this.target).addScaledVector(dir, 50);
    // zone d'ombre ajustée au cadrage : ombres nettes même en zoom très rapproché
    const span = clamp(Math.max(this.camera.right, this.camera.top) * 1.5, 4, 26);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.05) {
      sc.left = -span;
      sc.right = span;
      sc.top = span;
      sc.bottom = -span;
      sc.updateProjectionMatrix();
      this.sun.shadow.normalBias = 0.004 + span * 0.0007;
    }
    this.sun.target.position.copy(this.target);
    GLOW.color.setRGB(0.75 + 0.25 * night, 0.89 - 0.02 * night, 1 - 0.55 * night);
  }

  // -------------------------------------------------------- Placement ----
  showGhost(type: BuildingType | null, level: number, x: number, z: number, ok: boolean, rot = 0) {
    if (!type) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = null;
      this.ghostKey = '';
      this.ghostTiles.visible = false;
      return;
    }
    const key = `${type}${level}`;
    if (this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      const m = buildingModel(type, level);
      const gm = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.7, flatShading: true });
      m.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          // (le treillis garde sa texture : il n'a pas de couleurs de sommets)
          if (!((o as THREE.Mesh).material as THREE.MeshLambertMaterial).map) (o as THREE.Mesh).material = gm;
          o.castShadow = false;
        }
      });
      this.ghost = m.group;
      this.ghostKey = key;
      this.scene.add(this.ghost);
    }
    const d = sizeOf(type, level, rot);
    const [ox, oz] = turnOffset(type, level, rot);
    this.ghost!.position.set(x + ox, GRASS_TOP + 0.02 + Math.sin(this.time * 5) * 0.03, z + oz);
    this.ghost!.rotation.y = (rot * Math.PI) / 2;
    this.ghostTiles.visible = true;
    this.ghostTiles.scale.set(d.w, 1, d.d);
    this.ghostTiles.position.set(x + d.w / 2, GRASS_TOP + 0.015, z + d.d / 2);
    (this.ghostTiles.material as THREE.MeshBasicMaterial).color.set(ok ? 0x4ade80 : 0xf87171);
  }

  hideBuilding(id: number, hidden: boolean) {
    const v = this.buildings.get(id);
    if (v) v.group.visible = !hidden;
  }

  // ------------------------------------------------------------ Images ----
  update(s: GameState, dt: number) {
    LEGEND_TIME.value = this.time;
    this.hall?.tick(((s.clock.t % TIME.DAY) / TIME.DAY) * 24, this.time);
    this.time += dt;
    GRASS_WIND.value = this.time;
    setVegetationZoom(this.zoom);
    const dense = this.zoom >= this.grassMinZoom;
    if (dense !== this.grassDense) {
      this.grassDense = dense;
      for (const ch of this.grassChunks.values()) {
        ch.lawn.geometry = this.lawnGeo[dense ? 0 : 1];
        ch.wild.geometry = this.wildGeo[dense ? 0 : 1];
      }
    }
    const key = s.parcels.slice().sort().join('|');
    let wildKey = 0;
    for (const b of s.buildings) if (b.wild) wildKey = (wildKey * 31 + b.id + b.x * 7 + b.z * 13) % 1000000007;
    if (wildKey !== this.wildKey && key === this.layoutKey) {
      this.wildKey = wildKey;
      this.rebuildLayout(s);
    }
    if (key !== this.layoutKey) {
      const first = !this.layoutKey;
      this.wildKey = wildKey;
      this.rebuildLayout(s);
      if (!first) {
        for (const p of s.parcels) {
          if (!this.layoutKey.split('|').includes(p)) {
            const [c, r] = parcelCoords(p);
            const [cx, cz] = parcelCenter(c, r);
            const P = WORLD.PARCEL;
            for (let i = 0; i < 14; i++) this.particles.burst(cx + (Math.random() - 0.5) * (P - 2), 0.2, cz + (Math.random() - 0.5) * (P - 2), 0x9fcd62, 8, { speed: 1, up: 2 });
          }
        }
      }
      this.layoutKey = key;
    }
    // l'herbe change lentement : on ne la recalcule pas tout le temps, sauf quand on survole une parcelle
    this.grassTimer += dt;
    if (this.grassTimer > 2 || this.hoverParcel !== this.grassHover) {
      this.grassTimer = 0;
      this.grassHover = this.hoverParcel;
      this.updateGrass(s);
    }
    // clôtures : reconstruites à chaque changement de terrain (pose, retrait, trou)
    const ver = rt(s).version;
    if (ver !== this.fenceVersion) {
      this.fenceVersion = ver;
      this.fences.build(s);
    }
    this.syncBuildings(s, dt);
    this.syncHens(s, dt);
    this.droppings.update(s);
    this.syncEggs(s);
    this.syncPeople(s, dt);
    this.syncStaff(s, dt);
    this.syncPredators(s, dt);
    this.syncRobots(s, dt);
    this.syncDog(s, dt);
    this.updateLighting(s);
    const hh = currentHour(s);
    this.decor.setPetShop(s.buildings.some((b) => b.type === 'petshop'));
    this.decor.setYard(s.parcels.includes(BIRD_ORDERS.parcel));
    this.decor.update(this.time, dt, smoothstep(4.8, 7.2, hh) * (1 - smoothstep(19.2, 21.8, hh)));
    this.village.update(this.time, dt, smoothstep(4.8, 7.2, hh) * (1 - smoothstep(19.2, 21.8, hh)));
    // la circulation suit le temps du jeu (figée en pause, pressée en accéléré)
    this.street.update(dt * Math.min(2, s.clock.speed), hh, smoothstep(4.8, 7.2, hh) * (1 - smoothstep(19.2, 21.8, hh)));
    // de temps en temps, des sangliers ou des biches longent la ferme
    this.wildlife.update(s, dt * Math.min(3, s.clock.speed), hh);
    // le camion du couvoir qui livre les lots de poules (la circulation reste derrière lui)
    this.truck.update(s);
    this.particles.update(dt);
    // neige en hiver, feuilles mortes en automne (intensité variable d'un jour à l'autre)
    const wx = weatherOf(s);
    this.weather.update(dt, this.time, this.target, wx.snow, GRASS_TOP, this.zoom);
    this.leaves.update(dt, this.time, this.target, wx.leaves, GRASS_TOP);
    this.shots.update(dt);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.shakeT > 0) {
        const a = (this.shakeT / this.zoom) * 0.9;
        this.camera.position.copy(this.target).addScaledVector(CAM_DIR, 80);
        this.camera.position.x += (Math.random() - 0.5) * a;
        this.camera.position.y += (Math.random() - 0.5) * a;
        this.camera.position.z += (Math.random() - 0.5) * a;
        this.camera.updateMatrixWorld();
      } else this.updateCamera();
    }

    // sélection : l'élément s'illumine, un liseré clair souligne sa silhouette et un halo se pose au sol
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.6);
    const sh = this.selectedHen >= 0 ? this.hens.get(this.selectedHen) : undefined;
    const sb = this.selectedBuilding >= 0 ? s.buildings.find((b) => b.id === this.selectedBuilding) : undefined;
    const sw = this.selectedWorker >= 0 ? this.staff.get(this.selectedWorker) : undefined;
    const sr = this.selectedRobot >= 0 ? this.robots.get(this.selectedRobot) : undefined;
    const sd = this.selectedDog ? this.dogView : null;
    const sp = this.selectedPetBird >= 0 ? this.petBirds.get(this.selectedPetBird) : undefined;
    this.selBox.visible = false;
    this.selRing.visible = !!sh && sh.root.visible;
    if (sh) {
      this.selRing.position.set(sh.root.position.x, GRASS_TOP + 0.02, sh.root.position.z);
      this.selRing.scale.setScalar(1 + pulse * 0.04);
    }
    this.highlight.set(sb ? this.buildings.get(sb.id)?.group ?? null : sw ? sw.root : sr ? sr.body : sd ? sd.root : null);
    this.highlight.update(this.time);
    let halo: { x: number; z: number; w: number; d: number } | null = null;
    if (sb) {
      // (une couveuse n'a pas d'emprise au sol : le halo reprend la taille du meuble)
      const d = sb.type === 'stand' ? standLayout(sb.level) : sb.type === 'incubator' ? { w: 1.2, d: 1.2 } : sb.type === 'petshop' ? { w: petLayout(sb.level).w, d: 6.7 } : sizeOf(sb.type, sb.level, sb.rot);
      const c = this.center(sb);
      halo = { x: c.x, z: c.z, w: d.w + 1.1, d: d.d + 1.1 };
    } else if (sw) halo = { x: sw.root.position.x, z: sw.root.position.z, w: 1.7, d: 1.7 };
    else if (sr) halo = { x: sr.root.position.x, z: sr.root.position.z, w: 1.3, d: 1.3 };
    else if (sd) halo = { x: sd.root.position.x, z: sd.root.position.z, w: 1.4, d: 1.4 };
    else if (sh && sh.root.visible) halo = { x: sh.root.position.x, z: sh.root.position.z, w: 1.25, d: 1.25 };
    else if (sp) halo = { x: sp.hen.x, z: sp.hen.z, w: 1.25, d: 1.25 };
    this.halo.visible = !!halo;
    if (halo) {
      this.halo.position.set(halo.x, GRASS_TOP + 0.012, halo.z);
      this.halo.scale.set(halo.w * (1 + pulse * 0.03), 1, halo.d * (1 + pulse * 0.03));
      (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.08 * pulse;
    }
  }

  /** Point visible à l'écran (pour ne pas faire entendre ce qui se passe hors champ). */
  onScreen(p: THREE.Vector3) {
    tmpV.copy(p).project(this.camera);
    return Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05;
  }

  /** Données utiles aux étiquettes : position écran d'un point monde. */
  henPosition(id: number) {
    const v = this.hens.get(id);
    return v && v.root.visible ? v.root.position : null;
  }

  render(dt: number) {
    this.labels.update(this.camera, this.width, this.height, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Graphismes allégés, seulement sur demande du joueur (Réglages) : image moins fine,
   * ombres moins précises, herbe et arbres simplifiés, poules plus simples dès qu'elles sont nombreuses.
   */
  lowGraphics = false;
  setLowGraphics(low: boolean) {
    if (low === this.lowGraphics) return;
    this.lowGraphics = low;
    this.renderer.setPixelRatio(low ? 1 : fullRatio());
    this.sun.shadow.mapSize.setScalar(low ? 1024 : 2048);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.grassMinZoom = low ? 2 : 0.85;
    setVegetationQuality(low);
    this.resize();
  }

  static needsLabel(h: Hen) {
    return h.health < 40 || h.sick || h.hydration < NEEDS.urgentAt || h.satiety < NEEDS.urgentAt;
  }
}


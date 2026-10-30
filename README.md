# Cocotte — un petit jeu de ferme

Jeu web en 3D isométrique (three.js) : achetez votre première poule, ramassez ses œufs, fixez vos prix, payez vos charges et développez votre ferme jusqu'à une grande exploitation avicole.

## Lancer le jeu

```bash
npm install
npm run dev        # http://localhost:5173
```

- `npm run build` : version de production (dossier `dist/`, jouable via `npm run preview`)
- `npm test` : 104 tests automatisés de la simulation (les 10 scénarios du cahier des charges, personnel, prédateurs, capacité d'élevage, cas limites)
- `npm run balance` : simulation d'équilibrage sans interface (un « bon gestionnaire » et un « négligent » joués par des bots)
- `npx vite-node scripts/stress.ts` : charge maximale (270 poules) et temps de calcul par pas
- `npx vite-node scripts/movement.ts` / `scripts/predators-check.ts` : diagnostics des déplacements et des attaques
- `http://localhost:5173/?nosave` : partie de démonstration qui ne lit ni n'écrit la sauvegarde

La ferme continue de tourner quand l'onglet est caché, la fenêtre réduite ou recouverte : seul l'affichage s'arrête, la simulation avance du temps réel écoulé (aucun prédateur n'attaque tant que l'onglet est caché). Jeu fermé, la progression hors ligne prend le relais (2 jours de jeu maximum).

**Page d'accueil** : titre « Cocotte » et un bouton « Jouer » (ou « Continuer » si une partie est sauvegardée), devant une ferme vitrine en 3D isométrique qui vit en direct (poules, coq, poussins, commis, chien) sous une caméra qui dérive lentement (sim/showcase.ts, jamais sauvegardée). Balises de partage (description, Open Graph) dans index.html.

**Interface** : aucune émoticône — pictogrammes dessinés (icônes au trait, médailles, pastilles de saison).

**Notifications** : une seule à l'écran, toujours au même endroit — en haut, entre le panneau de gauche et l'horloge, alignée sur celle-ci et dans le même style (tuile d'icône, titre en gras, détail en gris). La plus récente passe devant ; quand elle s'efface, celle d'en dessous réapparaît si elle est encore d'actualité (« +N » indique combien attendent, « ×N » un message répété). Un clic la ferme. Sur écran moyen elle se place juste sous l'horloge.

## Mise en ligne
Site statique (aucun serveur) : `npm run build` produit `dist/`, à publier tel quel (Vercel, Netlify, GitHub Pages…). Sur Vercel : importer le dépôt GitHub, le préréglage Vite est détecté (build `npm run build`, dossier `dist`).
- **Sauvegarde** dans le navigateur du joueur (stockage local + copie de secours, stockage « persistant » demandé au lancement). Réglages → « Télécharger ma sauvegarde » / « Charger un fichier » pour la garder à l'abri ou changer d'appareil.
- **Aucune donnée envoyée** : ni compte, ni cookie, ni mesure d'audience ; les polices (Nunito, Fredoka) sont fournies avec le jeu.
- **Sur téléphone, à l'horizontale, comme une application** :
  - mise en page dédiée aux écrans bas (de 667 à 932 px de large) : tableau de bord replié, horloge compacte, menu en colonne d'icônes à droite, fiches en colonne pleine hauteur (l'horloge glisse alors à gauche), boutique et fenêtres en plein écran, tutoriel et notifications en bas, encoche évitée ;
  - bouton **plein écran** (verrouille l'écran à l'horizontale quand le téléphone le permet) ; musique et son passent dans les Réglages ;
  - **installable** sur l'écran d'accueil (« Ajouter à l'écran d'accueil ») : `public/manifest.webmanifest`, icônes `public/icon-*.png`, s'ouvre en plein écran et à l'horizontale ;
  - téléphone tenu en hauteur : une invitation à le tourner (on peut passer outre d'un toucher) ;
  - pas de zoom ni de défilement parasite du navigateur, pas de sélection de texte ou de menu au toucher long.
- **Mentions légales** dans les Réglages : compléter le contact dans `LEGAL` (src/config/balance.ts) avant de publier.

## Commandes

| Action | Souris / clavier |
|---|---|
| Sélectionner (poule, salarié, bâtiment, parcelle) : il s'illumine et sa fiche s'affiche | clic |
| Ramasser un œuf au sol | clic sur l'œuf |
| Tirer sur un renard ou une buse | clic dessus (curseur en viseur) |
| Déplacer la vue / zoomer | glisser / molette (pincer sur mobile) |
| Pause, vitesses ×1 / ×3 / ×10 | `Espace`, `1`, `2`, `3` |
| Ramasser tous les œufs | `R` |
| Passer la nuit (dès 20 h, jusqu'à 6 h 30 ; aucun prédateur pendant ce temps) | bouton « Passer la nuit » ou `N` |
| Boutique / Vente | `B` / `V` |
| Annuler une construction, fermer | `Échap` |

## Boucle de jeu

1. **Acheter** une poule (Boutique → Poules). Elle est logée dans un poulailler compatible.
2. Elle **vit** : picore l'herbe (une prairie dense et verdoyante : chaque case porte un tapis d'une cinquantaine de brins qui déborde sur ses voisines, sans trou ; les brins ondulent au vent, raccourcissent et jaunissent là où les poules ont brouté, puis repoussent ; pâquerettes, boutons d'or et trèfles ; les prés à vendre ont des herbes folles plus hautes. Tapis regroupés par parcelle et allégés au zoom éloigné pour rester fluide), boit à l'abreuvoir, mange le grain de la mangeoire, se repose, rentre dormir au poulailler la nuit : elle gravit la rampe, passe la trappe et disparaît derrière le mur (jamais de rétrécissement), puis ressort le matin en redescendant la rampe.
3. Bien nourrie, hydratée, en bonne santé et à l'aise, elle **pond** au pondoir (ou au sol si le pondoir est plein — œuf de moindre qualité qui se perd s'il n'est pas ramassé).
4. **Ramasser** (clic sur le pondoir ou l'œuf) → stockage limité, où les œufs vieillissent.
5. **Fixer le prix** (Vente → Étal). Les clients passent de 8 h à 20 h et achètent si le prix leur convient ; sinon ils repartent (« Trop cher ! »).
6. **Grain et eau** s'achètent et se stockent (réserve à grain, cuve) ; mangeoires et abreuvoirs y puisent. Chacun a son modèle par niveau : auge en planches sur tréteaux, trémie galvanisée à grille alimentée par un tuyau, petit silo sur pieds avec échelle et couronne ; seau galvanisé sur sa pierre, abreuvoir à niveau constant raccordé au réseau, ligne de pipettes à réservoir translucide. On voit le grain et l'eau baisser, sur un sol tassé semé de grains ou de flaques. Le tableau de bord de gauche réunit trésorerie, réserves (avec autonomie et achat rapide), élevage, équipe et journal.
7. **Charges** prélevées à minuit (entretien, taxe foncière, salaires) ; grain, eau, litière, vétérinaire payés à l'achat.
8. **Investir** : poules, races, poulaillers, pondoirs, mangeoires/abreuvoirs automatiques, stockage, parcelles, personnel.

La boutique tient sur une seule page qui défile, rubrique après rubrique (Poules, Bâtiments, Équipement, Grain & eau, Terrain, Personnel) ; le sommaire à gauche suit le défilement et un clic y saute directement. Fiches illustrées par les vrais modèles 3D du jeu (render/thumbs.ts). La page Vente n'affiche que les œufs produits, indique la file d'attente de l'étal et trace le **cours de l'œuf** jour après jour (28 jours, une courbe par type d'œuf : le cours dérive doucement, avec de l'élan, et suit les saisons en glissant sur leurs cinq derniers jours) ; la page Poules trace le **taux de ponte moyen** des pondeuses (relevé chaque heure) avec les œufs pondus chaque jour ; un clic sur l'étal dans la ferme l'ouvre directement sur les prix, avec la carte de l'étal (niveau, clientèle, amélioration) juste en dessous. La liste des poules se lit en cartes, avec un bouton « Vendre » sur chacune (second clic pour confirmer, annulé au bout de quelques secondes). **Rareté : le coq entièrement noir** (plumes noires à reflets verts, crête, peau, bec, pattes et yeux noirs, comme l'Ayam Cemani) : 2,5 % des coqs achetés et 4 % des coquelets nés à la ferme ; il se revend entre 600 et 700 € (moins tant qu'il est jeune) et porte un badge « Rarissime ». Chaque Rousse des prés a son plumage, tiré au hasard à l'achat ou à l'éclosion : rousse classique, acajou, dorée ou Isa Brown (indiqué sur sa fiche). La fiche d'un élément cliqué (poule, bâtiment, salarié…) s'ouvre à droite, en colonne (celle d'une parcelle déjà achetée est une petite carte : herbe, poules présentes et capacité, effets des aménagements, Ressemer / Aménager) : le menu (Boutique, Vente, Poules…) se réduit alors à une fine colonne d'icônes collée au bord, toujours cliquable, et retrouve ses libellés quand la fiche se ferme. Le tableau de bord de gauche tient sans défiler (grain et eau côte à côte) et se replie avec la flèche en haut à droite.

Les poules laissent de petites fientes noires (à pointe blanche) derrière elles dans l'herbe ; elles sèchent et disparaissent au bout d'une journée de jeu (render/droppings.ts, purement visuel).

La scène reste épurée : aucun texte au-dessus des éléments. Un clic sur une poule, un salarié ou un bâtiment le met en valeur (éclat, liseré, halo au sol) et ouvre sa fiche. Les anciennes étiquettes restent disponibles dans les Réglages.

### Clôture, compost, robot
- **Départ** : une nouvelle partie commence avec **500 €** ; **aucun niveau requis pour acheter** (races, bâtiments, améliorations, salariés, chien, robot, parcelles : seul l'argent limite ; `LEVEL_GATES` dans balance.ts pour réactiver les déblocages). Les niveaux donnent toujours les titres, les missions et les débouchés commerciaux (coopérative, commandes, contrats…). Elle démarre avec **Cocotte, trois poussins, un coq et une couveuse offerte** (les poussins pondent à 30 jours), sur un terrain **déjà clôturé** (grillage + portail, rien à acheter ni à poser). La clôture s'agrandit d'elle-même à chaque parcelle achetée ; les poules ne s'échappent pas, le renard, lui, se faufile dessous.
- **Grand terrain** : douze parcelles de **20 × 20 cases** (70 poules chacune) sur une grille de 80 × 60 qui s'étend au nord et à l'est de la cour de départ. Les parcelles à vendre sont des prés sauvages avec leurs bosquets, défrichés à l'achat. Tout autour, la **campagne continue jusqu'à perte de vue** (render/countryside.ts) : bois, champs cultivés en rangs, vergers, prairies, haies, mares, la route qui traverse tout le paysage ; aucun bord vide, même au zoom le plus éloigné.
- **Aménagements aux vrais effets** (sim/perks.ts, effets calculés par parcelle et détaillés sur la fiche du bâtiment, dans la boutique et sur la fiche de la parcelle) :
  - **Bain de poussière** : bien-être +10 (+16 abrité) et **maladies −50 %** (−70 % au niveau 2) pour le poulailler de la parcelle (les poules s'y débarrassent des parasites).
  - **Mare** (3 × 3) : point d'eau naturel où les poules viennent boire ; la pluie la remplit toute seule (plus au printemps et en automne, peu en été), l'eau est gratuite et n'entame pas la cuve ; la fraîcheur fait boire **12 % de moins** (20 % pour la grande mare) aux poules de la parcelle, bien-être +6/+10. La **grande mare** contient plus d'eau et accueille des canards.
  - **Arbre d'ombrage** (1 case) : bien-être +4 par arbre (jusqu'à +12), **soif −6 % par arbre** (jusqu'à −30 %, l'effet compte davantage l'été) et **abri contre les buses** : à l'approche d'une buse, les poules courent se cacher sous l'arbre le plus proche, où la buse ne peut pas les saisir.
  - **Compost** : produit vers et insectes ; les poules viennent y gratter et gagnent des protéines : **ponte jusqu'à +25 %**, **jusqu'à 20 % de grain en moins**, bien-être +10, œufs plus riches.
- **Consommation** : une poule mange et boit 20 % de moins qu'avant (une ration ou un litre couvre 125 points de besoin).
- **Les poules se baladent partout sur leur terrain** : chacune a son « coin de pré » du moment, choisi n'importe où dans son enclos (herbe haute, ombre d'un arbre, pas trop de monde, ou le coin d'une copine : elles vont par petits groupes). Elle y retourne après chaque repas, chaque gorgée ou chaque ponte, d'un pas décidé en contournant bâtiments et clôtures, y picore et gratte, puis en change au bout d'un moment ou quand l'herbe y est broutée. Elles ne traînent plus au pied des bâtiments (scripts/roam-check.ts mesure la dispersion : sur leur temps libre, 44 % du temps à plus de 5 m d'un bâtiment, contre 2 % auparavant).
- **La rue passante** (render/street.ts) : la route s'est éloignée de la clôture. Entre les deux, une **place pavée** accueille l'étal avec de la place pour la file d'attente, l'enseigne « Œufs frais », un tilleul dans son bac, des bancs, des jardinières et un range-vélos ; à côté, un **parking** de trois places où des clients viennent se garer (ils tournent, se garent, puis repartent en marche arrière). Les clients de l'étal marchent sur le **trottoir** ; en face, un second trottoir, un **passage piéton** qui mène à la ruelle du village et un **arrêt de car**. La chaussée à deux voies vit : voitures, camionnettes, vélos, tracteur et car du village (qui marque l'arrêt et dépose des passagers), plus nombreux aux heures de pointe, phares allumés la nuit ; on double les vélos, on attend derrière le tracteur, on s'arrête pour laisser traverser les piétons. Des passants flânent sur les trottoirs et traversent. (Décor seul : la circulation n'influence pas la simulation.)
- **Chien de garde** (150 €) : c'est le chien qui attend devant la maison ; cliquez dessus pour l'adopter. Il fait le tour de l'exploitation **à l'extérieur du grillage**, toujours à au moins une case de la clôture (jamais le museau ni la queue à travers) (il n'entre jamais dans l'enclos) et dort dans sa niche près de la maison la nuit ; renards et buses ne s'approchent presque plus (−96 % d'apparitions, et deux fois plus de temps entre deux attaques), et s'il en surgit un, il fonce en aboyant et le fait détaler.
- **Poulaillers et réserves redessinés**, un vrai bâtiment par niveau (render/farmBuildings.ts) :
  - poulailler : **cabane** sur pilotis en planches, toit de tôle ondulée, pondoir accroché sur le côté, rampe à tasseaux, paille dessous → **poulailler en bois** rouge à angles blancs, volets verts, soubassement de pierres, toit d'ardoises, girouette au coq, lanterne → **chaumière normande** enduite à colombages (croix de Saint-André), tuiles plates, épis de faîtage, lanternon d'aération et sa girouette, jardinières de géraniums, roses trémières → **bâtiment d'élevage moderne** en panneaux isolés, toit en bac acier, panneaux solaires, faîtière ventilée, ventilateurs d'extraction, gouttière, trappe automatique avec moteur, voyant et écran ;
  - réserve à œufs : **garde-manger** en planches (porte à écharpe, aération à lames, lanterne, petite table) → **cellier à persiennes** et son étagère à cageots → **chambre froide** (porte inox, plaque « froid », thermomètre, groupe froid, palette) → **entrepôt réfrigéré** (bardage nervuré, rideau métallique, quai de chargement, groupes froids sur le toit) ;
  - **pondoirs** : caisse de planches sur petits pieds, paille et brins qui dépassent, toit de bardeaux, planche d'envol → pondoir double peint vert sauge, **rideaux vichy** noués, tiroir de ramassage, toit de tuiles, perchoir rond → pondoir à rouleau galvanisé, tapis de ponte verts inclinés, rabats, **tapis roulant de collecte** et son moteur ;
  - **bain de poussière** : bac de vieilles traverses rempli de sable et de cendre (plaques grises, cuvettes creusées par les poules, plumes, éclaboussures), seau de cendre, petite pelle → bain couvert : bordure de galets, pare-vent de planches, abri en appentis qui ne couvre que l'arrière (on voit toujours les poules) ;
  - **compost** : tas entre trois palettes, fourche, arrosoir → composteur à lattes, couvercle relevé, trappe de récolte d'où s'échappe un terreau grouillant de vers, seau d'épluchures ; le tas (terreau, paille, épluchures, coquilles, vers) monte avec le stock ;
  - les cageots d'œufs (avec leurs œufs) s'empilent devant la réserve à mesure que le stock se remplit ; les fenêtres et lanternes s'allument le soir.
- **Poulaillers deux fois plus grands** : emprise de **6 × 4 cases** (`COOP_SCALE` dans buildings.ts) ; le modèle, la trappe, la rampe et le passage des poules suivent l'échelle (elles gravissent une rampe deux fois plus longue). Les anciennes parties (sauvegarde v7) reposent chaque poulailler au plus près de sa place, là où il tient sans chevaucher les autres bâtiments.
- **Le village** (render/village.ts) : de l'autre côté de la route, un vrai bourg de campagne.
  - Maisons en enduit coloré, en pierre apparente ou à colombages : chaînes d'angle, toits débordants à tuiles ou en ardoise (deux ou quatre pans), lucarnes, cheminées en briques fumantes, gouttières, fenêtres à carreaux avec volets et jardinières, portes à imposte, auvents et appliques.
  - Jardins derrière les maisons : potagers, linge qui sèche, abris, tables et parasols, tas de bûches, arbres fruitiers, balançoires, clôtures variées ; voitures garées dans les allées ; ruelle de derrière.
  - Grand-rue goudronnée avec trottoirs ; place pavée avec fontaine à deux vasques, platanes, bancs, monument aux morts, terrasse du café, bornes, jardinières, boîte aux lettres jaune, terrain de pétanque.
  - Mairie pavoisée (horloge, drapeaux, perron), commerces à enseigne peinte et store rayé (boulangerie, café-tabac, pharmacie, épicerie, coiffeur), église (contreforts, vitraux, chevet arrondi, clocher à abat-sons et horloges, flèche d'ardoise, coq) et son petit cimetière aux cyprès.
  - Le soir, fenêtres et vitrines s'allument, les lampadaires éclairent la chaussée.
- **Robot ramasseur d'œufs** (150 €) : autonome, il ramasse d'abord les œufs au sol puis vide les pondoirs, décharge au stockage et se recharge seul sur sa borne.
- Les poules sont des corps solides : elles ne se chevauchent pas et s'écartent au passage des salariés et des robots. Les salariés, eux, peuvent se croiser librement pour ne jamais se bloquer au travail.

### Coqs, couveuse et poussins
- **Coqs** : chaque race a son coq dans la boutique (rubrique Poules, sous les poules), 1,5 fois le prix de la poule. Il ne pond pas mais féconde les œufs : un coq pour une dizaine de poules donne jusqu'à 90 % d'œufs fécondés. Il chante au lever du jour.
- **Couveuse** (bâtiment, 3 niveaux : 12, 30 puis 72 œufs) : le garde-manger sépare les œufs **à vendre**, les œufs **fécondés** et ceux **en couveuse**, avec un bouton « Mettre les œufs fécondés en couveuse ». En automatique (par défaut), chaque œuf fécondé rangé part aussitôt dans la couveuse (« +1 œuf en couveuse » s'affiche au-dessus) ; un écriteau sur la couveuse indique le nombre d'œufs et le temps avant l'éclosion (**15 jours**). Les plus frais éclosent le mieux. La fiche de la couveuse liste chaque œuf (ou lot mis ensemble) avec sa race, le moment où il a été mis et son propre compte à rebours ; l'écriteau indique la 1re éclosion. La couveuse se remplit jusqu'à sa capacité même si la ferme est pleine : un avertissement prévient alors que des poussins seront à l'étroit.
- **Poussins** : ils grandissent pour de vrai, sans transformation d'un coup. Leur taille augmente chaque jour et leur aspect passe par 7 stades : boule de duvet jaune, premières plumes au bout des ailes, plumes sur le dos et petite queue, jeune emplumé qui perd son duvet (quelques brins s'envolent), crête qui pousse, plumage presque complet, puis presque adulte. La tête, grosse au début, s'affine ; chez le coquelet, les faucilles s'allongent peu à peu. À **30 jours**, ce sont des poules pondeuses (ou des coqs). Un poussin tient de sa mère ou du coq ; environ un sur cinq est un mâle.
- Les œufs fécondés restent des œufs comme les autres : sans couveuse, ils sont vendus ; avec une couveuse, ils sont vendus en dernier.

### Génétique et sélection
Chaque volaille a trois **qualités héréditaires** notées de 1 à 5 étoiles : **ponte** (−20 % à +20 % d'œufs), **robustesse** (maladies et pertes de santé ×1,3 à ×0,7) et **beauté** (concours, valeur à la revente). Les volailles du commerce plafonnent à **3 étoiles**, avec un profil propre à chaque race (fourchettes affichées dans la boutique : la Leghorn pond beaucoup mais est fragile, la Sussex est rustique, la poule soie est belle mais pond peu, les races rares partent de plus haut) ; un poussin hérite de la moyenne de sa mère et du coq, avec une chance de gagner (18 %) ou de perdre (12 %) une étoile. En gardant ses meilleurs reproducteurs, on obtient des 4★ puis des 5★ (« Poussin prometteur » à l'éclosion). Les étoiles s'affichent sur la fiche de chaque volaille et dans la liste (tri « Qualités »).

### Concours agricole
Le **dernier jour de chaque saison à 15 h**, la volaille inscrite (sinon la plus belle, d'office) affronte trois éleveurs. Note : beauté ×10, ponte et robustesse ×4, santé, forme, protéines, race. Podium récompensé (1er prix, 40 %, 20 %), réputation, XP et trophée au palmarès ; **chaque victoire fait monter de catégorie** : village (rivaux ~50 pts, 30 €) → canton → département → région → **Concours général agricole** (rivaux ~90 pts, 1 500 €), qu'on ne gagne qu'avec une lignée sélectionnée. Inscription depuis la fiche de la volaille ou l'onglet « Concours agricole » des Missions ; rappel la veille et le matin ; fenêtre du podium après chaque concours.

### Saisons
Une année = 4 saisons de 7 jours (affichées dans l'horloge). **Printemps** : ponte +15 %, herbe ×1,35. **Été** : soif ×1,35, herbe ×0,7. **Automne** : ponte −5 %, prix +5 %, feuilles mortes. **Hiver** : ponte −20 %, herbe presque à l'arrêt, poules plus affamées, **œufs +18 %**. La météo change chaque jour : en automne, de vraies feuilles (érable, hêtre) tombent en zigzag et tapissent l'herbe avant de se faner ; en hiver, jours dégagés ou de neige : de petits flocons en 3D tombent dans la scène (à l'échelle du monde, rien n'est plaqué devant l'écran), une neige légère s'accumule au sol par plaques sans masquer la ferme, les toits, les poteaux et les arbres blanchissent, puis tout fond à la fin de la saison. Chaque changement de saison est annoncé.

De nouvelles missions accompagnent ces systèmes (premier poussin, jour de foire, belle lignée, premier ruban, une année à la ferme, comice départemental, championne de race, champion de France).

### Banque
Le bouton **Banque** (barre de droite, ou la carte de trésorerie à gauche) ouvre :
- **Mes comptes** : solde, résultat du jour, dette restante, ce qui sera prélevé cette nuit ; graphique sur 14 jours (revenus, dépenses, trésorerie et dette) ; revenus et dépenses de la ferme sur 7 jours ; encadré « Financement » (prêts reçus, capital remboursé — ils n'entrent pas dans le résultat, seuls les intérêts sont une charge) ; journal.
- **Emprunter** (prêt express) : montant au curseur (au moins **50 €, toujours accordés**, même à découvert ; le plafond grandit avec les ventes de la semaine, la valeur des installations et des volailles et le niveau, moins les dettes en cours), durée de **7, 14 ou 28 jours** (28 jours = une année de jeu). Le **taux annuel** dépend de la saison (printemps 6 %, été 5 %, automne 7 %, hiver 9 %), de la durée (+1 % à 14 jours, +2 % à 28 jours), d'un compte à découvert (+5 %) ou d'un fort endettement (+3 %), et il est fixé à la signature. Coût du crédit = montant × taux × durée / 28 ; une **échéance fixe** (capital + intérêts) est prélevée **chaque nuit** avec les charges, même à découvert. Remboursement anticipé à tout moment, sans frais (seul le capital restant est dû). **Pause des échéances** : une fois par prêt, 3 ou 7 jours sans prélèvement pour remonter la pente ; les intérêts courent pendant la pause et sont répartis sur les échéances suivantes. 5 prêts en cours au maximum.

### Personnel
Commis (eau d'abord, puis grain, propreté, trappes des poulaillers, œufs en dernier), vendeur (comptoir de l'étal), soigneur (soins, santé du troupeau), jardinier (prairies). Tous sont visibles dans la ferme, même derrière un bâtiment.
- **Des personnages réalistes** (render/people.ts) : proportions d'adulte, visage (yeux, sourcils, nez, oreilles, bouche), coiffures variées (courts, bouclés, queue-de-cheval, chignon, cheveux longs, calvitie), barbes, moustaches, lunettes, cheveux gris pour les plus âgés, carrure et taille propres à chacun ; l'apparence suit le prénom (Léa, Chloé… ou Hugo, Lucas…).
- **Tenues de métier** : commis en chemise à carreaux retroussée, salopette en jean, foulard, bottes en caoutchouc et chapeau de paille ; vendeur·se en chemise claire, tablier à bavette avec poche et badge, baskets ; soigneur·se en blouse blanche ouverte sur un pyjama de soin, stéthoscope, stylo, croix rouge, sabots ; jardinier·ère en tablier de toile (sécateur en poche), gants, genouillères, bottes et bob.
- **Portraits** : le panneau Personnel, la barre d'équipe et la fiche d'un salarié montrent la photo de son vrai personnage 3D (les annonces de recrutement aussi). Clients et passants partagent le même corps détaillé (vestes, jupes, sacs en bandoulière).

### Prédateurs
De temps en temps, un **renard** (surtout au crépuscule, la nuit et à l'aube) sort des hautes herbes, traque une poule et l'emporte ; une **buse** (en journée) tournoie au-dessus de la ferme puis pique. Les attaques restent rares : au moins un jour et demi entre deux, environ une tous les 3 à 4 jours sans chien. Un bandeau d'alerte s'affiche et le temps repasse en vitesse normale ; le bouton « Viser » ferme la page ou la fiche ouverte et centre la vue sur le prédateur.
- Le joueur tire d'un clic : deux balles pour un renard (blessé, il détale), une pour la buse. Tirer pendant la prise sauve la poule.
- **Prime de 5 €** pour chaque renard abattu (par le joueur ou un salarié), comptée dans les finances (« Primes »).
- Le **commis** et le **jardinier** sont armés : ils sentent le prédateur, sortent le fusil, courent se mettre à portée et tirent (à genoux pour les tirs lointains). Le vendeur et le soigneur restent à leur poste.
- La nuit, une trappe fermée (par le commis, ou par le joueur depuis la fiche du poulailler) protège les poules endormies ; un poulailler resté ouvert est une invitation pour le renard.
- Aucune attaque pendant l'absence du joueur ; les prédateurs peuvent être désactivés dans les Réglages.

### Commandes et contrats
- **Commandes de toutes tailles**, tirées au hasard : petites (6 à 30 œufs, mieux payées et pressées, 1 à 3 jours), moyennes (36 à 96 œufs) ou grosses (120 à 200 œufs, 4 à 7 jours pour livrer).
- Une commande acceptée **peut être annulée** (deux clics, un peu de réputation perdue ; moins qu'un retard).
- **Dès que le stock suffit**, une notification le signale avec un bouton **« Livrer »** (la livraison se fait d'un clic, depuis la notification ou l'onglet Commandes).
- **Contrats** : livraison automatique chaque jour à 17 h, ou **« Livrer aujourd'hui »** en avance (jamais deux fois le même jour) ; un contrat peut être **résilié** contre une journée de pénalité.

### Basse-cour vivante
- **Vrais repas** (sim/feeding.ts) : chaque mangeoire, abreuvoir et mare a ses places calées sur le modèle 3D. La poule s'avance jusqu'au bord, se penche à la bonne hauteur (auge et abreuvoir en long à hauteur de poitrine, assiettes, coupelles et mare au ras du sol) et son bec plonge vraiment dans le grain ou l'eau, puis elle recule et repart.
- **Moins de temps à table** : elles ne filent à la mangeoire ou à l'abreuvoir qu'une fois l'estomac à moitié vide, préfèrent l'herbe quand le pré est beau, et si toutes les places sont prises elles vont gratter plus loin au lieu de faire la queue ; le reste du temps, elles grattent et picorent le sol en se baladant.
- **Combats de coqs** : un nouveau coq (acheté ou devenu adulte) se mesure tout de suite au coq le plus proche ; ensuite, une querelle éclate de loin en loin. Face-à-face, bonds ailes battantes, plumes qui volent ; le vaincu détale, le vainqueur bat des ailes (un peu de bien-être perdu pour les deux).
- **Poussins : un sur deux est un coq**, comme dans la nature.
- **Abreuvoirs** : bassine galvanisée basse (niveau 1), coupelle à niveau constant (niveau 2), longue auge galvanisée à niveau constant sur tréteaux avec son flotteur et son arrivée d'eau, où huit poules boivent côte à côte (niveau 3).
- **Compost** : une vraie butte de terre bosselée, couverte de feuilles mortes, de branchages, d'épluchures, de coquilles et de vers, immobile ; **mare** : la berge est un anneau qui ne recouvre plus l'eau (plus de scintillement en zoomant).
- **Personne ne traverse le grillage** (sim/vault.ts) : le renard le franchit d'un bond souple, les salariés l'enjambent d'un saut comme des commandos (les portails se passent à pied) ; le renard apparaît toujours hors de l'enclos.
- **Santé** : une poule ne tombe malade que si quelque chose ne va pas (poulailler sale, stress, faim ou soif, santé faible) ; bien tenue, une poule malade se remet d'elle-même (deux fois plus vite avec un soigneur). Les poules boivent et mangent une dernière fois avant la nuit et consomment très peu en dormant.
- **Le soir**, elles se rapprochent de leur poulailler en fin d'après-midi, repartent vers lui à la tombée du jour et se pressent devant la trappe sans s'écarter : tout le monde est couché à la nuit.
- **Le tas de compost est fixe** : un vrai tas de terre qui ne gonfle ni ne dégonfle.
- **Aucune limite d'achat** : autant de poulaillers, mangeoires, abreuvoirs, pondoirs, mares, arbres, bains, composts et robots qu'on veut (seules la réserve à œufs et l'étal restent uniques) ; le personnel s'embauche dès le début et sans maximum (seul le salaire compte).
- **Lots de poules** (Boutique → Poules) : 6, 12 ou 24 poules d'une même race, 8 %, 15 % ou 22 % moins chères à l'unité. Le camion du couvoir arrive par la route, s'arrête devant le portail feux de détresse allumés (la circulation attend derrière lui), les poules descendent et rejoignent le poulailler, puis il repart. La place est réservée dès la commande.
- **Poules robustes** : elles mangent et boivent un quart de moins, récupèrent deux fois plus vite, et ne s'affaiblissent vraiment qu'en cas de faim ou de soif réelles ; tant qu'elles ne manquent de rien et ne sont pas malades, le stress ou un poulailler un peu sale les fatiguent sans jamais les tuer.
- **Vieillesse à 600 jours** : avant, pleine ponte ; ensuite la ponte baisse peu à peu (jusqu'à 35 % vers 800 jours). Une vieille poule peut être **confiée à une association ou à des particuliers** (fiche de la poule, ou « Réformer les vieilles poules » dans la liste) : elle part à la retraite et la ferme gagne un peu de réputation. Durée d'incubation inchangée.
- **Faune sauvage** (render/wildlife.ts) : de temps en temps (rarement), une laie et ses marcassins, un sanglier ou des biches (parfois avec un faon) sortent du bois, longent la ferme par l'extérieur du grillage, s'arrêtent pour fouiller le sol ou brouter, puis repartent ; une notification signale leur passage. Décor seul, ils n'entrent jamais dans l'enclos.
- **Poussins** : ils ne prennent pas de place, ni au poulailler ni sur le terrain (ils se blottissent sous les adultes) ; ils comptent à partir du moment où ils deviennent adultes.
- **Grands poulaillers** : deux niveaux de plus, qui s'agrandissent (décalés automatiquement si la place manque d'un côté) :
  - niv. 5 *Grand poulailler de ferme* (8 × 5 cases, 80 places) : grange de planches rouges sur soubassement de pierre, grand toit de tuiles, lanterneau d'aération et girouette, fenêtres à carreaux, porte coulissante, bottes de paille ;
  - niv. 6 *Bâtiment avicole plein air* (10 × 6 cases, 140 places) : panneaux isolants, bandeaux vitrés, trois trappes, cheminées d'extraction, panneaux solaires, silo à grain et local technique.
- **Les oies** (niveau 10 exigé, même si les autres achats sont libres) : *Oie de Toulouse* grise au ventre blanc ou *blanche d'Emden*, modelées comme les poules (long cou en S, bec plat orange à onglet, ailes aux plumes bordées de clair, pieds palmés) ; elles broutent beaucoup et pondent de gros **œufs d'oie** (6,50 € de référence) vendus à l'étal, à la coopérative et en commandes. Un *jars* s'achète comme un coq ; oies et poules ne se croisent pas.
- **Coqs en trop** : dans la liste des poules, section « Coqs », un bouton vend d'un coup tous les coqs sauf le meilleur reproducteur (un coq pour les poules, un jars pour les oies) ; les coqs noirs rarissimes ne sont jamais vendus d'office.
- **Poule aux œufs d'or** : dix fois plus rare que le coq noir (0,4 % des poussines nées à la ferme), plumes d'or qui scintillent ; elle pond un œuf d'or tous les deux jours, qui ne pourrit pas et va dans un coffre à part : le collectionneur le rachète 150 € (onglet Vente). La poule elle-même vaut une vingtaine d'œufs d'or (≈ 3 000 €) — mais vendue, plus d'œufs d'or.
- **Camions dans la circulation** : le camion du couvoir roule comme les autres véhicules (il suit la voiture de devant, s'arrête au passage piéton), se gare à sa place sans gêner le passage piéton ; les voitures le doublent quand la voie d'en face est libre, et celles d'en face les laissent se rabattre.
- **Robots ramasseurs** : chacun a sa borne de recharge (socle à contacts, colonne, balise verte en charge, panneau solaire), alignées le long du stockage ; nouveau modèle de rover à roues crantées, bras articulé à ventouse, plateau alvéolé, mât à lidar.
- **Lots de poules en convoi** : on choisit 1, 2 ou 3 camions (un lot de 6, 12 ou 24 poules chacun) ; les camions commandés ensemble arrivent en convoi et se garent l'un derrière l'autre le long du trottoir (un lot commandé avant l'arrivée du convoi le rejoint s'il reste une place). Le hayon s'abaisse, les poules sautent une à une, trottinent à la file sur le trottoir jusqu'au portail et entrent dans la ferme l'une après l'autre (une toutes les 0,5 s), puis le convoi repart (sim/deliveries.ts, render/delivery.ts).
- **Grandes mangeoires et grands abreuvoirs** : deux niveaux de plus, qui s'allongent (l'équipement est décalé automatiquement si la place manque d'un côté ; refusé sans frais s'il n'y a vraiment pas la place) :
  - mangeoire niv. 4 *Auge longue galvanisée* (3 cases, 14 poules côte à côte, barre anti-perchoir et séparateurs) et niv. 5 *Chaîne d'alimentation* (4 cases, 22 poules, trémie motorisée, canal au ras du sol) ;
  - abreuvoir niv. 4 *Abreuvoir long en inox* (3 cases, 14 poules, flotteur) et niv. 5 *Double ligne de pipettes* (4 cases, 22 poules, bac de tête, régulateur, filtre, coupelles).
- **Réserve à œufs agrandie** : 100, 350, 900 puis 2 500 œufs selon le niveau ; le bâtiment est deux fois plus grand (4 × 4 cases, comme les poulaillers), les anciennes parties sont réaménagées au chargement.
- **Dézoom** : on peut reculer deux fois plus loin (zoom minimal 0,28) ; la campagne, la route et la circulation s'étendent en conséquence.
- **Sélection plus sobre** : léger éclaircissement, fin liseré semi-transparent et halo discret ; l'élément sélectionné reste parfaitement lisible.

Progression : 10 niveaux (5 phases, du *Débutant* à la *Grande exploitation*), 27 missions avec primes, déblocage de la coopérative, des commandes, des contrats, du réapprovisionnement automatique, du personnel et de la vente en volume.

## Architecture

```
src/
  config/      ← TOUT l'équilibrage : balance.ts (formules, prix, rythmes), breeds.ts, buildings.ts, missions.ts
  sim/         ← simulation pure, sans rendu (testable en Node)
    types.ts       état de jeu sérialisable
    core.ts        hasard déterministe, horloge, grille, champs de navigation (BFS)
    simulation.ts  pas fixe (0,1 s), clôture quotidienne unique, tâches horaires, hors-ligne plafonné
    hens.ts        besoins, santé, bien-être, ponte, comportement (machine à états, coin de pré et grandes balades,
                   fuite devant les prédateurs)
    workers.ts     personnel visible : tâches, priorités, trajets, mission « commando » des salariés armés
    predators.ts   renards et buses : apparition, traque, prise, fuite, tirs
    stocks.ts      réserve à grain et cuve d'eau, consommation mesurée, autonomie
    fences.ts      clôture automatique autour du terrain possédé (grillage + portail)
    robots.ts      robots ramasseurs d'œufs
    starter.ts     nouvelle partie : Cocotte, trois poussins, un coq et une couveuse
    genetics.ts    qualités héréditaires (ponte, robustesse, beauté), hérédité, effets
    show.ts        concours agricole : calendrier, notes, rivaux, catégories, palmarès
    seasons.ts     saisons (effets sur la ponte, l'herbe, la soif, l'appétit, les prix)
    bank.ts        banque : plafond, taux du moment, prêts, échéances quotidiennes, remboursement anticipé
    breeding.ts    coqs, œufs fécondés, couveuse, éclosion et croissance des poussins
    eggs.ts        ponte → pondoir/sol → stockage (lots FIFO) → vente ; fraîcheur
    grass.ts       herbe consommée / repousse logistique
    feeding.ts     places des poules aux mangeoires, abreuvoirs et mares (pattes au bord, bec dans le grain ou l'eau)
    perks.ts       effets des aménagements par parcelle (bain de poussière, mare, arbres) : bien-être, maladies, soif, abri
    market.ts      clients de l'étal, qui longent le trottoir (file d'attente : 1 guichet, 2 à la Boutique de la ferme, +1 avec un vendeur ;
                   chaque client a sa patience, repart s'il attend trop ou passe son chemin si la file
                   compte déjà 5 personnes), demande dynamique, coopérative, commandes, contrats
    economy.ts     grand livre centralisé (centimes entiers), XP et niveaux
    buildings.ts   validation de placement (accès, connexité), remplissages auto, propreté
    actions.ts     toutes les commandes joueur, validées avant toute modification
    progression.ts missions et déblocages
  save/save.ts ← localStorage avec copie de secours, versionnage, assainissement des données
  render/      ← three.js : modèles procéduraux (salariés, renard, buse), terrain, jour/nuit,
                 mise en valeur de la sélection (highlight.ts), effets de tir (fx.ts)
    henModel.ts  volailles sculptées en volumes lisses : corps d'un seul tenant, camail en pointes,
                 crête dentelée, yeux à fleur de tête qui clignent (instances à part, écrasées le temps d'un battement), vraies plumes en ruban (queue, rémiges, faucilles, lancettes), couleurs
                 peintes par sommet (plastron, peau de la face, marbrures, ombre douce), duvet du
                 poussin propre à chaque race ; ~6 500 triangles par poule, dessinées par instances.
                 Plumages « écaillés » (Isa Brown, modelée d'après photo) : rangées de plumes de couverture
                 en relief sur le dos et les ailes, bordées de clair (~9 000 triangles)
?nosave&dev=10,hens  ← (développement) partie simulée 10 jours, panneau Poules ouvert ; dev=8,market,stand, etc.
dev/worldlab.html ← atelier du paysage (hors build) : ?zoom=0.55&x=30&z=5&build=pond:3,13;tree:9,12&lvl=2
                 &hens=12 (poules en plus) &sim=1&adv=40 (simulation) &h=21 (heure)
                 &raw=storage:9,11:3 (bâtiment posé sans contrôle, pour comparer les niveaux)
  render/street.ts ← la rue : place de l'étal, parking, trottoirs, passage piéton, arrêt de car, circulation et passants
  render/farmBuildings.ts ← poulaillers, réserves, pondoirs, bains de poussière et composts : un modèle détaillé par niveau
dev/peoplelab.html ← atelier (hors build) : les salariés des 4 métiers et des passants, ?looks=0,1,2 &roles=farmhand,seller &zoom= &gap=
dev/henlab.html ← atelier de développement (hors build) : toutes les races sous l'éclairage du jeu,
                 ?zoom=, ?only=rousse,marans, ?stages=0,1,2, ?yaw=, ?thumbs=1 (vignettes) ;
                 scripts/hen-verts.ts compte les triangles de chaque modèle
  ui/          ← interface Preact (HUD, inspecteur, boutique, vente, finances, missions, tutoriel)
  audio/       ← effets sonores synthétisés (WebAudio)
  game.ts      ← boucle, entrées, évènements → effets, sauvegarde automatique
```

Garanties principales (couvertes par les tests) :
- l'argent est stocké en **centimes entiers** ; toute dépense passe par `economy.spend` qui refuse un achat non couvert ;
- un œuf n'existe qu'à un endroit à la fois ; les retraits de stock sont atomiques (rien n'est retiré si la quantité manque) ;
- la clôture quotidienne est gardée par `lastClosedDay` : jamais deux fois la même facture ;
- la simulation avance par **pas fixes** : le résultat ne dépend pas du nombre d'images par seconde ;
- la progression hors ligne utilise les mêmes règles, plafonnées à 2 jours de jeu, et rien quand la partie est en pause.

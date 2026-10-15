# myenergi

Suivez et pilotez vos appareils **myenergi** depuis Gladys : la borne de
recharge **zappi**, le routeur d'eau chaude **eddi**, le capteur à pinces sans
fil **harvi** et la batterie **libbi**. Gladys les lit par le cloud myenergi,
le même service que l'appli myenergi : puissance solaire et réseau, état et
énergie de la recharge, eau chaude chauffée par le surplus solaire, niveau de
la batterie. Elle change le mode de charge de la zappi, lance et arrête les
boosts, et déclenche une scène à la fin d'une recharge.

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette
> intégration a été écrite et testée sur les réponses du cloud myenergi
> publiées par la bibliothèque [pymyenergi](https://github.com/CJNE/pymyenergi),
> pas sur de vrais appareils. Si quelque chose ne marche pas comme décrit,
> dites-le sur le [forum Gladys](https://community.gladysassistant.com) ou dans
> les [issues](https://github.com/guim31/gladys-myenergi/issues).

Cette intégration n'est pas affiliée à myenergi Ltd.

## Ce qu'il faut

- Gladys Assistant 5.2.0 ou plus récent.
- Un **hub** myenergi (ou une zappi ou un eddi qui en tient lieu), relié à
  internet, avec vos appareils appairés dans l'appli myenergi.
- Le **numéro de série** du hub et une **clé d'API**. Connectez-vous à votre
  [compte myenergi](https://myaccount.myenergi.com), ouvrez **Produits** : le
  numéro de série est affiché à côté du hub, avec un bouton pour générer une
  clé d'API (article myenergi :
  [How do I get an API key?](https://support.myenergi.com/hc/en-gb/articles/5069627351185-How-do-I-get-an-API-key-)).
  La clé n'est affichée qu'une fois : copiez-la.

## Installation

1. Installez l'intégration depuis le catalogue de Gladys.
2. Dans **Configuration**, saisissez le **Numéro de série du hub** (chiffres
   seulement) et la **Clé d'API**, puis enregistrez.
3. Cliquez sur **Tester la connexion** : le message sous le bouton liste les
   appareils trouvés et le serveur myenergi de votre compte.
4. Ouvrez l'onglet **Découverte** : un appareil pour l'installation, plus un
   par zappi, eddi, harvi et libbi. Cliquez sur **Ajouter**, choisissez une
   pièce, enregistrez. Seuls les appareils ajoutés sont suivis.

Options :

- **Intervalle de rafraîchissement** : fréquence de lecture du cloud
  myenergi, de 1 minute (par défaut) à 10 minutes.
- **Langue des textes** : anglais, français (par défaut), allemand ou
  espagnol. Elle sert aux noms des fonctionnalités (donnés à l'ajout d'un
  appareil), aux libellés d'état et aux messages des scènes.

## Les appareils

### Installation

L'appareil qui porte le nom de votre site dans l'appli myenergi.

| Fonctionnalité    | Ce que c'est                                                                           |
| ----------------- | -------------------------------------------------------------------------------------- |
| Puissance réseau  | Puissance échangée avec le réseau, en W : positive en soutirage, négative en injection |
| Puissance solaire | Puissance de vos panneaux solaires, en W                                               |
| Tension réseau    | Tension mesurée par une zappi, un eddi ou une libbi, en V                              |

Les valeurs réseau et solaire sont celles des pinces de type _Grid_ et
_Generation_ dans l'appli myenergi, additionnées sur tous les appareils, comme
les calcule l'appli myenergi.

### zappi

| Fonctionnalité        | Ce que c'est                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connecteur            | Disponible (pas de voiture), Occupé (voiture branchée) ou En défaut                                                                                        |
| Charge                | En charge, Véhicule connecté, En pause (véhicule), En pause (borne : en attente de surplus, ou mode Arrêt), Inactif (recharge terminée, ou pas de voiture) |
| Voiture branchée      | Oui / non : le plus simple pour lancer une scène au branchement                                                                                            |
| Mode de charge        | **Commande** : Rapide, Eco, Eco+ (surplus solaire seul) ou Arrêt                                                                                           |
| Puissance de charge   | Puissance envoyée à la voiture, en kW                                                                                                                      |
| Énergie de la session | Énergie ajoutée à la voiture depuis son branchement, en kWh                                                                                                |
| Énergie aujourd'hui   | Énergie fournie aujourd'hui par la zappi (solaire et réseau), en kWh                                                                                       |
| Énergie totale        | Énergie cumulée depuis l'ajout de la zappi, en kWh                                                                                                         |
| Pince _n_ (…)         | Puissance lue par chaque pince affectée dans l'appli myenergi, en W                                                                                        |

L'**Énergie totale** est un index que Gladys utilise pour son suivi de
l'énergie : il en calcule la consommation de chaque demi-heure et son coût
d'après votre contrat d'énergie. Le cloud myenergi n'a pas de compteur à vie :
l'intégration additionne l'historique journalier, jour après jour, et garde le
résultat dans `/data`.

### eddi

| Fonctionnalité                           | Ce que c'est                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| État                                     | En attente de surplus, Routage en cours, Boost en cours, Température max atteinte ou Arrêté |
| Chauffe                                  | Oui pendant que l'eddi chauffe l'eau (surplus ou boost)                                     |
| Puissance de chauffe                     | Puissance envoyée à la résistance, en W                                                     |
| Détourné aujourd'hui                     | Surplus solaire envoyé dans l'eau aujourd'hui, en kWh                                       |
| Énergie totale                           | Énergie cumulée de l'eddi (surplus et boost), en kWh, comme pour la zappi                   |
| Routage du surplus                       | **Commande** : activé (mode normal) ou arrêté                                               |
| Boost                                    | Oui pendant un boost                                                                        |
| Boost restant                            | Minutes restantes du boost en cours                                                         |
| Température sonde 1, Température sonde 2 | Les sondes de température du ballon, quand elles sont branchées                             |
| Pince _n_ (…)                            | Puissance lue par chaque pince affectée, en W                                               |

Les boosts se lancent depuis le widget ou une scène, pour une durée donnée :
il n'y a volontairement pas d'interrupteur marche/arrêt de la chauffe (un
boost se termine toujours de lui-même).

### harvi

Une fonctionnalité de puissance par pince affectée dans l'appli myenergi, en
W. Un harvi sans pince affectée n'est pas publié.

### libbi

| Fonctionnalité        | Ce que c'est                                                         |
| --------------------- | -------------------------------------------------------------------- |
| Niveau de batterie    | État de charge, en %                                                 |
| Puissance de charge   | Puissance qui entre dans la batterie, en W                           |
| Puissance de décharge | Puissance qui sort de la batterie, en W                              |
| État                  | En charge, En décharge, En veille, Batterie pleine, Arrêtée, Défaut… |
| Pince _n_ (…)         | Puissance lue par chaque pince affectée, en W                        |

La libbi est en lecture seule : ses modes et son objectif de charge demandent
le compte de l'appli myenergi (et non la clé d'API), que cette intégration
n'utilise pas.

## Widget du tableau de bord

Ajoutez le widget **myenergi** à un tableau de bord. Il montre quatre tuiles
(solaire, réseau, puissance de la zappi, puissance de l'eddi), l'état de la
zappi et de l'eddi, l'énergie de la session et l'énergie détournée
aujourd'hui. Dans ses réglages, choisissez une zappi et un eddi si vous en
avez plusieurs.

Boutons :

- **Boost voiture** : demande l'énergie à ajouter, en kWh, et si besoin
  l'heure à laquelle elle doit être prête (smart boost). Affiché en modes Eco
  et Eco+ seulement : en mode Rapide, la zappi charge déjà à pleine puissance.
- **Boost eau chaude** : demande une durée (1 à 240 minutes) et la résistance.
- **Arrêter le boost** : arrête tous les boosts en cours, après confirmation.
  Affiché pendant un boost.

Les tuiles suivent en direct les valeurs des appareils ajoutés à Gladys. Quand
le cloud myenergi ne répond pas, le widget montre la dernière lecture et le
dit.

## Scènes

### Déclencheur

- **Recharge zappi terminée** : la zappi a fini de recharger la voiture.
  Filtre facultatif : la zappi. Variables : l'énergie de la session (kWh) et
  le nom de la zappi, à mettre dans un message.

Pour les autres événements (voiture branchée, puissance solaire au-dessus
d'un seuil, niveau de batterie…), utilisez le déclencheur habituel _État d'un
appareil_ sur les fonctionnalités ci-dessus.

### Actions

- **Changer le mode de charge de la zappi** : Rapide, Eco, Eco+ ou Arrêt.
- **Lancer un boost de la zappi** : ajoute cette énergie (1 à 99 kWh) depuis
  le réseau, tout de suite, ou prête pour une heure (`07:30`) avec un smart
  boost. Modes Eco et Eco+ seulement.
- **Arrêter le boost de la zappi**.
- **Lancer un boost de l'eddi** : chauffe l'eau depuis le réseau pendant 1 à
  240 minutes, sur la résistance 1 ou 2.
- **Arrêter le boost de l'eddi** : annule le boost des deux résistances.

### Idées de scènes

- _Heures creuses_ : à 23 h, **Changer le mode de charge de la zappi** en
  Rapide ; à 6 h 30, retour en Eco+.
- _Voiture prête pour un trajet_ : sur un événement d'agenda « trajet »,
  **Lancer un boost de la zappi** de 30 kWh prêt pour `07:00`.
- _Recharge finie_ : sur **Recharge zappi terminée**, envoyez « La voiture
  est chargée : `{{triggerEvent.data.energy_kwh}}` kWh ajoutés » sur votre
  téléphone.
- _Journée nuageuse_ : à 17 h, si **Détourné aujourd'hui** est sous 2 kWh,
  **Lancer un boost de l'eddi** de 60 minutes.

## Rafraîchissement et usage de l'API

- Une requête au cloud myenergi lit tous les appareils, à l'intervalle de
  rafraîchissement (1 minute par défaut, jamais plus vite). L'historique
  horaire (énergie du jour, énergie totale) est lu toutes les 10 minutes par
  zappi et eddi ajoutés à Gladys, et une fois de plus juste après minuit pour
  clore la journée.
- Rien n'est lu tant qu'aucun appareil n'est ajouté, sauf quand vous cliquez
  sur **Tester la connexion** ou lancez une recherche dans l'onglet Découverte.
- Une commande (mode, boost) est une requête, suivie d'une lecture 5 secondes
  plus tard pour montrer ce que l'appareil a appliqué.
- L'API est celle de l'appli myenergi ; myenergi ne publie pas de quota pour
  elle. Si elle répond « trop de requêtes », augmentez l'intervalle.

## Dépannage

- **Numéro de série ou clé d'API refusés par myenergi** : vérifiez le numéro
  de série (chiffres seulement, celui du hub) et générez une nouvelle clé
  d'API ; un nouveau hub demande une nouvelle clé.
- **Le cloud myenergi ne répond pas** : l'intégration réessaie à chaque
  intervalle et dit quand il répond de nouveau ; le widget montre la dernière
  lecture en attendant. L'appli myenergi passe par le même cloud : vérifiez-la.
- **L'énergie totale démarre bas** : elle part de l'énergie du jour où
  l'appareil est ajouté. Gladys suit les hausses, pas la valeur de départ.
- **Une pince apparaît ou disparaît** : les pinces sont publiées telles
  qu'affectées dans l'appli myenergi ; après un changement, l'onglet
  Découverte propose de mettre l'appareil à jour.
- Plus de détails : réglez la variable d'environnement `LOG_LEVEL=debug` de
  l'intégration et lisez ses journaux. La clé d'API n'y apparaît jamais.

## Limites

- Développée sans le matériel : les valeurs et les commandes suivent les
  réponses documentées par pymyenergi ; certains champs (la puissance de
  charge de la zappi, le signe de la puissance de la libbi) sont interprétés,
  pas vérifiés sur un appareil.
- Cloud seulement : pas de pilotage local, et rien ne marche quand le cloud
  myenergi ou votre connexion internet est coupé.
- Non pris en charge : le déverrouillage de la zappi (écarté volontairement,
  par sécurité), les priorités des appareils, le niveau de vert minimal, les
  modes et l'objectif de charge de la libbi (ils demandent le compte de
  l'appli).
- L'**Énergie totale** est valorisée par Gladys au tarif de votre contrat,
  part solaire comprise : c'est ce qu'aurait coûté l'énergie prise au réseau.
- Les numéros de série viennent du cloud ; les noms sont ceux donnés dans
  l'appli myenergi, relus toutes les 6 heures.

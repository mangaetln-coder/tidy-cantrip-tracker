# Tidy Cantrip Tracker 1.1.0

Module pour **Foundry VTT 14 + D&D5e 6.x + Tidy 5e Sheets 14.x**.

Il ajoute aux fiches de personnage Tidy un suivi compact des **sorts mineurs (cantrips)**, avec quotas par classe, multiclassage et identification des sorts accordés par d'autres sources.

## Fonctionnalités

- Compteur par classe : `Druide 2/2`, `Magicien 3/3`, etc.
- Multiclassage natif : chaque classe conserve son propre quota.
- Lecture des limites depuis les `Scale Values` D&D5e, notamment `system.scale.<classe>.cantrips-known.value`.
- Catégorie compacte **Autres** pour les sorts mineurs accordés hors quota de classe.
- Catégorie **À attribuer** lorsqu'un sort ne peut pas être affecté automatiquement à une classe.
- Détection des sorts accordés via les Advancements D&D5e `Grant Items` et `Choose Items`.
- La colonne **Provenance** affiche le nom réel de l'Item Foundry qui accorde le sort lorsque cette information existe.
- Pour un sort ajouté directement (par exemple glisser-déposer), la provenance affiche la ou les listes de sorts D&D5e auxquelles il appartient.
- Signale les dépassements de quota et les attributions à résoudre.
- Les choix manuels sont enregistrés sur le sort sans modifier les classes ni leurs Advancements.
- Interface français / anglais, conçue pour accueillir d'autres traductions sans modifier le code.

## Exemple

Bandeau compact :

`Sorts mineurs : [ Druide 2/2 ] [ Magicien 3/3 ] [ Autres 2 ] [ ⚠ À attribuer 1 ]`

La fenêtre détaillée sépare :

- **Sort mineur**
- **Compter pour**
- **Provenance**
- **État**

## Provenance

Le module applique la priorité suivante :

1. si un Advancement a ajouté le sort, afficher le **nom de l'Item Foundry qui l'a directement accordé** ;
2. sinon, afficher les **listes de sorts enregistrées par D&D5e** auxquelles appartient le sort ;
3. si aucune information fiable n'est disponible, afficher une provenance indéterminée.

La provenance est distincte de l'attribution. Changer « Compter pour » ne falsifie donc pas l'origine du sort.

## Multiclassage

Un sort ajouté directement et présent sur une seule liste correspondant aux classes du personnage est attribué automatiquement à cette classe.

S'il appartient à plusieurs classes présentes sur le personnage, il passe dans **À attribuer** jusqu'à ce que l'utilisateur choisisse la classe dont le quota doit être consommé.

Les autres listes auxquelles le sort appartient restent visibles dans la colonne **Provenance**.

## Installation manuelle

1. Arrêter Foundry VTT.
2. Extraire le dossier du module dans `Data/modules/`.
3. Vérifier la présence de `Data/modules/tidy-cantrip-tracker/module.json`.
4. Redémarrer Foundry.
5. Activer **Tidy Cantrip Tracker** dans le monde.
6. Utiliser une fiche **Tidy 5e** pour le personnage.

## Installation depuis le gestionnaire de packages

Après publication de la release GitHub `v1.1.0` avec les assets `module.json` et `tidy-cantrip-tracker-v1.1.0.zip`, utiliser cette URL dans **Install Module → Manifest URL** :

`https://github.com/mangaetln-coder/tidy-cantrip-tracker/releases/latest/download/module.json`

## Traductions

Tous les textes de l'interface du module sont définis dans `lang/*.json`.

Pour ajouter une langue :

1. copier `lang/en.json` vers, par exemple, `lang/de.json` ;
2. traduire uniquement les valeurs ;
3. ajouter la langue dans la section `languages` de `module.json`.

Les noms des classes, dons, origines, espèces, sous-classes et autres Items proviennent directement de Foundry/D&D5e et ne sont pas retraduits par le module.

Les valeurs techniques des flags restent indépendantes de la langue :

- `auto`
- `bonus`
- `unknown`
- `class:<identifier>`

Cela conserve la compatibilité avec les données enregistrées par la version 0.1.0.

## Données ajoutées

Le module ajoute uniquement, lorsqu'une attribution manuelle est choisie :

`flags.tidy-cantrip-tracker.assignment`

Il ne supprime pas automatiquement les sorts en dépassement et ne bloque pas le glisser-déposer : il avertit et laisse le MJ décider.

## Dépôt

https://github.com/mangaetln-coder/tidy-cantrip-tracker

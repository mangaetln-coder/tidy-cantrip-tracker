# Changelog

## 1.1.1

- Correction de l'affichage du compteur sur les fiches Tidy 5e modernes / Quadrone.
- Utilisation prioritaire du point d'insertion `data-tidy-sheet-part="actor-name"`.
- Conservation des points d'insertion de secours `name-container` et `name-header-row` pour les autres variantes de mise en page.
- Ajout d'un message de diagnostic dans la console si aucun point d'insertion Tidy compatible n'est trouvé.
- Aucun changement fonctionnel dans le calcul des quotas, le multiclassage, la provenance ou les traductions.

## 1.1.0

- Nouvelle interface compacte : **Sorts mineurs**, **Autres**, **À attribuer**.
- Fenêtre détaillée à quatre colonnes : sort, attribution, provenance, état.
- Provenance basée en priorité sur le libellé de l'Item Foundry qui accorde le sort via un Advancement.
- Pour les sorts ajoutés directement, affichage de toutes les listes de sorts de classe enregistrées par D&D5e.
- Multiclassage conservé avec quotas séparés par classe.
- Meilleure détection des dépassements et des sorts nécessitant une attribution.
- Internationalisation complète français / anglais avec chaînes dynamiques via `game.i18n.format()`.
- Utilisation du formateur de listes localisé de Foundry lorsque disponible.
- Améliorations d'accessibilité (`aria-label`, titres explicites, statut non dépendant uniquement de la couleur).
- Mise en page plus robuste pour les langues à libellés longs et les fenêtres étroites.
- Ajout des URLs GitHub `manifest` / `download` pour l'installation et les mises à jour via Foundry.
- Compatibilité des flags de la version 0.1.0 conservée.

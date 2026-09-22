# Audit — `recomputeChecksums.ts`

À remplir en lisant UNIQUEMENT `src/recomputeChecksums.ts`. Le correcteur lit ce fichier
avant ton code.

1. **La fonction est `async`.** Ça suffit-il à garantir qu'elle ne bloque jamais la boucle
   d'événements ? Pourquoi (ou pourquoi pas) ?

2. **`payloads.map((p) => hashChain(p))`** — entre le premier et le dernier appel à
   `hashChain`, JavaScript rend-il la main à la boucle d'événements ne serait-ce qu'une
   fois ?

3. Le symptôme rapporté ("aucune requête ne répond pendant le recalcul") — pourquoi Node,
   mono-thread, produit exactement CE symptôme dans CE cas précis ?

4. La correction minimale, en une phrase — quel mécanisme permet de "rendre la main" au
   milieu d'un traitement sans le sortir de la fonction ?

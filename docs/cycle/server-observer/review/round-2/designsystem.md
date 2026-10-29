# Round 2 : design system

**Verdict : Approuvé.** Le majeur M1 est levé : `SERVER_STATE` n'existe qu'une fois, dans `shell/common.js`, lu par l'icône de la barre et par le volet. Les mineurs m1 à m10 du round 1 sont traités ou vérifiés (`--bad` devenu `--danger`, règles mortes et doublons supprimés, `sd-spin`, `refKey` du noyau, libellé ARIA générique).

Mineurs restants (aucun ne bloque)
- m-A : `border-radius` mort sur `.srow` (reste du survol supprimé).
- m-B : le repli « App masquée » du volet en vitrine n'est vérifié par aucun test.
- m-C : le `19px` de `.ssub` dépend de la pastille et de l'espacement de `.stop` (à commenter).
- m-D : ternaire inutile sur la classe de `#servers-mark`.
- m-E : `scrollbar-*` déclaré deux fois (à extraire à la troisième occurrence).

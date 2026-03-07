# Lab 09 — V8 Optimization / Bytecode

## Objectifs

- Comprendre comment V8 compile le JavaScript en bytecode via l'interpreteur Ignition
- Identifier les bytecodes fondamentaux : `LdaSmi`, `Star`, `Add`, `MulSmi`, `Return`
- Comparer le bytecode genere selon les declarations (`let`, `var`, `const`) et la stabilite de types
- Distinguer code monomorphe (optimisable) vs megamorphe (non-optimisable)
- Identifier quelles operations produisent un bytecode compact vs volumineux

## Prerequis

- Node.js v18+ (V8 v10+)
- Connaissance du pipeline V8 : parsing -> Ignition (bytecode) -> TurboFan (JIT)

## Commande d'execution

```bash
# Partie 1 — Observer le bytecode de hotFunction
node --print-bytecode --print-bytecode-filter=hotFunction exercise.js

# Filtrer d'autres fonctions (Parties 2-4)
node --print-bytecode --print-bytecode-filter=withLet exercise.js
node --print-bytecode --print-bytecode-filter=typeStable exercise.js
node --print-bytecode --print-bytecode-filter=typeUnstable exercise.js
node --print-bytecode --print-bytecode-filter=monoAccess exercise.js
node --print-bytecode --print-bytecode-filter=megaAccess exercise.js
node --print-bytecode --print-bytecode-filter=compactOps exercise.js
node --print-bytecode --print-bytecode-filter=bloatedOps exercise.js
node --print-bytecode --print-bytecode-filter=withSpread exercise.js
node --print-bytecode --print-bytecode-filter=withManual exercise.js
```

## Structure du lab

| Partie | Sujet |
|--------|-------|
| 1 | Ecrire `hotFunction`, l'appeler 10 000 fois, lire le bytecode |
| 2 | Comparer le bytecode : `let` vs `var` vs `const`, types stables vs instables |
| 3 | Code monomorphe vs megamorphe — comparer la taille du bytecode |
| 4 | Operations natives : bytecode compact vs bytecode volumineux |

## Indices

- `LdaSmi [n]` = Load Small Integer dans l'accumulateur
- `Star rN` = Store Accumulator into Register
- `Add rN, [slot]` = addition avec feedback de type
- `MulSmi [n]` = multiplication par un petit entier
- `Return` = retourne la valeur de l'accumulateur
- Le bytecode monomorphe est plus court car V8 n'a pas besoin de gardes de type
- `delete obj.prop` et l'acces dynamique `obj[key]` generent du bytecode plus lourd
- Les slots `[N]` apres les opcodes sont des feedback vector slots pour le JIT

## Ressources

- [Understanding V8's Bytecode](https://medium.com/nicely-said/understanding-v8s-bytecode-317d46c94775)
- [V8 Ignition Design Doc](https://v8.dev/blog/ignition-interpreter)

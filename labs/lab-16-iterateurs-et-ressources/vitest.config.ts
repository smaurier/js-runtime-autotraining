// Oracle du lab : `@lab/*` -> TON code (src/). `npm run lab:16` depuis 01-js-runtime/labs.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@lab": fileURLToPath(new URL("./src", import.meta.url)) } },
  // L'oracle fait aussi des assertions de FORME sur le source. Il doit donc savoir quel
  // dossier est aliase : sans ca, il lirait toujours src/, y compris en mode solution.
  define: { __CIBLE__: JSON.stringify("src") },
  test: { include: ["test/**/*.spec.ts"] },
});

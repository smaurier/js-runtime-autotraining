// Prouve que l'oracle est juste : `@lab/*` -> la solution de reference.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@lab": fileURLToPath(new URL("./solution", import.meta.url)) } },
  define: { __CIBLE__: JSON.stringify("solution") },
  test: { include: ["test/**/*.spec.ts"] },
});

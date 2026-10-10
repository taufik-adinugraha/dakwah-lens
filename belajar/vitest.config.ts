import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    server: {
      deps: {
        // next-intl's ESM build imports "next/server" with no extension, which Node's own ESM
        // loader refuses (next has no exports map); inlined, Vite resolves it. Needed by
        // src/proxy.test.ts, which drives the real proxy and next-intl's middleware.
        inline: ["next-intl"],
      },
    },
  },
});

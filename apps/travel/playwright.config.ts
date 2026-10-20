import { defineConfig } from "@playwright/test";

/**
 * The tests get their own port, and they do not reuse whatever is already on
 * it.
 *
 * The previous version reused any server on 3000 without checking what it was.
 * An outside developer with an unrelated Next app on that port watched all nine
 * tests fail against someone else's application, with the EADDRINUSE from our
 * own server scrolling past unread. A harness that silently tests the wrong
 * program is worse than one that refuses to start.
 */
const PORT = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Reuse only when iterating locally, and never in CI. Set PORT to move it.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

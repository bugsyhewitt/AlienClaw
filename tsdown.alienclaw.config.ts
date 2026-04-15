import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/alienclaw/index.ts",
  outDir: "dist/alienclaw",
  platform: "node",
  env: { NODE_ENV: "production" },
  dts: true,
  sourcemap: true,
});
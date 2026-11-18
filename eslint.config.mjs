import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Fonts are self-hosted (src/app/self-hosted-fonts.css): next/font/google downloads from Google at
  // build time, and that download failed production builds (2026-11-17).
  {
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "next/font/google", message: "Fonts are self-hosted: add the files under public/fonts/app/ and declare them in src/app/self-hosted-fonts.css." }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

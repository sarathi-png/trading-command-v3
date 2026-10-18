import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // mobile/ is a separate Expo/React Native package with its own toolchain —
  // the Next.js rules (and the React Compiler rules) do not apply to it.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "mobile/**"]),
]);

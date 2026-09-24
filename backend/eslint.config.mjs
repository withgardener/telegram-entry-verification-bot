import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        AbortSignal: "readonly", Buffer: "readonly", clearInterval: "readonly",
        console: "readonly", fetch: "readonly", process: "readonly",
        setInterval: "readonly", setTimeout: "readonly", URL: "readonly", URLSearchParams: "readonly"
      }
    }
  }
);

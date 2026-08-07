import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        console: "readonly"
      }
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // react-hooks v7's rules are tuned for web React rendering.
      // In Ink TUI, state-in-effects, refs-during-render, and mutable terminal
      // measurement refs are standard terminal UI patterns.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off"
    }
  },
  {
    // Ink TUI stdin parsing handles raw SGR mouse sequences, which
    // contain ESC (\x1b). The control-regex rule is intended to catch
    // accidental control characters; these are deliberate.
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: { "no-control-regex": "off" }
  },
  {
    // Tests relax a few rules to keep fixtures and mocks readable.
    files: ["**/*.test.ts", "**/*.test.tsx", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off"
    }
  }
)

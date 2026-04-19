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
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // react-hooks v7's set-state-in-effect is tuned for web React
      // re-render perf. In an Ink TUI every effect is a bridge to an
      // external stream (log file tail, stdin events, mount-time
      // prefill), which is exactly the pattern the rule flags. Disable
      // globally rather than annotate every call site.
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    // Ink TUI stdin parsing handles raw SGR mouse sequences, which
    // contain ESC (\x1b). The control-regex rule is intended to catch
    // accidental control characters; these are deliberate.
    files: ["src/ui/App.tsx"],
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

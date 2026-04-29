// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src-tauri/**", "scripts/**"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      // No any — primary guard against type drift
      "@typescript-eslint/no-explicit-any": "error",
      // React Hooks correctness
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // A11y — warn for now, flip to error one at a time
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-role": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
    },
  },
);

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["dist", "dist-e2e", "src-tauri"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ["src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // focus goes to the first field of a dialog or an inline editor
      // the user has just opened - never on page load
      "jsx-a11y/no-autofocus": "off",
      // the app's own inputs (NumberField, Toggle) are controls too, and
      // a label's text often sits a couple of spans deep
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 4, controlComponents: ["NumberField", "Toggle"] },
      ],
    },
  },
);

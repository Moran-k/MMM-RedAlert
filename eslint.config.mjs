import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["node_helper.js", "lib/**/*.js", "test/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["MMM-RedAlert.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        Module: "readonly",
        Log: "readonly",
      },
    },
  },
];

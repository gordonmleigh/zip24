import config from "@propulsionworks/eslint-config";

export default [
  config.configs["base"],
  config.configs["ts"],
  {
    rules: {
      //"unicorn/no-unused-properties": "warn",
      "unicorn/number-literal-case": "off", // fights with prettier
      "unicorn/numeric-separators-style": "off", // annoying
    },
  },
  {
    files: ["src/**/*.test.*"],

    rules: {
      "@typescript-eslint/no-floating-promises": "off", // `describe` and `it` return promises
      "n/no-unsupported-features/node-builtins": "off", // so we can use node:test
      "unicorn/no-abusive-eslint-disable": "off",
    },
  },
];

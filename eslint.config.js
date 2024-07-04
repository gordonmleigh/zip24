import awboostConfig from "@awboost/eslint-config";

export default [
  awboostConfig.configs["base"],
  awboostConfig.configs["ts"],
  {
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off", // annoying
      "unicorn/no-array-callback-reference": "off", // false positives
      "unicorn/no-array-method-this-argument": "off", // false positives
      "unicorn/no-nested-ternary": "off", // fights with prettier
      "unicorn/number-literal-case": "off", // fights with prettier
      "unicorn/numeric-separators-style": "off", // annoying
      "unicorn/prefer-spread": "off", // annoying
      "unicorn/prefer-switch": "off", // annoying
      "unicorn/prefer-ternary": "off", // annoying
      "unicorn/switch-case-braces": "off", // annoying
    },
  },
  {
    files: ["src/**/*.test.*"],

    rules: {
      "@typescript-eslint/no-floating-promises": "off", // describe and it return promises
      "n/no-unsupported-features/node-builtins": "off", // so we can use node:test
      "unicorn/no-abusive-eslint-disable": "off",
    },
  },
];

import propulsionworks, { config } from "@propulsionworks/eslint-config";

export default config(
  {
    ignores: ["node_modules/", "lib/", "eslint.config.js"],
  },
  {
    files: ["**/*.js", "**/*.ts"],
    extends: [propulsionworks.configs.js],
  },
  {
    files: ["**/*.ts"],
    extends: [propulsionworks.configs.ts],
    rules: {
      // we can turn this off due to the other rules that stop us abusing `any`
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      "@typescript-eslint/unified-signatures": [
        "error",
        {
          ignoreDifferentlyNamedParameters: true,
          ignoreOverloadsWithDifferentJSDoc: true,
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    extends: [propulsionworks.configs["ts-relaxed-any"]],

    rules: {
      // `describe` and `it` return promises
      "@typescript-eslint/no-floating-promises": [
        "warn",
        {
          allowForKnownSafeCalls: [
            { from: "package", name: ["describe", "it"], package: "node:test" },
          ],
        },
      ],

      "@typescript-eslint/no-non-null-asserted-optional-chain": "off", // easier for testing
      "@typescript-eslint/no-non-null-assertion": "off", // easier for testing
      "@typescript-eslint/no-unused-vars": "off", // easier for testing
      "@typescript-eslint/require-await": "off", // easier for testing
      "n/no-unsupported-features/node-builtins": "off", // so we can use node:test
      "unicorn/no-abusive-eslint-disable": "off",
    },
  },
);

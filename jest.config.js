// Set timezone to UTC for consistent test results
process.env.TZ = "UTC";

module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  // Resolve dual CJS/ESM packages (e.g. `yaml`) to their Node/CommonJS build.
  // jsdom otherwise selects the "browser" ESM entry, which Jest can't parse.
  testEnvironmentOptions: {
    customExportConditions: ["node", "node-addons"],
  },
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/types.ts",
    "!src/settings.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
  moduleNameMapper: {
    "\\.svg$": "<rootDir>/tests/__mocks__/svgMock.js",
  },
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
};

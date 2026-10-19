import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/unit/**/*.test.ts'],environment:'node',reporters:['default','json'],outputFile:{json:'artifacts/qa/unit-tests.json'}}});

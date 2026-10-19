import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:45000,workers:1,fullyParallel:false,reporter:[['list'],['json',{outputFile:'artifacts/qa/e2e-results.json'}]],use:{trace:'retain-on-failure'}});

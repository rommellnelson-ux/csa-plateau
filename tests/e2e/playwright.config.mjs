export default {
  testDir: '.',
  testMatch: '**/*.spec.mjs',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};

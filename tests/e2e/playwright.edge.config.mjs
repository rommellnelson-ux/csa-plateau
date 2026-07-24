export default {
  testDir: '.', testMatch: '**/mfa.spec.mjs', timeout: 40000,
  fullyParallel: false, workers: 1, reporter: [['list']],
  use: { headless: true },
  projects: [{ name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } }],
};

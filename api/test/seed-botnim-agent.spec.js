'use strict';

const { execSync } = require('child_process');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'seed-botnim-agent.js');

describe('seed-botnim-agent.js', () => {
  test('exits non-zero when DATABASE_URL and DB_HOST are unset', () => {
    const env = {
      ...process.env,
      DATABASE_URL: '',
      DB_HOST: '',
      DB_USER: '',
      DB_PASSWORD: '',
      DB_PORT: '',
      DB_NAME: '',
    };
    delete env.DATABASE_URL;
    delete env.DB_HOST;
    delete env.DB_USER;
    delete env.DB_PASSWORD;
    delete env.DB_PORT;
    delete env.DB_NAME;

    expect(() =>
      execSync(`node "${SCRIPT}"`, {
        env,
        stdio: 'pipe',
        timeout: 5000,
      }),
    ).toThrow();
  });

  test('script syntax is valid', () => {
    // node -c performs syntax check without executing
    expect(() =>
      execSync(`node -c "${SCRIPT}"`, {
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});

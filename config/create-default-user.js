/**
 * create-default-user.js — idempotent bootstrap-user creator for fresh deploys.
 *
 * Purpose
 * -------
 * On brand-new environments where `ALLOW_REGISTRATION=false` and we cannot
 * exec into the container (e.g. ECS Exec broken, no SSH), the HTTP register
 * route is closed off. This script seeds a single admin user by calling
 * `registerUser` in AuthService directly — the same underlying path that
 * `config/create-user.js` uses — so we bypass the HTTP layer and its
 * registration gating.
 *
 * It is designed to run unattended at container startup. It is idempotent:
 * if any user already exists in the `users` collection, it exits 0 without
 * doing anything.
 *
 * Behaviour
 * ---------
 *   - Connects to Mongo via the shared `connect.js` helper.
 *   - If `User.countDocuments() > 0`, logs "Users already exist, skipping
 *     bootstrap" and exits 0.
 *   - Otherwise reads three env vars (ALL required):
 *        BOOTSTRAP_USER_EMAIL
 *        BOOTSTRAP_USER_NAME
 *        BOOTSTRAP_USER_PASSWORD
 *     If any is missing, logs an error and exits non-zero so the container
 *     fails loudly (the secret wiring is broken).
 *   - Calls `registerUser({ email, password, name, username, confirm_password },
 *     { emailVerified: true })`. The first registered user is automatically
 *     promoted to ADMIN by AuthService (see `isFirstRegisteredUser` branch).
 *   - Never logs the password.
 *
 * Wiring
 * ------
 * Root-level npm script:  `npm run create-default-user`
 * Container startup:      `entrypoint.sh` invokes this when
 *                         `CREATE_BOOTSTRAP_USER=true` is set, BEFORE the
 *                         Node.js server starts. Failures abort boot.
 *
 * Operator runbook (staging example)
 * ----------------------------------
 * 1. Set the password in AWS Secrets Manager out-of-band:
 *        AWS_PROFILE=anubanu-staging aws secretsmanager put-secret-value \
 *          --secret-id librechat/staging/bootstrap-user-password \
 *          --secret-string '<strong-password>'
 * 2. Deploy. Terraform wires the secret into the task as
 *    BOOTSTRAP_USER_PASSWORD, and sets CREATE_BOOTSTRAP_USER=true.
 * 3. First task boot: user is created. Subsequent boots: no-op (idempotent).
 *
 * Notes
 * -----
 *   - This script does NOT hit /api/auth/register, so `ALLOW_REGISTRATION=false`
 *     is preserved as the public-facing posture.
 *   - To add more users after bootstrap, either finish the OpenID/Keycloak
 *     integration (Monday task #2844301706) or flip `ALLOW_REGISTRATION=true`
 *     temporarily, register via the UI, then flip back.
 *   - Leaving `CREATE_BOOTSTRAP_USER=true` on for subsequent deploys is
 *     harmless — the script short-circuits on any existing user count > 0.
 */

const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });

const { registerUser } = require('~/server/services/AuthService');
const User = require('~/models/User');
const connect = require('./connect');

// Ensure console.* colour helpers from config/helpers.js are available when
// running under entrypoint.sh (they attach to `console` on require).
require('./helpers');

const REQUIRED_ENV_VARS = [
  'BOOTSTRAP_USER_EMAIL',
  'BOOTSTRAP_USER_NAME',
  'BOOTSTRAP_USER_PASSWORD',
];

function fail(message, code = 1) {
  // Use stderr directly; do not touch the password.
  console.error(`[create-default-user] ERROR: ${message}`);
  process.exit(code);
}

(async () => {
  try {
    await connect();
  } catch (err) {
    fail(`Database connection failed: ${err && err.message ? err.message : err}`);
  }

  let userCount;
  try {
    userCount = await User.countDocuments();
  } catch (err) {
    fail(`Failed to count users: ${err && err.message ? err.message : err}`);
  }

  if (userCount > 0) {
    console.log(
      `[create-default-user] Users already exist (count=${userCount}), skipping bootstrap`,
    );
    process.exit(0);
  }

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Refusing to proceed — check the terraform wiring and that the ' +
        'bootstrap password secret has a value set.',
    );
  }

  const email = process.env.BOOTSTRAP_USER_EMAIL.trim();
  const name = process.env.BOOTSTRAP_USER_NAME.trim();
  const password = process.env.BOOTSTRAP_USER_PASSWORD;

  if (!email.includes('@')) {
    fail(`BOOTSTRAP_USER_EMAIL is not a valid email address: "${email}"`);
  }

  // Derive a username from the email local-part; AuthService requires one and
  // it must satisfy the registerSchema in librechat-data-provider. Strip any
  // chars that are not [a-z0-9_.-].
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_.-]/g, '');

  const userPayload = {
    email,
    password,
    name,
    username,
    confirm_password: password,
  };

  let result;
  try {
    result = await registerUser(userPayload, { emailVerified: true });
  } catch (err) {
    fail(`registerUser threw: ${err && err.message ? err.message : err}`);
  }

  if (!result || result.status !== 200) {
    fail(
      `registerUser returned non-200: status=${result && result.status} ` +
        `message=${result && result.message}`,
    );
  }

  // Verify the row landed. registerUser returns a generic verification
  // message regardless, so we double-check by querying the DB.
  const created = await User.findOne({ email });
  if (!created) {
    fail('registerUser reported success but user row was not found');
  }

  console.log(`[create-default-user] Bootstrap user created: ${email} (role=${created.role})`);
  process.exit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('[create-default-user] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('[create-default-user] Unhandled rejection:', err);
  process.exit(1);
});

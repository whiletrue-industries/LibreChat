#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const { createModels } = require('@librechat/data-schemas');
const { AdminPrompts } = require(path.join(
  __dirname,
  '..',
  'packages',
  'api',
  'dist',
  'index.js',
));

const REPO =
  process.env.PROMPTS_REPO ||
  path.join(__dirname, '..', '..', 'rebuilding-bots');

function fileFor(agentType) {
  return path.join(REPO, 'specs', agentType, 'agent.txt');
}

const writer = {
  async readFile(agentType) {
    const p = fileFor(agentType);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  },
  async writeFile(agentType, contents) {
    fs.writeFileSync(fileFor(agentType), contents, 'utf8');
  },
  async commitAndPush(message, changed) {
    const files = changed.map((a) => `specs/${a}/agent.txt`).join(' ');
    execSync(`git add ${files}`, { cwd: REPO, stdio: 'inherit' });
    execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: REPO, stdio: 'inherit' });
    const sha = execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim();
    execSync('git push origin main', { cwd: REPO, stdio: 'inherit' });
    return { committedSha: sha };
  },
};

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(mongoUri);
  const { AgentPrompt } = createModels(mongoose);
  const out = await AdminPrompts.runExport({ AgentPrompt, writer });
  console.log(JSON.stringify({ stage: 'done', ...out }));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ stage: 'fatal', error: e.message }));
  process.exit(1);
});

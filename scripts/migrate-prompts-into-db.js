#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
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

const SPECS_DIR =
  process.env.SPECS_DIR ||
  path.join(__dirname, '..', '..', 'rebuilding-bots', 'specs');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }
  await mongoose.connect(mongoUri);
  const { AgentPrompt } = createModels(mongoose);
  let total = 0;
  for (const agentType of ['unified', 'takanon', 'budgetkey']) {
    const file = path.join(SPECS_DIR, agentType, 'agent.txt');
    const contents = fs.readFileSync(file, 'utf8');
    const n = await AdminPrompts.migrateAgentTextIntoDb({
      AgentPrompt,
      agentType,
      fileContents: contents,
    });
    console.log(JSON.stringify({ stage: 'seeded', agentType, count: n }));
    total += n;
  }
  console.log(JSON.stringify({ stage: 'done', total }));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(JSON.stringify({ stage: 'fatal', error: err.message }));
  process.exit(1);
});

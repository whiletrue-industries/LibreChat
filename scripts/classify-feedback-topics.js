#!/usr/bin/env node
'use strict';

const path = require('path');
const mongoose = require('mongoose');
const { messageSchema } = require('@librechat/data-schemas');

const apiDist = path.join(__dirname, '..', 'packages', 'api', 'dist', 'index.js');
const { run, buildFakeLlm, buildOpenAiLlm } = require(apiDist);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri =
    args['mongo-uri'] || process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';
  const provider = args.llm || process.env.LLM_PROVIDER || 'openai';
  const limit = Number(args.limit) || 500;
  const dryRun = Boolean(args['dry-run']);

  const llm =
    provider === 'fake'
      ? buildFakeLlm({ default: 'other:unknown' })
      : buildOpenAiLlm(process.env.OPENAI_API_KEY || '');

  await mongoose.connect(mongoUri);
  const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

  try {
    const stats = await run({ Message, llm, limit, dryRun });
    console.log(JSON.stringify({ stage: 'done', ...stats }));
    process.exit(stats.errors > 0 ? 2 : 0);
  } finally {
    await mongoose.disconnect();
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const [key, value] = arg.slice(2).split('=');
    out[key] = value === undefined ? true : value;
  }
  return out;
}

main().catch((error) => {
  console.error(JSON.stringify({ stage: 'fatal', error: error.message }));
  process.exit(1);
});

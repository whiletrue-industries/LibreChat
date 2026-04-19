#!/usr/bin/env node
'use strict';

const path = require('path');
const mongoose = require('mongoose');
const { messageSchema, feedbackTopicPendingSchema } = require('@librechat/data-schemas');

const { AdminFeedback } = require(path.join(__dirname, '..', 'packages', 'api', 'dist', 'index.js'));
const { runDiscover, buildFakeLlm, buildOpenAiLlm } = AdminFeedback;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri =
    args['mongo-uri'] || process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';
  const provider = args.llm || process.env.LLM_PROVIDER || 'openai';
  const dryRun = Boolean(args['dry-run']);

  const llm =
    provider === 'fake'
      ? buildFakeLlm({ default: '[]' })
      : buildOpenAiLlm(process.env.OPENAI_API_KEY || '');

  await mongoose.connect(mongoUri);
  const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
  const PendingTopic =
    mongoose.models.FeedbackTopicPending ||
    mongoose.model('FeedbackTopicPending', feedbackTopicPendingSchema);

  try {
    const result = await runDiscover({ Message, PendingTopic, llm, dryRun });
    console.log(JSON.stringify({ stage: 'done', ...result }));
    process.exit(0);
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

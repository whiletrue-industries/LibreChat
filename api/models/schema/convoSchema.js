const mongoose = require('mongoose');
const mongoMeili = require('../plugins/mongoMeili');
const { conversationPreset } = require('./defaults');
const convoSchema = mongoose.Schema(
  {
    conversationId: {
      type: String,
      unique: true,
      required: true,
      index: true,
      meiliIndex: true,
    },
    title: {
      type: String,
      default: 'New Chat',
      meiliIndex: true,
    },
    user: {
      type: String,
      index: true,
    },
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
    // google only
    examples: { type: [{ type: mongoose.Schema.Types.Mixed }], default: undefined },
    agentOptions: {
      type: mongoose.Schema.Types.Mixed,
    },
    ...conversationPreset,
    // for bingAI only
    bingConversationId: {
      type: String,
    },
    jailbreakConversationId: {
      type: String,
    },
    conversationSignature: {
      type: String,
    },
    clientId: {
      type: String,
    },
    invocationId: {
      type: Number,
    },
    tags: {
      type: [String],
      default: [],
      meiliIndex: true,
    },
    /**
     * OpenAI Conversations API conversation id (e.g. `conv_abc123`) mapped
     * 1:1 to this LibreChat conversation. Populated lazily on the first
     * `responses.create` call for a given conversation; see
     * `api/server/services/Threads/manage.js#getOrCreateOpenAIConversation`.
     */
    openai_conversation_id: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

if (process.env.MEILI_HOST && process.env.MEILI_MASTER_KEY) {
  convoSchema.plugin(mongoMeili, {
    host: process.env.MEILI_HOST,
    apiKey: process.env.MEILI_MASTER_KEY,
    indexName: 'convos', // Will get created automatically if it doesn't exist already
    primaryKey: 'conversationId',
  });
}

convoSchema.index({ createdAt: 1, updatedAt: 1 });
convoSchema.index({ conversationId: 1, user: 1 }, { unique: true });

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', convoSchema);

module.exports = Conversation;

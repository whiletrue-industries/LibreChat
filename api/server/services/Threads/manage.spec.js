/**
 * Tests for the OpenAI Conversations API helpers in Threads/manage.js.
 *
 * These helpers are the migration path away from rebuilding the Responses
 * API `input` array from MongoDB on every turn. They look up (or create)
 * a server-side OpenAI Conversation id and persist the mapping on the
 * LibreChat conversation document.
 */

jest.mock('~/server/services/Files/process', () => ({
  retrieveAndProcessFile: jest.fn(),
}));

// Mock the Conversation + Message models so we don't need a live Mongo.
const mockConvoFindOne = jest.fn();
const mockConvoUpdateOne = jest.fn();
jest.mock('~/models/Conversation', () => ({
  Conversation: {
    findOne: (...args) => mockConvoFindOne(...args),
    updateOne: (...args) => mockConvoUpdateOne(...args),
  },
  saveConvo: jest.fn(),
}));

const mockGetMessages = jest.fn();
jest.mock('~/models/Message', () => ({
  getMessages: (...args) => mockGetMessages(...args),
  recordMessage: jest.fn(),
}));

jest.mock('~/models/spendTokens', () => ({
  spendTokens: jest.fn(),
}));

jest.mock('~/server/utils', () => ({
  countTokens: jest.fn().mockResolvedValue(0),
}));

const {
  buildConversationInput,
  getOrCreateOpenAIConversation,
  appendItemsToOpenAIConversation,
} = require('./manage');

describe('Threads/manage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildConversationInput', () => {
    test('returns [] for missing conversationId', async () => {
      const result = await buildConversationInput(null);
      expect(result).toEqual([]);
      expect(mockGetMessages).not.toHaveBeenCalled();
    });

    test('returns [] when there are no stored messages', async () => {
      mockGetMessages.mockResolvedValueOnce([]);
      const result = await buildConversationInput('convo-1');
      expect(result).toEqual([]);
    });

    test('converts a simple user+assistant exchange into role items', async () => {
      mockGetMessages.mockResolvedValueOnce([
        { isCreatedByUser: true, text: 'Hi' },
        { isCreatedByUser: false, text: 'Hello there', content: [] },
      ]);
      const result = await buildConversationInput('convo-1');
      expect(result).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
      ]);
    });

    test('splits an assistant tool-call message into function_call + function_call_output', async () => {
      mockGetMessages.mockResolvedValueOnce([
        { isCreatedByUser: true, text: 'What is 2+2?' },
        {
          isCreatedByUser: false,
          text: '4',
          content: [
            {
              type: 'tool_call',
              tool_call: {
                id: 'call_abc',
                function: {
                  name: 'calculator',
                  arguments: '{"input":"2+2"}',
                  output: '4',
                },
              },
            },
            {
              type: 'text',
              text: { value: 'The answer is 4.' },
            },
          ],
        },
      ]);
      const result = await buildConversationInput('convo-1');
      expect(result).toEqual([
        { role: 'user', content: 'What is 2+2?' },
        {
          type: 'function_call',
          call_id: 'call_abc',
          name: 'calculator',
          arguments: '{"input":"2+2"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_abc',
          output: '4',
        },
        { role: 'assistant', content: 'The answer is 4.' },
      ]);
    });

    test('skips user messages with empty text', async () => {
      mockGetMessages.mockResolvedValueOnce([
        { isCreatedByUser: true, text: '' },
        { isCreatedByUser: false, text: 'Nothing to respond to', content: [] },
      ]);
      const result = await buildConversationInput('convo-1');
      expect(result).toEqual([
        { role: 'assistant', content: 'Nothing to respond to' },
      ]);
    });
  });

  describe('getOrCreateOpenAIConversation', () => {
    /** @type {{ post: jest.Mock, apiKey: string }} */
    let openai;

    beforeEach(() => {
      openai = {
        post: jest.fn(),
        apiKey: 'sk-test',
      };
    });

    test('returns existing mapping without creating a new OpenAI conversation', async () => {
      mockConvoFindOne.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({ openai_conversation_id: 'conv_existing' }),
      });

      const result = await getOrCreateOpenAIConversation({
        openai,
        conversationId: 'lc-1',
        userId: 'user-1',
      });

      expect(result).toEqual({
        openai_conversation_id: 'conv_existing',
        created: false,
      });
      expect(openai.post).not.toHaveBeenCalled();
      expect(mockConvoUpdateOne).not.toHaveBeenCalled();
    });

    test('creates a new OpenAI conversation and persists the mapping when missing', async () => {
      mockConvoFindOne.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(null),
      });
      mockGetMessages.mockResolvedValueOnce([]);
      openai.post.mockResolvedValueOnce({ id: 'conv_new_123' });
      mockConvoUpdateOne.mockResolvedValueOnce({ acknowledged: true });

      const result = await getOrCreateOpenAIConversation({
        openai,
        conversationId: 'lc-2',
        userId: 'user-2',
      });

      expect(result).toEqual({
        openai_conversation_id: 'conv_new_123',
        created: true,
      });
      expect(openai.post).toHaveBeenCalledWith(
        '/conversations',
        expect.objectContaining({
          body: expect.objectContaining({
            metadata: { librechat_conversation_id: 'lc-2' },
          }),
        }),
      );
      // No seed items when there's no prior Mongo history.
      const [, { body }] = openai.post.mock.calls[0];
      expect(body.items).toBeUndefined();
      expect(mockConvoUpdateOne).toHaveBeenCalledWith(
        { conversationId: 'lc-2', user: 'user-2' },
        { $set: { openai_conversation_id: 'conv_new_123' } },
        { upsert: true },
      );
    });

    test('seeds the new conversation with prior MongoDB history when available', async () => {
      mockConvoFindOne.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({ openai_conversation_id: null }),
      });
      mockGetMessages.mockResolvedValueOnce([
        { isCreatedByUser: true, text: 'Hi' },
        { isCreatedByUser: false, text: 'Hello', content: [] },
      ]);
      openai.post.mockResolvedValueOnce({ id: 'conv_seeded' });
      mockConvoUpdateOne.mockResolvedValueOnce({ acknowledged: true });

      await getOrCreateOpenAIConversation({
        openai,
        conversationId: 'lc-3',
        userId: 'user-3',
      });

      const [, { body }] = openai.post.mock.calls[0];
      expect(body.items).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]);
    });

    test('throws when the OpenAI API returns no id', async () => {
      mockConvoFindOne.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(null),
      });
      mockGetMessages.mockResolvedValueOnce([]);
      openai.post.mockResolvedValueOnce({});

      await expect(
        getOrCreateOpenAIConversation({
          openai,
          conversationId: 'lc-4',
          userId: 'user-4',
        }),
      ).rejects.toThrow(/no id for lc-4/);
    });
  });

  describe('appendItemsToOpenAIConversation', () => {
    test('no-ops when the openai_conversation_id is missing', async () => {
      const openai = { post: jest.fn() };
      const result = await appendItemsToOpenAIConversation({
        openai,
        openai_conversation_id: '',
        items: [{ role: 'user', content: 'x' }],
      });
      expect(result).toBeNull();
      expect(openai.post).not.toHaveBeenCalled();
    });

    test('no-ops when the items list is empty', async () => {
      const openai = { post: jest.fn() };
      const result = await appendItemsToOpenAIConversation({
        openai,
        openai_conversation_id: 'conv_x',
        items: [],
      });
      expect(result).toBeNull();
      expect(openai.post).not.toHaveBeenCalled();
    });

    test('posts items to the expected path', async () => {
      const openai = { post: jest.fn().mockResolvedValue({ ok: true }) };
      const items = [{ role: 'user', content: 'hi' }];
      const result = await appendItemsToOpenAIConversation({
        openai,
        openai_conversation_id: 'conv_abc',
        items,
      });
      expect(openai.post).toHaveBeenCalledWith(
        '/conversations/conv_abc/items',
        { body: { items } },
      );
      expect(result).toEqual({ ok: true });
    });
  });
});

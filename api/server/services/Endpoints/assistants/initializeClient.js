const OpenAI = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ErrorTypes, EModelEndpoint } = require('librechat-data-provider');
const {
  getUserKeyValues,
  getUserKeyExpiry,
  checkUserKeyExpiry,
} = require('~/server/services/UserService');
const OpenAIClient = require('~/app/clients/OpenAIClient');
const { isUserProvided } = require('~/server/utils');

const initializeClient = async ({ req, res, endpointOption, version, initAppClient = false }) => {
  const { PROXY, OPENAI_ORGANIZATION, ASSISTANTS_API_KEY, ASSISTANTS_BASE_URL } = process.env;

  const userProvidesKey = isUserProvided(ASSISTANTS_API_KEY);
  const userProvidesURL = isUserProvided(ASSISTANTS_BASE_URL);

  let userValues = null;
  if (userProvidesKey || userProvidesURL) {
    const expiresAt = await getUserKeyExpiry({
      userId: req.user.id,
      name: EModelEndpoint.assistants,
    });
    checkUserKeyExpiry(expiresAt, EModelEndpoint.assistants);
    userValues = await getUserKeyValues({ userId: req.user.id, name: EModelEndpoint.assistants });
  }

  let apiKey = userProvidesKey ? userValues.apiKey : ASSISTANTS_API_KEY;
  let baseURL = userProvidesURL ? userValues.baseURL : ASSISTANTS_BASE_URL;

  // NOTE: the `OpenAI-Beta: assistants=v2` header was required for the
  // retired Assistants API threads/runs path. With the Responses-API
  // migration this header is no longer needed, and some org keys now
  // reject it with `400 Unknown beta requested: 'assistants'`. We
  // intentionally skip it. The `version` arg is kept for signature
  // compatibility with callers that still list it.
  void version;
  const opts = {
    defaultHeaders: {},
  };

  const clientOptions = {
    reverseProxyUrl: baseURL ?? null,
    proxy: PROXY ?? null,
    req,
    res,
    ...endpointOption,
  };

  if (userProvidesKey & !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (!apiKey) {
    throw new Error('Assistants API key not provided. Please provide it again.');
  }

  if (baseURL) {
    opts.baseURL = baseURL;
  }

  if (PROXY) {
    opts.httpAgent = new HttpsProxyAgent(PROXY);
  }

  if (OPENAI_ORGANIZATION) {
    opts.organization = OPENAI_ORGANIZATION;
  }

  /** @type {OpenAIClient} */
  const openai = new OpenAI({
    apiKey,
    ...opts,
  });

  openai.req = req;
  openai.res = res;

  if (endpointOption && initAppClient) {
    const client = new OpenAIClient(apiKey, clientOptions);
    return {
      client,
      openai,
      openAIApiKey: apiKey,
    };
  }

  return {
    openai,
    openAIApiKey: apiKey,
  };
};

module.exports = initializeClient;

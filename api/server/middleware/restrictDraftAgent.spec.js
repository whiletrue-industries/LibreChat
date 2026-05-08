const { SystemRoles } = require('librechat-data-provider');
const restrictDraftAgent = require('./restrictDraftAgent');
const { getAgent } = require('~/models/Agent');

jest.mock('~/models/Agent');
jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('restrictDraftAgent middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      user: { id: 'user123', role: 'user' },
      body: { endpoint: 'agents', agent_id: 'agent_canonical' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('returns 403 when a non-admin selects a draft agent', async () => {
    mockReq.body.agent_id = 'agent_draft';
    getAgent.mockResolvedValue({ id: 'agent_draft', draft: true });

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      message: 'Draft agents are restricted to administrators.',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() when an admin selects a draft agent', async () => {
    mockReq.user.role = SystemRoles.ADMIN;
    mockReq.body.agent_id = 'agent_draft';
    getAgent.mockResolvedValue({ id: 'agent_draft', draft: true });

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('calls next() when a non-admin selects a non-draft agent', async () => {
    getAgent.mockResolvedValue({ id: 'agent_canonical', draft: false });

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('calls next() when agent has no draft field (legacy doc)', async () => {
    getAgent.mockResolvedValue({ id: 'agent_canonical' });

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('calls next() when agent_id is missing from body (let downstream handle)', async () => {
    delete mockReq.body.agent_id;

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('calls next() when agent_id is ephemeral', async () => {
    mockReq.body.agent_id = 'ephemeral';

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('calls next() when agent is not found (let downstream produce 404)', async () => {
    getAgent.mockResolvedValue(null);

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('returns 500 when agent lookup throws', async () => {
    getAgent.mockRejectedValue(new Error('db down'));

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Internal Server Error',
      message: 'Failed to validate draft agent restriction',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockReq.user = null;
    mockReq.body.agent_id = 'agent_draft';
    getAgent.mockResolvedValue({ id: 'agent_draft', draft: true });

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('uses pre-resolved req.resourceAccess.resourceInfo when available (avoids extra getAgent call)', async () => {
    mockReq.body.agent_id = 'agent_draft';
    mockReq.resourceAccess = {
      resourceInfo: { id: 'agent_draft', draft: true },
    };

    await restrictDraftAgent(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(getAgent).not.toHaveBeenCalled();
  });
});

const { logger } = require('@librechat/data-schemas');
const { SystemRoles, isEphemeralAgentId } = require('librechat-data-provider');
const { getAgent } = require('~/models/Agent');

/**
 * Last-line-of-defense middleware that blocks non-admin users from selecting
 * the draft mirror of an agent (Agent doc with `draft: true`). The draft is
 * intended for admin preview only; the regular UI should already hide it from
 * non-admin switchers, but a user could still craft `?agent_id=<draftId>` by
 * hand. This middleware enforces the rule on the chat / message-send routes
 * after access permissions have been validated.
 *
 * Resolution: prefers a pre-resolved agent on `req.resourceAccess.resourceInfo`
 * (populated by `canAccessAgentFromBody` for non-admin users) and falls back
 * to a direct `getAgent` lookup. Admins always pass through.
 */
async function restrictDraftAgent(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  if (req.user.role === SystemRoles.ADMIN) {
    return next();
  }

  const agentId = req.body?.agent_id;
  if (!agentId || typeof agentId !== 'string' || isEphemeralAgentId(agentId)) {
    return next();
  }

  try {
    const preResolved = req.resourceAccess?.resourceInfo;
    const agent =
      preResolved && (preResolved.id === agentId || preResolved._id != null)
        ? preResolved
        : await getAgent({ id: agentId });

    if (!agent) {
      return next();
    }

    if (!agent.draft) {
      return next();
    }

    logger.warn(
      `[restrictDraftAgent] blocked non-admin user ${req.user.id} from draft agent ${agentId}`,
    );

    return res.status(403).json({
      error: 'Forbidden',
      message: 'Draft agents are restricted to administrators.',
    });
  } catch (error) {
    logger.error('[restrictDraftAgent] failed to validate draft restriction', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate draft agent restriction',
    });
  }
}

module.exports = restrictDraftAgent;

function buildRealAgentsClient({ apiBase, authToken }) {
  async function http(method, path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${method} ${path}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    async getAgent(id) {
      const a = await http('GET', `/api/agents/${encodeURIComponent(id)}`);
      return {
        id: a.id,
        name: a.name,
        model: a.model,
        instructions: a.instructions ?? '',
        actions: a.actions,
      };
    },
    async createAgent(input) {
      const a = await http('POST', '/api/agents', input);
      return { id: a.id, ...input };
    },
    async patchAgent(id, patch) {
      const a = await http(
        'PATCH',
        `/api/agents/${encodeURIComponent(id)}`,
        patch,
      );
      return { id, ...patch, ...a };
    },
    async deleteAgent(id) {
      await http('DELETE', `/api/agents/${encodeURIComponent(id)}`);
    },
    async chat(id, message) {
      const out = await http('POST', '/api/ask', {
        endpoint: 'agents',
        agent_id: id,
        text: message,
        stream: false,
      });
      return { answer: out.text ?? '', toolCalls: out.toolCalls ?? [] };
    },
  };
}

module.exports = { buildRealAgentsClient };

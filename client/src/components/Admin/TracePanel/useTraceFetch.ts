import { useQuery } from '@tanstack/react-query';
import type { TraceDTO } from './types';

export function useTraceFetch(
  traceId: string | undefined,
  enabled: boolean,
  token?: string,
) {
  return useQuery<TraceDTO>({
    queryKey: ['phoenix-trace', traceId, !!token],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const r = await fetch(`/api/botnim/traces/${traceId}`, {
        credentials: 'include',
        headers,
      });
      if (!r.ok) throw new Error(`trace fetch failed: ${r.status}`);
      return r.json();
    },
    enabled: enabled && !!traceId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

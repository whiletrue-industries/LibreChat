import React from 'react';
import { useAdminSourceQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import Sparkline from './Sparkline';

type Props = { context: string };

const externalLink = (sourceId: string): string | null => {
  if (sourceId === 'lexicon' || sourceId === 'bk_csv' || sourceId === 'common-knowledge') {
    return null;
  }
  if (sourceId.startsWith('knesset_')) {
    return null;
  }
  return `https://he.wikisource.org/wiki/${encodeURIComponent(sourceId)}`;
};

const ROW_GRID = 'grid grid-cols-[1fr_90px_120px_70px_30px] items-center';

const SourceBreakdown: React.FC<Props> = ({ context }) => {
  const localize = useLocalize();
  const { data, isLoading, error } = useAdminSourceQuery(context, { enabled: true });

  if (isLoading) {
    return (
      <div className="bg-surface-primary-alt p-4 text-sm text-text-secondary">
        loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-surface-primary-alt p-4 text-sm text-red-600 dark:text-red-400">
        error
      </div>
    );
  }
  if (!data || !data.context_summary) {
    return (
      <div className="bg-surface-primary-alt p-4 text-sm text-text-secondary">
        no snapshots
      </div>
    );
  }

  return (
    <div className="bg-surface-primary-alt p-4">
      <div className="mb-3">
        <Sparkline points={data.context_summary.sparkline} width={500} height={64} />
      </div>
      <div
        className={
          ROW_GRID +
          ' border-b border-border-medium px-1 py-2 text-xs uppercase tracking-wider text-text-secondary'
        }
      >
        <div>Source</div>
        <div className="text-right">{localize('com_admin_sources_col_chunks')}</div>
        <div>{localize('com_admin_sources_col_trend')}</div>
        <div className="text-right">7d Δ</div>
        <div />
      </div>
      {data.sources.map((s) => {
        const href = externalLink(s.source_id);
        const deltaClass =
          s.delta_7d > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : s.delta_7d < 0
            ? 'text-red-600 dark:text-red-400'
            : 'text-text-secondary';
        return (
          <div
            key={s.source_id}
            className={ROW_GRID + ' border-b border-border-light px-1 py-2 text-sm'}
          >
            <div className="text-text-primary">{s.source_id}</div>
            <div className="text-right tabular-nums text-text-primary">
              {s.doc_count.toLocaleString()}
            </div>
            <div>
              <Sparkline points={s.sparkline} width={110} height={18} />
            </div>
            <div className={'text-right tabular-nums ' + deltaClass}>
              {s.delta_7d >= 0 ? '+' : ''}
              {s.delta_7d}
            </div>
            <div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  ↗
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SourceBreakdown;

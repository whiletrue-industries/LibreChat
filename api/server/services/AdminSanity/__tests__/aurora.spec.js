'use strict';

const { listRuns, getRunHtml } = require('../aurora');

function fakePool(rows) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

describe('AdminSanity aurora service', () => {
  beforeEach(() => {
    process.env.SANITY_DASHBOARD_ENV = 'staging';
  });

  it('listRuns returns rows ordered descending and respects limit', async () => {
    const pool = fakePool([
      { id: 'a', env: 'staging', started_at: new Date(), finished_at: new Date(), status: 'succeeded',
        total_rows: 11, ab_new_wins: 5, ab_old_wins: 3, ab_ties: 3,
        rubric_pass: 8, rubric_fail: 1, rubric_xfail: 2, rubric_infra: 0,
        pass_rate: '0.889', alert_severity: null, alert_reasons: null },
    ]);
    const out = await listRuns({ limit: 50, pool });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].pass_rate).toBeCloseTo(0.889, 3);
    expect(out[0].alert_reasons).toEqual([]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY started_at DESC'), ['staging', 50]);
  });

  it('getRunHtml returns html + started_at', async () => {
    const pool = fakePool([{ html: '<p>hi</p>', started_at: new Date() }]);
    const out = await getRunHtml('rid', { pool });
    expect(out.html).toBe('<p>hi</p>');
    expect(out.started_at).toBeInstanceOf(Date);
  });

  it('getRunHtml throws not_found for missing id', async () => {
    const pool = fakePool([]);
    await expect(getRunHtml('rid', { pool })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('getRunHtml throws not_found when html column is null', async () => {
    const pool = fakePool([{ html: null, started_at: new Date() }]);
    await expect(getRunHtml('rid', { pool })).rejects.toMatchObject({ code: 'not_found' });
  });
});

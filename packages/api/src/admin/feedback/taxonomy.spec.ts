import { initialTaxonomy, matchTaxonomy } from './taxonomy';

describe('matchTaxonomy', () => {
  it('matches a budget question', () => {
    const result = matchTaxonomy('מה תקציב משרד החינוך לשנת 2025?');
    expect(result).toBe('budget_ministries');
  });

  it('matches a takanon question', () => {
    const result = matchTaxonomy('מה אומר סעיף 106 לתקנון הכנסת?');
    expect(result).toBe('takanon_sections');
  });

  it('returns null on no match', () => {
    const result = matchTaxonomy('מה השעה עכשיו?');
    expect(result).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(matchTaxonomy('')).toBeNull();
    expect(matchTaxonomy('   ')).toBeNull();
  });

  it('initial taxonomy has stable keys and non-empty Hebrew labels', () => {
    for (const entry of initialTaxonomy) {
      expect(entry.key).toMatch(/^[a-z_]+$/);
      expect(entry.labelHe.length).toBeGreaterThan(0);
    }
  });
});

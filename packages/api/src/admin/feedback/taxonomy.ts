export interface TaxonomyEntry {
  key: string;
  labelHe: string;
  labelEn: string;
  keywords: string[];
}

export const initialTaxonomy: TaxonomyEntry[] = [
  {
    key: 'budget_ministries',
    labelHe: 'תקציב משרדי',
    labelEn: 'Ministry budgets',
    keywords: ['תקציב משרד', 'תקציב חינוך', 'תקציב הבריאות', 'תקציב ביטחון'],
  },
  {
    key: 'budget_general',
    labelHe: 'תקציב המדינה',
    labelEn: 'State budget',
    keywords: ['תקציב המדינה', 'הצעת התקציב', 'חוק התקציב'],
  },
  {
    key: 'budget_transfers',
    labelHe: 'העברות תקציביות',
    labelEn: 'Budget transfers',
    keywords: ['העברה תקציבית', 'פניה תקציבית'],
  },
  {
    key: 'procurement',
    labelHe: 'רכש',
    labelEn: 'Procurement',
    keywords: ['רכש', 'מכרז', 'ספק'],
  },
  {
    key: 'grants',
    labelHe: 'תמיכות',
    labelEn: 'Grants',
    keywords: ['תמיכה', 'תמיכות', 'מבחן תמיכה'],
  },
  {
    key: 'takanon_sections',
    labelHe: 'תקנון הכנסת',
    labelEn: 'Knesset bylaws',
    keywords: ['תקנון הכנסת', 'סעיף בתקנון', 'סדר יום'],
  },
  {
    key: 'ethics',
    labelHe: 'ועדת האתיקה',
    labelEn: 'Ethics committee',
    keywords: ['אתיקה', 'ועדת האתיקה', 'חבר כנסת', 'תרומה'],
  },
  {
    key: 'committees',
    labelHe: 'ועדות הכנסת',
    labelEn: 'Knesset committees',
    keywords: ['ועדה', 'ועדות', 'ישיבת ועדה'],
  },
  {
    key: 'mk_conduct',
    labelHe: 'התנהלות חברי כנסת',
    labelEn: 'MK conduct',
    keywords: ['חסינות', 'תפקיד מקביל', 'ניגוד עניינים'],
  },
  {
    key: 'legislation',
    labelHe: 'חקיקה',
    labelEn: 'Legislation',
    keywords: ['הצעת חוק', 'חוק יסוד', 'קריאה ראשונה', 'קריאה שנייה'],
  },
  {
    key: 'plenary',
    labelHe: 'מליאה',
    labelEn: 'Plenary',
    keywords: ['מליאה', 'דיון במליאה', 'הצבעה'],
  },
  {
    key: 'government_decisions',
    labelHe: 'החלטות ממשלה',
    labelEn: 'Government decisions',
    keywords: ['החלטת ממשלה', 'מאגר החלטות'],
  },
  {
    key: 'courts',
    labelHe: 'פסיקה',
    labelEn: 'Courts',
    keywords: ['פסק דין', 'בג"ץ', 'בית משפט'],
  },
  {
    key: 'finance_committee',
    labelHe: 'ועדת הכספים',
    labelEn: 'Finance committee',
    keywords: ['ועדת הכספים', 'ועדת כספים'],
  },
  {
    key: 'data_coverage',
    labelHe: 'כיסוי מידע',
    labelEn: 'Data coverage',
    keywords: ['אין מידע', 'לא מצאתי', 'לא מכיר'],
  },
];

export function matchTaxonomy(text: string): string | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  for (const entry of initialTaxonomy) {
    for (const keyword of entry.keywords) {
      if (trimmed.includes(keyword)) {
        return entry.key;
      }
    }
  }
  return null;
}

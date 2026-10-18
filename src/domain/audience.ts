// Qloo audience index for an artist (insights filter.type=urn:demographics). Artist-level: it does not vary by city.
export interface AudienceProfile {
  readonly topAge: { readonly band: string; readonly index: number };
  readonly gender: { readonly group: string; readonly index: number } | null;
}
export interface AudienceView extends AudienceProfile { readonly text: string }

const BAND: Record<string, string> = { '24_and_younger': 'under 25', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55+', '35_and_younger': 'under 35', '36_to_55': '36–55' };

export function describeAudience(p: AudienceProfile): AudienceView {
  const age = `${BAND[p.topAge.band] ?? p.topAge.band} (+${p.topAge.index.toFixed(2)})`;
  const g = p.gender && p.gender.index > 0 ? ` and ${p.gender.group} (+${p.gender.index.toFixed(2)})` : '';
  return { ...p, text: `Qloo audience index skews ${age}${g}. Artist-level, not city-specific.` };
}

/** Pick the strongest positive age band and gender from a Qloo demographics `query` object. */
export function parseDemographics(q: any): AudienceProfile | null {
  const entries = Object.entries(q?.age ?? {}).filter(([, v]) => typeof v === 'number') as [string, number][];
  if (!entries.length) return null;
  const [band, index] = entries.sort((a, b) => b[1] - a[1])[0];
  const gs = Object.entries(q?.gender ?? {}).filter(([, v]) => typeof v === 'number') as [string, number][];
  const g = gs.sort((a, b) => b[1] - a[1])[0];
  return { topAge: { band, index }, gender: g ? { group: g[0], index: g[1] } : null };
}

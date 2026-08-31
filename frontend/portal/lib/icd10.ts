export interface Icd10Suggestion {
  code: string;
  name: string;
}

const ICD10_SEARCH_URL = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";

// NLM's Clinical Table Search Service — free, keyless, CORS-enabled search
// over the full US ICD-10-CM code set (clinicaltables.nlm.nih.gov). Backs
// IcdCodeSelect's diagnosis-code autocomplete. US-only: no equivalent free
// API is wired up for other countries' diagnosis code sets — see SPEC.md §3.
export async function searchIcd10Codes(query: string, maxList = 8): Promise<Icd10Suggestion[]> {
  const url = new URL(ICD10_SEARCH_URL);
  url.searchParams.set("terms", query);
  url.searchParams.set("sf", "code,name");
  url.searchParams.set("df", "code,name");
  url.searchParams.set("maxList", String(maxList));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`ICD-10 lookup failed (${res.status})`);
  }
  // Response shape: [totalCount, codes[], extraData, displayRows[][]] — with
  // df=code,name, each displayRows[i] is [code, name].
  const data = (await res.json()) as [number, string[], unknown, [string, string][]];
  const rows = data[3] ?? [];
  return rows.map(([code, name]) => ({ code, name }));
}

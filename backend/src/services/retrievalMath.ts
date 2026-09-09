const STOPWORDS = new Set("de la el los las un una unos unas y o en con por para que del al es son se su sus como the a an of in on is and or with by to".split(" "));
export function terms(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 1 && !STOPWORDS.has(t)) ?? [];
}

export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  if (size <= overlap || overlap < 0) throw new Error('Invalid chunk size');
  const clean = text.replace(/\r/g, '').trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(' ', end);
      if (boundary > start + size / 2) end = boundary;
    }
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

export type Ranked = { id: number; score: number };
export class BM25 {
  private frequencies: Map<string, number>[];
  private lengths: number[];
  private df = new Map<string, number>();
  private average: number;
  constructor(documents: string[]) {
    this.frequencies = documents.map(text => {
      const counts = new Map<string, number>();
      for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const term of counts.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      return counts;
    });
    this.lengths = this.frequencies.map(f => [...f.values()].reduce((a, b) => a + b, 0));
    this.average = this.lengths.reduce((a, b) => a + b, 0) / (documents.length || 1) || 1;
  }
  search(query: string): Ranked[] {
    const tokens = [...new Set(terms(query))];
    const n = this.frequencies.length;
    return this.frequencies.map((f, id) => ({ id, score: tokens.reduce((score, t) => {
      const tf = f.get(t) ?? 0;
      const df = this.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      return score + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.lengths[id] / this.average));
    }, 0) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.id - b.id);
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) throw new Error('Invalid embedding dimensions');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function reciprocalRankFusion(rankings: Ranked[][], k = 60): Ranked[] {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    const seen = new Set<number>();
    ranking.forEach(({ id }, rank) => {
      if (!seen.has(id)) scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      seen.add(id);
    });
  }
  return [...scores].map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

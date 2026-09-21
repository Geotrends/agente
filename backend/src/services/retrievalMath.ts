const STOPWORDS = new Set("de la el los las un una unos unas y o en con por para que del al es son se su sus como the a an of in on is and or with by to".split(" "));
export function terms(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 1 && !STOPWORDS.has(t)) ?? [];
}

/**
 * Corta el texto en fragmentos solapados.
 *
 * La validación es `overlap < size / 2`, no `overlap < size`, y la diferencia
 * es un bucle infinito (hallazgo M-11). El retroceso por frontera de palabra
 * acepta cualquier `end > start + size/2`, y el avance es `start = end -
 * overlap`: con `size=200, overlap=150`, `end` puede quedar en `start+101` y el
 * siguiente `start` en `start-49` — retrocede, y el bucle no termina nunca
 * hasta agotar la memoria. Los valores en uso (1000/150) son seguros, así que
 * el fallo estaba dormido; la condición estricta lo despierta como error claro
 * en el punto de llamada en vez de como un cuelgue.
 */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  if (overlap < 0) throw new Error('Invalid chunk size: overlap negativo');
  if (overlap >= size / 2) {
    throw new Error(`Invalid chunk size: overlap (${overlap}) debe ser menor que size/2 (${size / 2}); si no, el avance puede retroceder y el bucle no termina`);
  }
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

/**
 * Una consulta léxica: texto plano, o varios tramos con peso distinto.
 *
 * Los tramos existen para la reescritura de consultas de seguimiento (hallazgo
 * M-2): la pregunta anterior aporta contexto, pero no debe puntuar igual que la
 * que el usuario acaba de escribir. Un string suelto equivale a un solo tramo
 * de peso 1, así que el comportamiento anterior no cambia.
 */
export type QuerySegment = { text: string; weight: number };
export type WeightedQuery = string | QuerySegment[];

/**
 * Términos de la consulta con su peso. Un término que aparece en varios tramos
 * se queda con el mayor: si el usuario repite una palabra de la pregunta
 * anterior en la actual, esa palabra es suya, no contexto heredado.
 */
export function weighQueryTerms(query: WeightedQuery): Map<string, number> {
  const segments = typeof query === 'string' ? [{ text: query, weight: 1 }] : query;
  const weighted = new Map<string, number>();
  for (const { text, weight } of segments) {
    if (!(weight > 0)) continue;
    for (const token of terms(text)) {
      const previous = weighted.get(token);
      if (previous === undefined || weight > previous) weighted.set(token, weight);
    }
  }
  return weighted;
}

/** Constantes de BM25. Congeladas durante el plan de refactor del índice. */
const K1 = 1.2;
const B = 0.75;

/**
 * Implementación original: un `Map<término, tf>` por documento.
 *
 * La sustituyó `BM25` (índice invertido CSR) en la fase F2, porque sobre el
 * corpus real ocupaba 1.322 MB —el 74 % del heap restante— y obligaba a puntuar
 * los 181.339 fragmentos en cada consulta.
 *
 * Se conserva como REFERENCIA DE PRUEBAS: `test/bm25-contract.test.ts` verifica
 * que la implementación nueva devuelve exactamente lo mismo, con tolerancia
 * cero. No se instancia en producción.
 */
/** Arreglo Int32 que crece por duplicación. Solo se usa al construir el índice. */
class Int32Buffer {
  private data: Int32Array;
  length = 0;
  constructor(capacity = 1 << 16) { this.data = new Int32Array(capacity); }
  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }
  at(index: number): number { return this.data[index]; }
  release(): void { this.data = new Int32Array(0); this.length = 0; }
}

/** Primera posición en `values[from, to)` cuyo valor es >= `target`. */
function lowerBound(values: Int32Array, from: number, to: number, target: number): number {
  let low = from;
  let high = to;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * BM25 sobre un índice invertido en formato CSR (*compressed sparse row*).
 *
 * Misma fórmula y mismas constantes que `NaiveBM25`; lo que cambia es la
 * estructura. En lugar de un `Map` de JavaScript por documento —181.339 mapas,
 * 1.322 MB de heap medidos sobre el corpus real— hay:
 *
 *   dictionary  término → termId
 *   start       offsets CSR: los postings de t están en [start[t], start[t+1])
 *   postingDoc  id de documento          (Int32Array, fuera del heap)
 *   postingTf   frecuencia en ese doc    (Uint16Array, fuera del heap)
 *
 * Una consulta recorre solo los postings de sus términos —unos miles— en vez de
 * puntuar los 181.339 documentos.
 *
 * Los postings de cada término quedan ordenados por id de documento, lo que
 * permite acotar un rango con búsqueda binaria en vez de recorrer y descartar.
 *
 * CONCURRENCIA: `search()` usa un acumulador compartido por instancia, así que
 * NO es reentrante. Es seguro porque el método es enteramente síncrono y Node
 * no puede intercalar dos llamadas. Introducir un `await` dentro rompería esa
 * invariante en silencio.
 */
/**
 * Estado serializable del índice invertido. Todo son búferes planos, así que
 * volcarlo a disco y volver a leerlo no requiere parsear nada (ver
 * services/indexSnapshot.ts).
 */
export type Bm25Snapshot = {
  /** Términos en UTF-8, concatenados en orden de termId. */
  terms: Uint8Array;
  /** `termCount + 1` posiciones dentro de `terms`. */
  termOffsets: Int32Array;
  start: Int32Array;
  postingDoc: Int32Array;
  postingTf: Uint16Array;
  lengths: Int32Array;
  total: number;
  average: number;
};

function isSnapshot(source: Iterable<string> | Bm25Snapshot): source is Bm25Snapshot {
  return typeof source === "object" && source !== null && "postingDoc" in source;
}

export class BM25 {
  private readonly dictionary = new Map<string, number>();
  private readonly start: Int32Array;
  private readonly postingDoc: Int32Array;
  private readonly postingTf: Uint16Array;
  private readonly lengths: Int32Array;
  private readonly average: number;
  private readonly total: number;
  /** Puntaje parcial por documento; solo se limpian las posiciones tocadas. */
  private readonly accumulator: Float64Array;
  private readonly touched: Int32Array;

  /** Bytes que el índice ocupa fuera del heap de V8. Para el banco de medición. */
  get byteLength(): number {
    return this.start.byteLength + this.postingDoc.byteLength + this.postingTf.byteLength
      + this.lengths.byteLength + this.accumulator.byteLength + this.touched.byteLength;
  }

  /** Número de postings almacenados. Para el banco de medición. */
  get postingCount(): number {
    return this.postingDoc.length;
  }

  /**
   * Vuelca el índice a búferes planos. El diccionario se guarda solo como los
   * términos concatenados en orden de termId: los ids son su posición, así que
   * no hace falta almacenarlos.
   */
  toSnapshot(): Bm25Snapshot {
    const encoder = new TextEncoder();
    const encoded = new Array<Uint8Array>(this.dictionary.size);
    let totalBytes = 0;
    for (const [term, termId] of this.dictionary) {
      const bytes = encoder.encode(term);
      encoded[termId] = bytes;
      totalBytes += bytes.length;
    }
    const terms = new Uint8Array(totalBytes);
    const termOffsets = new Int32Array(encoded.length + 1);
    let offset = 0;
    for (let termId = 0; termId < encoded.length; termId++) {
      terms.set(encoded[termId], offset);
      offset += encoded[termId].length;
      termOffsets[termId + 1] = offset;
    }
    return {
      terms, termOffsets,
      start: this.start,
      postingDoc: this.postingDoc,
      postingTf: this.postingTf,
      lengths: this.lengths,
      total: this.total,
      average: this.average,
    };
  }

  constructor(source: Iterable<string> | Bm25Snapshot) {
    if (isSnapshot(source)) {
      const decoder = new TextDecoder();
      for (let termId = 0; termId + 1 < source.termOffsets.length; termId++) {
        const term = decoder.decode(
          source.terms.subarray(source.termOffsets[termId], source.termOffsets[termId + 1]));
        this.dictionary.set(term, termId);
      }
      this.start = source.start;
      this.postingDoc = source.postingDoc;
      this.postingTf = source.postingTf;
      this.lengths = source.lengths;
      this.total = source.total;
      this.average = source.average;
      this.accumulator = new Float64Array(this.total);
      this.touched = new Int32Array(this.total);
      return;
    }
    const documents = source;
    // Se emiten los postings en orden de documento y luego se agrupan por
    // término con un conteo estable, que conserva ese orden dentro de cada uno.
    const termOf = new Int32Buffer();
    const docOf = new Int32Buffer();
    const tfOf = new Int32Buffer();
    const documentFrequency: number[] = [];
    const lengths: number[] = [];
    const counts = new Map<number, number>();
    let total = 0;
    let totalLength = 0;

    for (const text of documents) {
      counts.clear();
      let length = 0;
      for (const token of terms(text)) {
        let termId = this.dictionary.get(token);
        if (termId === undefined) {
          termId = this.dictionary.size;
          this.dictionary.set(token, termId);
          documentFrequency.push(0);
        }
        counts.set(termId, (counts.get(termId) ?? 0) + 1);
        length++;
      }
      for (const [termId, frequency] of counts) {
        termOf.push(termId);
        docOf.push(total);
        // Un fragmento de 1.000 caracteres no llega a 500 tokens; el tope solo
        // protege de un documento anómalo.
        tfOf.push(Math.min(frequency, 0xffff));
        documentFrequency[termId]++;
      }
      lengths.push(length);
      totalLength += length;
      total++;
    }

    this.total = total;
    this.lengths = Int32Array.from(lengths);
    // Mismas guardas que NaiveBM25: corpus vacío o sin tokens ⇒ media 1.
    this.average = totalLength / (total || 1) || 1;

    const termCount = this.dictionary.size;
    this.start = new Int32Array(termCount + 1);
    for (let termId = 0; termId < termCount; termId++) {
      this.start[termId + 1] = this.start[termId] + documentFrequency[termId];
    }
    const totalPostings = this.start[termCount];
    this.postingDoc = new Int32Array(totalPostings);
    this.postingTf = new Uint16Array(totalPostings);

    const cursor = this.start.slice(0, termCount);
    for (let posting = 0; posting < termOf.length; posting++) {
      const slot = cursor[termOf.at(posting)]++;
      this.postingDoc[slot] = docOf.at(posting);
      this.postingTf[slot] = tfOf.at(posting);
    }
    termOf.release(); docOf.release(); tfOf.release();

    this.accumulator = new Float64Array(total);
    this.touched = new Int32Array(total);
  }

  /**
   * `lo`/`hi` acotan el rango de documentos (F3 los usará para los prefijos de
   * carpeta). `eligible` filtra al seleccionar, no al recorrer los postings:
   * son miles de candidatos frente a millones de postings.
   *
   * `k` sin valor devuelve TODOS los documentos con puntaje positivo, que es lo
   * que hacía `NaiveBM25` y lo que esperan las pruebas del contrato. Sobre el
   * corpus completo eso reserva un arreglo del tamaño de los candidatos —decenas
   * de miles— y ordena la lista entera: pasar un `k` acotado es un orden de
   * magnitud más rápido, y es lo que hace `hybridSearch`.
   */
  search(
    query: WeightedQuery,
    lo = 0,
    hi = this.total,
    k = Number.POSITIVE_INFINITY,
    eligible?: (id: number) => boolean,
  ): Ranked[] {
    const accumulator = this.accumulator;
    const touched = this.touched;
    let count = 0;

    for (const [token, weight] of weighQueryTerms(query)) {
      const termId = this.dictionary.get(token);
      if (termId === undefined) continue;
      const to = this.start[termId + 1];
      const df = to - this.start[termId];
      const idf = Math.log(1 + (this.total - df + 0.5) / (df + 0.5));

      for (let posting = lowerBound(this.postingDoc, this.start[termId], to, lo); posting < to; posting++) {
        const id = this.postingDoc[posting];
        if (id >= hi) break;
        const tf = this.postingTf[posting];
        // Cada contribución es estrictamente positiva (idf > 0, tf >= 1 y
        // weight > 0), así que un acumulador en 0 significa "documento no
        // visto todavía".
        if (accumulator[id] === 0) touched[count++] = id;
        accumulator[id] += weight * idf * tf * (K1 + 1) /
          (tf + K1 * (1 - B + B * this.lengths[id] / this.average));
      }
    }

    const ranked = selectTopK(accumulator, touched, count, k, eligible);
    for (let i = 0; i < count; i++) accumulator[touched[i]] = 0;
    return ranked;
  }
}

/** Índice del peor elemento bajo el orden (puntaje desc, id asc). */
function worstSlot(ids: Int32Array, scores: Float64Array, size: number): number {
  let worst = 0;
  for (let slot = 1; slot < size; slot++) {
    if (scores[slot] < scores[worst] || (scores[slot] === scores[worst] && ids[slot] > ids[worst])) {
      worst = slot;
    }
  }
  return worst;
}

/**
 * Los `k` mejores entre los documentos tocados, con el mismo desempate que el
 * ordenamiento total que hacía `NaiveBM25`: puntaje descendente, id ascendente.
 *
 * `touched` no viene ordenado —los postings de distintos términos se
 * entremezclan—, así que la comparación tiene que aplicar el orden completo y
 * no basta con comparar puntajes.
 */
function selectTopK(
  accumulator: Float64Array,
  touched: Int32Array,
  count: number,
  k: number,
  eligible?: (id: number) => boolean,
): Ranked[] {
  const size = Math.min(k, count);
  if (size <= 0) return [];

  const ids = new Int32Array(size);
  const scores = new Float64Array(size);
  let filled = 0;
  let worst = 0;

  for (let i = 0; i < count; i++) {
    const id = touched[i];
    if (eligible !== undefined && !eligible(id)) continue;
    const score = accumulator[id];
    if (filled < size) {
      ids[filled] = id;
      scores[filled] = score;
      filled++;
      if (filled === size) worst = worstSlot(ids, scores, size);
      continue;
    }
    if (score > scores[worst] || (score === scores[worst] && id < ids[worst])) {
      ids[worst] = id;
      scores[worst] = score;
      worst = worstSlot(ids, scores, size);
    }
  }

  const ranked: Ranked[] = [];
  for (let slot = 0; slot < filled; slot++) ranked.push({ id: ids[slot], score: scores[slot] });
  return ranked.sort((a, b) => b.score - a.score || a.id - b.id);
}

/**
 * Recorre un rango de vectores contiguos y devuelve los `k` mejores por producto
 * punto, sin materializar un puntaje por fragmento.
 *
 * Sustituye a `map(cosine) + filter + sort + slice` sobre los 181.000 fragmentos:
 * aquello creaba 181.000 objetos temporales y ordenaba la lista entera para
 * quedarse con 40. Aquí solo se mantienen `k` posiciones.
 *
 * Producto punto y no coseno porque los vectores se guardan normalizados (el
 * pipeline de embeddings usa `normalize: true` y el índice lo reasegura al
 * cargarlos): con `|a| = |b| = 1`, el coseno ES el producto punto, y se ahorran
 * dos acumuladores por componente.
 *
 * El acumulador `sum` es un `number` de JavaScript, es decir float64, aunque el
 * búfer sea float32: el único error introducido es el de representación de cada
 * componente (~6e-8 relativo), no el de la suma.
 *
 * `eligible` filtra DURANTE el recorrido, no después, para que el top-k sea el
 * de los fragmentos admitidos y no el de todos. Omitirlo deja el bucle sin la
 * llamada por iteración.
 */
export function topKByDot(
  vectors: Float32Array,
  dimensions: number,
  lo: number,
  hi: number,
  query: Float32Array,
  k: number,
  eligible?: (id: number) => boolean,
): Ranked[] {
  const size = Math.max(0, Math.min(k, hi - lo));
  if (size === 0 || query.length !== dimensions) return [];

  const ids = new Int32Array(size);
  // Float64 y no Float32: guardar la suma en float32 la redondearía y podría
  // alterar el desempate entre puntajes muy próximos.
  const scores = new Float64Array(size).fill(-Infinity);
  let minimum = -Infinity;
  let minimumAt = 0;

  // El bucle interno se desenrolla de ocho en ocho. Las sumas se acumulan en el
  // MISMO ORDEN que uno simple —un acumulador único, no ocho parciales—, así que
  // el resultado es idéntico bit a bit; lo que se ahorra es la comprobación de
  // la condición y el incremento, que a 69,6 millones de vueltas por consulta sí
  // se nota: medido sobre el corpus real, 69,2 → 60,5 ms.
  //
  // (Fijar la dimensión como literal 384 en vez de parámetro baja a 52,9 ms,
  // porque V8 puede razonar sobre el número de vueltas. No se hace: son 7 ms a
  // cambio de un segundo camino de código que habría que mantener y probar.)
  const tail = dimensions - (dimensions % 8);

  for (let id = lo; id < hi; id++) {
    if (eligible !== undefined && !eligible(id)) continue;
    let sum = 0;
    const base = id * dimensions;
    let i = 0;
    for (; i < tail; i += 8) {
      sum += vectors[base + i] * query[i];
      sum += vectors[base + i + 1] * query[i + 1];
      sum += vectors[base + i + 2] * query[i + 2];
      sum += vectors[base + i + 3] * query[i + 3];
      sum += vectors[base + i + 4] * query[i + 4];
      sum += vectors[base + i + 5] * query[i + 5];
      sum += vectors[base + i + 6] * query[i + 6];
      sum += vectors[base + i + 7] * query[i + 7];
    }
    for (; i < dimensions; i++) sum += vectors[base + i] * query[i];
    // Estrictamente mayor: ante un empate gana el id más bajo, que es quien ya
    // ocupa la posición porque el recorrido va en orden ascendente. Reproduce
    // el desempate `b.score - a.score || a.id - b.id` del ordenamiento total.
    if (sum > minimum) {
      ids[minimumAt] = id;
      scores[minimumAt] = sum;
      minimum = Infinity;
      for (let slot = 0; slot < size; slot++) {
        if (scores[slot] < minimum) { minimum = scores[slot]; minimumAt = slot; }
      }
    }
  }

  const ranked: Ranked[] = [];
  for (let slot = 0; slot < size; slot++) {
    if (Number.isFinite(scores[slot])) ranked.push({ id: ids[slot], score: scores[slot] });
  }
  return ranked.sort((a, b) => b.score - a.score || a.id - b.id);
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

/**
 * Conjunto de n-gramas de palabras de un texto, para comparar dos fragmentos
 * por solapamiento real de contenido y no por longitud.
 *
 * Se reutiliza `terms()` —sin tildes, sin palabras vacías— para que dos copias
 * del mismo texto con acentuación distinta cuenten como lo que son: la misma
 * cosa. Con `n = 3`, dos textos distintos que comparten vocabulario general no
 * se parecen; dos textos que comparten frases enteras, sí.
 */
export function shingles(text: string, n = 3): Set<string> {
  const words = terms(text);
  if (words.length < n) return new Set(words.length ? [words.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/** Intersección sobre unión. 0 = nada en común, 1 = idénticos. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  // Se recorre el más pequeño: el costo es el del menor de los dos conjuntos.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const item of small) if (large.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Gate de paridad del tokenizador (T059/T060): compara los IDs del contador TypeScript con
 * los del oráculo oficial en Python (fixtures/di/tokenizer-oracle.json). Sale con código 1
 * ante cualquier diferencia y NO hace llamadas de red ni de inferencia.
 */
import { readFileSync } from "node:fs";
import { encodeIds, TOKENIZER_PIN, tokenizerArtifactMatchesPin } from "../src/chat/outputTokenizer.js";

type Oracle = { encoding: string; tiktoken: string; n_vocab: number; casos: Array<{ texto: string; ids: number[] }> };
const oracle = JSON.parse(readFileSync(new URL("../test/fixtures/di/tokenizer-oracle.json", import.meta.url), "utf8")) as Oracle;

let failures = 0;
if (oracle.encoding !== TOKENIZER_PIN.encoding) { console.error(`Codificación del oráculo ${oracle.encoding} ≠ ${TOKENIZER_PIN.encoding}`); failures++; }
if (!tokenizerArtifactMatchesPin()) { console.error("La huella del archivo de rangos no coincide con la fijada."); failures++; }
for (const [i, c] of oracle.casos.entries()) {
  const got = encodeIds(c.texto);
  const same = got.length === c.ids.length && got.every((v, k) => v === c.ids[k]);
  if (!same) { failures++; console.error(`Caso ${i}: IDs distintos (${got.length} vs ${c.ids.length} tokens).`); }
}
console.log(`adapter=local tokenizer ${TOKENIZER_PIN.package} · oráculo tiktoken ${oracle.tiktoken} · ${oracle.casos.length} casos · ${failures ? `${failures} FALLOS` : "paridad exacta"}`);
process.exit(failures ? 1 : 0);

// fastembed-js Wrapper. Lazy-init, persistente Pipeline für Reuse.
// BGE-small-en-v1.5 ist EN-only — DE-Sections suboptimal embedded. BGE-M3
// (multilingual) ist nicht in fastembed-js verfügbar (TAR_BAD_ARCHIVE), siehe
// Memory reference_agentdb_architecture.md für Upgrade-Pfad.

let _pipelinePromise = null;

export async function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const { FlagEmbedding } = await import('fastembed');
      return FlagEmbedding.init();
    })();
  }
  return _pipelinePromise;
}

// Embed eine Liste von Texten. Returnt Array<Float32Array>.
export async function embed(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const pipeline = await getPipeline();
  const generator = await pipeline.embed(texts);
  const all = [];
  for await (const batch of generator) {
    for (const v of batch) all.push(v);
  }
  return all;
}

// Single-Text-Embed. Wraps embed([text])[0].
export async function embedOne(text) {
  const [vec] = await embed([text]);
  return vec;
}

// Format Embedding als JSON-Array-String für sqlite-vec.
// vec0 erwartet `[1.0, 2.0, ...]` als TEXT-Argument.
export function vecToJson(vec) {
  return JSON.stringify(Array.from(vec));
}

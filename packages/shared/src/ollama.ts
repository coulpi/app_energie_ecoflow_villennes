// Client Ollama minimal — utilise l'API HTTP /api/chat (streaming désactivé).

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  temperature?: number;
  format?: "json";
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (info: {
    chunks: number;
    contentLen: number;
    ttfbMs: number;
    totalMs: number;
  }) => void;
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.baseUrl.replace(/\/+$/, "") + "/api/chat";
  // Streaming activé : Ollama envoie un chunk par token au format JSON-Lines.
  // Cela maintient la connexion TCP active même quand le 1er token tarde
  // (chargement d'un gros modèle en VRAM par exemple), évitant les timeouts
  // proxy / keep-alive intermédiaires.
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      format: opts.format,
      keep_alive: "30m",
      // Désactive le mode "thinking" sur les modèles qui le supportent
      // (gemma4, qwq, deepseek-r1...) — sinon ils peuvent raisonner
      // pendant des minutes avant de produire le moindre token de réponse.
      think: false,
      options: {
        temperature: opts.temperature ?? 0.2,
      },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }

  let content = "";
  let firstChunkAt = 0;
  let chunks = 0;
  const start = Date.now();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstChunkAt) firstChunkAt = Date.now();
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as {
          message?: { content?: string; thinking?: string };
          done?: boolean;
          error?: string;
        };
        if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
        if (obj.message?.content) content += obj.message.content;
        chunks++;
      } catch (e) {
        if ((e as Error).message.startsWith("Ollama error:")) throw e;
      }
    }
  }
  // Diagnostic facultatif : si l'appelant fournit un onProgress hook on l'appelle
  if (opts.onProgress) {
    opts.onProgress({
      chunks,
      contentLen: content.length,
      ttfbMs: firstChunkAt ? firstChunkAt - start : 0,
      totalMs: Date.now() - start,
    });
  }
  return content;
}

export async function ollamaListModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(baseUrl.replace(/\/+$/, "") + "/api/tags");
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const json = (await res.json()) as { models?: Array<{ name: string }> };
  return (json.models ?? []).map((m) => m.name);
}

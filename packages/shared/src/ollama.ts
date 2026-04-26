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
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.baseUrl.replace(/\/+$/, "") + "/api/chat";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: false,
      format: opts.format,
      options: {
        temperature: opts.temperature ?? 0.2,
      },
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    message?: { content?: string };
    error?: string;
  };
  if (json.error) throw new Error(`Ollama error: ${json.error}`);
  return json.message?.content ?? "";
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

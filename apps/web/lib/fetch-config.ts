// Côté Next.js (Node) : on désactive les deadlines undici par défaut pour
// permettre aux proxies vers le worker (run agent) de durer >5 min sans
// que la connexion TCP soit fermée. La durée totale reste bornée par
// AbortSignal.timeout côté appelant.

import { setGlobalDispatcher, Agent } from "undici";

let configured = false;

export function ensureFetchConfigured(): void {
  if (configured) return;
  setGlobalDispatcher(
    new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
    }),
  );
  configured = true;
}

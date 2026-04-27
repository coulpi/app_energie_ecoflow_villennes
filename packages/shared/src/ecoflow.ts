// Client EcoFlow Developer API.
//
// Doc : https://developer-eu.ecoflow.com/us/document/generalInfo
// Auth : HMAC-SHA256 sur la chaîne canonique avec accessKey/secretKey.
// MQTT : récupération des credentials via /iot-open/sign/certification.
//
// Fournit :
//   - lecture des quotas / device list
//   - lecture du SoC + puissances instantanées via REST
//   - écriture des paramètres : puissance de charge AC, puissance de décharge,
//     SoC limites, mode AC/DC, etc.

import crypto from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";

export interface EcoFlowOptions {
  accessKey: string;
  secretKey: string;
  apiBase: string; // ex: https://api-e.ecoflow.com
  fetchImpl?: typeof fetch;
}

interface EcoFlowEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

export class EcoFlowClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: EcoFlowOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Construit la chaîne canonique : params triés alphabétiquement, format k=v&... */
  private canonicalize(params: Record<string, unknown>): string {
    const flat: Record<string, string> = {};
    const walk = (prefix: string, val: unknown): void => {
      if (val === null || val === undefined) return;
      if (Array.isArray(val)) {
        val.forEach((v, i) => walk(`${prefix}[${i}]`, v));
      } else if (typeof val === "object") {
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          walk(prefix ? `${prefix}.${k}` : k, v);
        }
      } else {
        flat[prefix] = String(val);
      }
    };
    walk("", params);
    return Object.keys(flat)
      .sort()
      .map((k) => `${k}=${flat[k]}`)
      .join("&");
  }

  private sign(canonical: string, nonce: string, ts: string): string {
    const accessKeyPart = `accessKey=${this.opts.accessKey}&nonce=${nonce}&timestamp=${ts}`;
    const toSign = canonical
      ? `${canonical}&${accessKeyPart}`
      : accessKeyPart;
    return crypto
      .createHmac("sha256", this.opts.secretKey)
      .update(toSign, "utf8")
      .digest("hex");
  }

  private async request<T>(
    method: "GET" | "PUT" | "POST",
    path: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const ts = Date.now().toString();
    const nonce = Math.floor(Math.random() * 1_000_000).toString();
    const canonical = this.canonicalize(payload);
    const sign = this.sign(canonical, nonce, ts);

    const headers: Record<string, string> = {
      accessKey: this.opts.accessKey,
      nonce,
      timestamp: ts,
      sign,
    };

    let url = this.opts.apiBase + path;
    let body: string | undefined;
    if (method === "GET") {
      if (canonical) url += `?${canonical}`;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    }

    const res = await this.fetchImpl(url, { method, headers, body });
    if (!res.ok) {
      throw new Error(`EcoFlow HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as EcoFlowEnvelope<T>;
    if (json.code !== "0" && json.code !== "200") {
      throw new Error(`EcoFlow error ${json.code}: ${json.message}`);
    }
    return json.data;
  }

  // --- Lecture ---

  async listDevices(): Promise<EcoFlowDevice[]> {
    return this.request<EcoFlowDevice[]>("GET", "/iot-open/sign/device/list");
  }

  /**
   * Récupère toutes les "quotas" (paramètres temps réel) d'un appareil.
   * `params` au format : { sn, params: { quotas: [...] } } ou liste vide pour tout.
   */
  async getQuotaAll(sn: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      "/iot-open/sign/device/quota/all",
      { sn },
    );
  }

  // --- Écriture (commandes) ---

  /**
   * Pousse une commande `set` à l'appareil. `cmdCode` et `params` dépendent
   * du modèle ; cette méthode reste générique pour permettre de gérer Delta 2,
   * Delta Pro, River, etc. via un mapping côté worker.
   */
  async setQuota(
    sn: string,
    cmdCode: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("PUT", "/iot-open/sign/device/quota", {
      sn,
      cmdCode,
      params,
    });
  }

  /**
   * Format moderne (Delta 2 Max et batteries récentes) :
   * { id, version, sn, moduleType, operateType, params }.
   * Ce format est documenté sur developer-eu.ecoflow.com et accepté par
   * les firmwares à jour, là où l'ancien `cmdCode` renvoie `1006`.
   */
  async setProperty(
    sn: string,
    moduleType: number,
    operateType: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("PUT", "/iot-open/sign/device/quota", {
      id: Math.floor(Math.random() * 1_000_000),
      version: "1.0",
      sn,
      moduleType,
      operateType,
      params,
    });
  }

  /**
   * Récupère les credentials MQTT à utiliser pour s'abonner aux topics
   * temps réel des appareils.
   */
  async getMqttCertification(): Promise<EcoFlowMqttCert> {
    return this.request<EcoFlowMqttCert>(
      "GET",
      "/iot-open/sign/certification",
    );
  }
}

export interface EcoFlowDevice {
  sn: string;
  online: number;
  productName?: string;
  deviceName?: string;
}

export interface EcoFlowMqttCert {
  certificateAccount: string;
  certificatePassword: string;
  url: string;
  port: string;
  protocol: string;
}

// --- Subscription MQTT ---

export interface EcoFlowMqttHandlerOpts {
  cert: EcoFlowMqttCert;
  serialNumbers: string[];
  onMessage: (sn: string, payload: unknown) => void;
  onError?: (err: Error) => void;
}

export function connectEcoFlowMqtt(
  opts: EcoFlowMqttHandlerOpts,
): MqttClient {
  const url = `${opts.cert.protocol}://${opts.cert.url}:${opts.cert.port}`;
  const client = mqtt.connect(url, {
    username: opts.cert.certificateAccount,
    password: opts.cert.certificatePassword,
    clientId: `app-villennes-${crypto.randomUUID()}`,
    protocolVersion: 5,
    reconnectPeriod: 5_000,
    rejectUnauthorized: true,
  });

  client.on("connect", () => {
    for (const sn of opts.serialNumbers) {
      const topic = `/open/${opts.cert.certificateAccount}/${sn}/quota`;
      client.subscribe(topic, { qos: 1 });
    }
  });

  client.on("message", (topic, msg) => {
    try {
      const sn = topic.split("/")[3] ?? "";
      const payload = JSON.parse(msg.toString("utf8"));
      opts.onMessage(sn, payload);
    } catch (e) {
      opts.onError?.(e as Error);
    }
  });

  client.on("error", (e) => opts.onError?.(e));
  return client;
}

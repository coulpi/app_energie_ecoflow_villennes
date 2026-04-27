// Client EcoFlow API privée (celle utilisée par l'app mobile).
//
// Contrairement au Developer Portal, cette API expose la totalité des
// "quotas" en temps réel pour tous les modèles (Delta Max, Delta 2,
// Delta Pro, etc.), y compris :
//   - inv.outputWatts / inv.inputWatts (puissance AC réelle, pas DC)
//   - pd.wattsOutputSum / pd.wattsInputSum
//   - bms_bmsStatus.f32ShowSoc (SoC en float, résolution 0,01 %)
//   - tous les paramètres modifiables (charge speed, max SoC, etc.)
//
// Endpoints non officiellement documentés — sujets à changement.

import mqtt, { type MqttClient } from "mqtt";
import crypto from "node:crypto";

export interface EcoFlowPrivateOptions {
  email: string;
  password: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface LoginResponse {
  data: {
    user: {
      userId: string;
      email: string;
      name?: string;
    };
    token: string;
  };
}

interface CertificationResponse {
  data: {
    certificateAccount: string;
    certificatePassword: string;
    url: string;
    port: string;
    protocol: string;
  };
}

export class EcoFlowPrivateClient {
  private token: string | null = null;
  private userId: string | null = null;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: EcoFlowPrivateOptions) {
    this.apiBase = opts.apiBase ?? "https://api-e.ecoflow.com";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async login(): Promise<{ userId: string; token: string }> {
    if (this.token && this.userId) {
      return { userId: this.userId, token: this.token };
    }
    const body = {
      scene: "IOT_APP",
      appVersion: "4.1.2",
      osType: 1,
      osVersion: "11",
      userType: "ECOFLOW",
      password: Buffer.from(this.opts.password, "utf8").toString("base64"),
      email: this.opts.email,
    };
    const res = await this.fetchImpl(`${this.apiBase}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        lang: "en_US",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `EcoFlow login HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as LoginResponse & { code?: string; message?: string };
    if (!json.data?.token || !json.data.user?.userId) {
      throw new Error(
        `EcoFlow login failed: ${json.message ?? JSON.stringify(json)}`,
      );
    }
    this.token = json.data.token;
    this.userId = String(json.data.user.userId);
    return { userId: this.userId, token: this.token };
  }

  async getMqttCertification(): Promise<{
    certificateAccount: string;
    certificatePassword: string;
    url: string;
    port: number;
    protocol: string;
    userId: string;
  }> {
    const { token, userId } = await this.login();
    const url = `${this.apiBase}/iot-auth/app/certification?userId=${encodeURIComponent(userId)}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        lang: "en_US",
      },
    });
    if (!res.ok) {
      throw new Error(
        `EcoFlow certification HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as CertificationResponse & {
      code?: string;
      message?: string;
    };
    if (!json.data?.certificateAccount) {
      throw new Error(
        `EcoFlow certification failed: ${json.message ?? JSON.stringify(json)}`,
      );
    }
    return {
      certificateAccount: json.data.certificateAccount,
      certificatePassword: json.data.certificatePassword,
      url: json.data.url,
      port: Number(json.data.port),
      protocol: json.data.protocol,
      userId,
    };
  }

  async getDeviceList(): Promise<
    Array<{ sn: string; productName?: string; deviceName?: string }>
  > {
    const { token } = await this.login();
    const res = await this.fetchImpl(
      `${this.apiBase}/iot-open/sign/device/list`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, lang: "en_US" },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown[] };
    return (json.data ?? []) as Array<{
      sn: string;
      productName?: string;
      deviceName?: string;
    }>;
  }
}

export interface EcoFlowPrivateMqttOpts {
  cert: {
    certificateAccount: string;
    certificatePassword: string;
    url: string;
    port: number;
    protocol: string;
    userId: string;
  };
  serialNumbers: string[];
  onMessage: (sn: string, payload: unknown) => void;
  onError?: (err: Error) => void;
  onConnect?: () => void;
}

export function connectEcoFlowPrivateMqtt(
  opts: EcoFlowPrivateMqttOpts,
): MqttClient {
  const { cert } = opts;
  const url = `mqtts://${cert.url}:${cert.port}`;
  const clientId = `ANDROID_${crypto.randomUUID()}_${cert.userId}`;
  const client = mqtt.connect(url, {
    username: cert.certificateAccount,
    password: cert.certificatePassword,
    clientId,
    protocolVersion: 5,
    reconnectPeriod: 5_000,
    rejectUnauthorized: true,
  });

  client.on("connect", () => {
    for (const sn of opts.serialNumbers) {
      // Topics principaux utilisés par l'app mobile EcoFlow / les
      // intégrations communautaires. Le 1er suffit pour Delta Max,
      // les autres sont là par sécurité pour d'autres modèles.
      client.subscribe(`/app/device/property/${sn}`, { qos: 1 });
      client.subscribe(`/app/${cert.userId}/${sn}/thing/property/post`, {
        qos: 1,
      });
    }
    opts.onConnect?.();
  });

  client.on("message", (topic, msg) => {
    try {
      // Le SN se trouve à la fin du topic (après le dernier /).
      const parts = topic.split("/");
      // /app/device/property/{sn} → sn à l'indice 4
      // /app/{userId}/{sn}/thing/property/post → sn à l'indice 3
      const sn = parts[4] && parts[2] === "device" ? parts[4] : parts[3] ?? "";
      const payload = JSON.parse(msg.toString("utf8"));
      opts.onMessage(sn, payload);
    } catch (e) {
      opts.onError?.(e as Error);
    }
  });

  client.on("error", (e) => opts.onError?.(e));
  return client;
}

/**
 * Publie une commande "set" sur le canal MQTT privé EcoFlow. Le format est
 * celui utilisé par l'app mobile : topic /app/{userId}/{sn}/thing/property/set
 * avec un JSON contenant id (random), version, moduleType, operateType, params.
 *
 * Le mapping (moduleType, operateType, params) dépend du modèle ; cf.
 * intégrations communautaires (home-assistant-ecoflow, ecoflow_iot_open).
 * Pour Delta Max charge AC, les pistes connues sont :
 *   - moduleType 5, operateType "acChgCfg", params { chgWatts, chgPauseFlag }
 *   - moduleType 1, operateType "TCP",       params { id: 69, slowChgPower }
 */
export function publishEcoFlowPrivateCommand(
  client: MqttClient,
  userId: string,
  sn: string,
  body: {
    moduleType: number;
    operateType: string;
    params: Record<string, unknown>;
  },
): Promise<void> {
  const topic = `/app/${userId}/${sn}/thing/property/set`;
  const payload = JSON.stringify({
    from: "iOS",
    id: crypto.randomUUID(),
    version: "1.0",
    moduleType: body.moduleType,
    operateType: body.operateType,
    params: body.params,
  });
  return new Promise<void>((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

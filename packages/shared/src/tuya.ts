// Client Tuya Cloud (Open API).
//
// Réf. signature : https://developer.tuya.com/en/docs/iot/new-singnature
// Le secret de la requête signée combine :
//   sign = HMAC-SHA256( client_id + access_token? + t + nonce + stringToSign , client_secret )
// stringToSign = METHOD\nSHA256(body)\nheaderStr\nurlPath
//
// Cette implémentation est volontairement minimale : token applicatif,
// renouvellement auto, lecture statut device, commande on/off d'une prise.

import crypto from "node:crypto";

export interface TuyaClientOptions {
  clientId: string;
  clientSecret: string;
  apiBase: string; // ex: https://openapi.tuyaeu.com
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

interface TuyaResponse<T> {
  success: boolean;
  result: T;
  msg?: string;
  code?: number;
  t: number;
}

export class TuyaClient {
  private token?: TokenCache;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: TuyaClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private sha256(input: string): string {
    return crypto.createHash("sha256").update(input, "utf8").digest("hex");
  }

  private hmac(secret: string, input: string): string {
    return crypto
      .createHmac("sha256", secret)
      .update(input, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  private buildStringToSign(
    method: string,
    body: string,
    urlPath: string,
  ): string {
    const bodyHash = this.sha256(body);
    return `${method.toUpperCase()}\n${bodyHash}\n\n${urlPath}`;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) {
      return this.token.accessToken;
    }
    const path = "/v1.0/token?grant_type=1";
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const stringToSign = this.buildStringToSign("GET", "", path);
    const signStr = this.opts.clientId + t + nonce + stringToSign;
    const sign = this.hmac(this.opts.clientSecret, signStr);

    const res = await this.fetchImpl(this.opts.apiBase + path, {
      method: "GET",
      headers: {
        client_id: this.opts.clientId,
        sign,
        sign_method: "HMAC-SHA256",
        t,
        nonce,
      },
    });
    if (!res.ok) {
      throw new Error(`Tuya token HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as TuyaResponse<{
      access_token: string;
      expire_time: number;
    }>;
    if (!json.success) {
      throw new Error(`Tuya token error: ${json.msg ?? "unknown"}`);
    }
    this.token = {
      accessToken: json.result.access_token,
      expiresAt: Date.now() + json.result.expire_time * 1000,
    };
    return this.token.accessToken;
  }

  private async signedRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const accessToken = await this.ensureToken();
    const t = Date.now().toString();
    const nonce = crypto.randomUUID();
    const bodyStr = body ? JSON.stringify(body) : "";
    const stringToSign = this.buildStringToSign(method, bodyStr, path);
    const signStr =
      this.opts.clientId + accessToken + t + nonce + stringToSign;
    const sign = this.hmac(this.opts.clientSecret, signStr);

    const res = await this.fetchImpl(this.opts.apiBase + path, {
      method,
      headers: {
        client_id: this.opts.clientId,
        access_token: accessToken,
        sign,
        sign_method: "HMAC-SHA256",
        t,
        nonce,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: bodyStr || undefined,
    });
    if (!res.ok) {
      throw new Error(`Tuya HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as TuyaResponse<T>;
    if (!json.success) {
      throw new Error(`Tuya error ${json.code}: ${json.msg ?? "unknown"}`);
    }
    return json.result;
  }

  // --- API publique ---

  async getDeviceStatus(deviceId: string): Promise<TuyaStatus[]> {
    return this.signedRequest<TuyaStatus[]>(
      "GET",
      `/v1.0/iot-03/devices/${deviceId}/status`,
    );
  }

  async sendCommands(
    deviceId: string,
    commands: TuyaCommand[],
  ): Promise<boolean> {
    return this.signedRequest<boolean>(
      "POST",
      `/v1.0/iot-03/devices/${deviceId}/commands`,
      { commands },
    );
  }

  /** Bascule la prise. Le `code` peut varier selon le modèle (`switch_1`, `switch`). */
  async switchOnOff(
    deviceId: string,
    on: boolean,
    code = "switch_1",
  ): Promise<boolean> {
    return this.sendCommands(deviceId, [{ code, value: on }]);
  }

  /**
   * Lit la puissance instantanée d'un compteur Tuya.
   * Les codes les plus fréquents : `cur_power` (W*10), `phase_a` (struct).
   * Retourne null si non trouvé.
   */
  static extractPowerW(status: TuyaStatus[]): number | null {
    const m = new Map(status.map((s) => [s.code, s.value] as const));
    if (m.has("cur_power") && typeof m.get("cur_power") === "number") {
      return (m.get("cur_power") as number) / 10;
    }
    if (m.has("power_total") && typeof m.get("power_total") === "number") {
      return m.get("power_total") as number;
    }
    if (m.has("active_power") && typeof m.get("active_power") === "number") {
      return m.get("active_power") as number;
    }
    return null;
  }

  static extractEnergyWh(status: TuyaStatus[]): number | null {
    const m = new Map(status.map((s) => [s.code, s.value] as const));
    if (
      m.has("add_ele") &&
      typeof m.get("add_ele") === "number"
    ) {
      // Tuya add_ele en kWh*1000 → Wh
      return m.get("add_ele") as number;
    }
    return null;
  }

  static extractSwitchOn(
    status: TuyaStatus[],
    code = "switch_1",
  ): boolean | null {
    const v = status.find((s) => s.code === code)?.value;
    return typeof v === "boolean" ? v : null;
  }
}

export interface TuyaStatus {
  code: string;
  value: unknown;
}

export interface TuyaCommand {
  code: string;
  value: unknown;
}

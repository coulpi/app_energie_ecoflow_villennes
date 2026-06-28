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

  /**
   * Détail du device (dont `online`). Le endpoint `/status` renvoie le
   * dernier état **en cache** même quand le boîtier est déconnecté du cloud
   * Tuya ; seul `online` (issu de `/devices/{id}`) dit si les commandes
   * peuvent réellement être délivrées.
   */
  async getDeviceInfo(
    deviceId: string,
  ): Promise<{ online: boolean; name?: string; [k: string]: unknown }> {
    return this.signedRequest<{ online: boolean; name?: string }>(
      "GET",
      `/v1.0/iot-03/devices/${deviceId}`,
    );
  }

  /** Raccourci : true/false selon la connexion cloud du device. */
  async isOnline(deviceId: string): Promise<boolean> {
    const info = await this.getDeviceInfo(deviceId);
    return info.online === true;
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
   *
   * Compatible :
   *  - prises connectées (`cur_power` en W*10)
   *  - PJ2101A bidirectionnel : champ `phase_a` (string base64 ou struct
   *    {voltage, electriccurrent, power}), champ `power_a`, ou différence
   *    forward/reverse.
   *
   * `signed = true` retourne la puissance signée (PJ2101A : +import, -export).
   * `signed = false` (défaut) retourne la valeur absolue.
   */
  static extractPowerW(
    status: TuyaStatus[],
    signed = false,
  ): number | null {
    const m = new Map(status.map((s) => [s.code, s.value] as const));

    // PJ2101A : phase_a peut être string base64 encodée → décodage spécifique.
    if (m.has("phase_a")) {
      const v = m.get("phase_a");
      const decoded = decodePhaseA(v);
      if (decoded?.powerW !== null && decoded?.powerW !== undefined) {
        return signed ? decoded.powerW : Math.abs(decoded.powerW);
      }
    }

    // Champ power_a explicite (certains firmwares)
    for (const k of ["power_a", "active_power", "power"]) {
      const v = m.get(k);
      if (typeof v === "number") {
        return signed ? v : Math.abs(v);
      }
    }

    // Prises classiques : cur_power en W*10
    if (typeof m.get("cur_power") === "number") {
      return (m.get("cur_power") as number) / 10;
    }

    if (typeof m.get("power_total") === "number") {
      return m.get("power_total") as number;
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

/**
 * Le PJ2101A encode `phase_a` en base64 d'un buffer binaire :
 *   bytes 0-1 : voltage (×10, big-endian)
 *   bytes 2-4 : current mA (24-bit, big-endian) — LSB du courant = direction :
 *               0 = import (consommation), 1 = export (surproduction).
 *               Le courant réel = (raw & 0xFFFFFE) en mA.
 *   bytes 5-7 : power W (24-bit, big-endian, NON signé — direction donnée
 *               par le LSB du courant).
 *
 * Si la valeur arrive déjà comme objet {voltage, electriccurrent, power}, on
 * applique la même règle sur electriccurrent.
 */
function decodePhaseA(value: unknown): {
  voltageV: number | null;
  currentA: number | null;
  powerW: number | null;
} | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const cRaw = typeof o.electriccurrent === "number" ? o.electriccurrent : null;
    const direction = cRaw !== null ? (cRaw & 1) : 0;
    const currentMa = cRaw !== null ? cRaw & ~1 : null;
    const powerAbs = typeof o.power === "number" ? o.power : null;
    return {
      voltageV: typeof o.voltage === "number" ? o.voltage / 10 : null,
      currentA: currentMa !== null ? currentMa / 1000 : null,
      powerW:
        powerAbs !== null
          ? direction === 1
            ? -powerAbs
            : powerAbs
          : null,
    };
  }
  if (typeof value !== "string") return null;
  try {
    const buf = Buffer.from(value, "base64");
    if (buf.length < 8) return null;
    const voltage = buf.readUInt16BE(0) / 10;
    const currentRaw = (buf[2]! << 16) | (buf[3]! << 8) | buf[4]!;
    const direction = currentRaw & 1;
    const currentMa = currentRaw & ~1;
    const powerAbs = (buf[5]! << 16) | (buf[6]! << 8) | buf[7]!;
    const power = direction === 1 ? -powerAbs : powerAbs;
    return {
      voltageV: voltage,
      currentA: currentMa / 1000,
      powerW: power,
    };
  } catch {
    return null;
  }
}

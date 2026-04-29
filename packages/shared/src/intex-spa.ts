// Client TCP local pour module Wi-Fi Intex PureSpa.
//
// Port direct en TypeScript de https://github.com/mathieu-mp/intex-spa
// (Apache-2.0). Protocole : connexion TCP sur port 8990, requete JSON
// avec data hex + checksum, reponse JSON avec status encode dans un int.
//
// Compatibilite : modeles SB-HWF20, SB-HSWF20, SC-WF20, SC-WF20-1
// (panneau de commande NE contenant PAS "TY" dans le code grave).

import net from "node:net";

const TYPE_COMMAND = 1;
const TYPE_STATUS = 2;
const TYPE_INFO = 3;

const COMMAND_REQUESTS: Record<string, { request: string; type: number }> = {
  status: { request: "8888060FEE0F01", type: TYPE_COMMAND },
  power: { request: "8888060F014000", type: TYPE_COMMAND },
  filter: { request: "8888060F010004", type: TYPE_COMMAND },
  heater: { request: "8888060F010010", type: TYPE_COMMAND },
  jets: { request: "8888060F011000", type: TYPE_COMMAND },
  bubbles: { request: "8888060F010400", type: TYPE_COMMAND },
  sanitizer: { request: "8888060F010001", type: TYPE_COMMAND },
  preset_temp: { request: "8888050F0C", type: TYPE_COMMAND },
  info: { request: "", type: TYPE_INFO },
};

export type IntexIntent =
  | "status"
  | "power"
  | "filter"
  | "heater"
  | "jets"
  | "bubbles"
  | "sanitizer"
  | "preset_temp"
  | "info";

export interface IntexSpaStatus {
  power: boolean;
  filter: boolean;
  heater: boolean;
  jets: boolean;
  bubbles: boolean;
  sanitizer: boolean;
  // Temperature courante en degres (unite C ou F selon presetTemp <= 40).
  // null si l'octet encode un code erreur (>= 181 -> "E<n>").
  currentTemp: number | null;
  errorCode: string | null;
  presetTemp: number;
  unit: "C" | "F";
  raw: bigint;
}

export interface IntexSpaInfo {
  ip: string;
  uid: string;
  dtype: string;
}

function checksumHex(data: string): string {
  let acc = 0xff;
  for (let i = 0; i < data.length; i += 2) {
    acc -= parseInt(data.slice(i, i + 2), 16);
  }
  acc = ((acc % 0xff) + 0xff) % 0xff;
  if (acc === 0) acc = 0xff;
  return acc.toString(16).toUpperCase().padStart(2, "0");
}

function buildRequestBytes(intent: IntexIntent, presetTemp?: number): { sid: string; bytes: Buffer; type: number } {
  const cfg = COMMAND_REQUESTS[intent];
  if (!cfg) throw new Error(`Unknown intex intent: ${intent}`);

  let request = cfg.request;
  if (intent === "preset_temp") {
    if (presetTemp == null) throw new Error("preset_temp requires presetTemp argument");
    request += presetTemp.toString(16).toUpperCase().padStart(2, "0");
  }

  const sid = String(Math.floor(Date.now() * 10));

  let payload: Record<string, string | number>;
  if (cfg.type === TYPE_INFO) {
    payload = { data: "", sid, type: cfg.type };
  } else {
    payload = { data: request + checksumHex(request), sid, type: cfg.type };
  }

  return { sid, bytes: Buffer.from(JSON.stringify(payload), "utf8"), type: cfg.type };
}

function parseStatusInt(raw: bigint): IntexSpaStatus {
  const bit = (n: number): boolean => Number((raw >> BigInt(n)) & 1n) === 1;
  const byte = (n: number): number => Number((raw >> BigInt(n)) & 0xffn);

  const tempByte = byte(88);
  const presetTemp = byte(24);
  const unit: "C" | "F" = presetTemp <= 40 ? "C" : "F";

  let currentTemp: number | null = tempByte;
  let errorCode: string | null = null;
  if (tempByte >= 181) {
    currentTemp = null;
    errorCode = `E${tempByte - 100}`;
  }

  return {
    power: bit(104),
    filter: bit(105),
    heater: bit(106),
    jets: bit(107),
    bubbles: bit(108),
    sanitizer: bit(109),
    currentTemp,
    errorCode,
    presetTemp,
    unit,
    raw,
  };
}

interface ParsedResponse {
  type: "command" | "info";
  status?: IntexSpaStatus;
  info?: IntexSpaInfo;
}

function parseResponse(line: Buffer, expectedSid: string, expectedType: number): ParsedResponse {
  const obj = JSON.parse(line.toString("utf8")) as {
    sid: string;
    result: string;
    type: number;
    data: string;
  };
  if (obj.sid !== expectedSid) throw new Error(`Intex sid mismatch: ${obj.sid} != ${expectedSid}`);
  if (obj.result !== "ok") throw new Error(`Intex result not ok: ${obj.result}`);

  if (expectedType === TYPE_COMMAND) {
    if (obj.type !== TYPE_STATUS) throw new Error(`Intex unexpected response type: ${obj.type}`);
    const data = obj.data;
    const calc = checksumHex(data.slice(0, -2));
    const found = data.slice(-2).toUpperCase();
    if (calc !== found) throw new Error(`Intex checksum mismatch: ${calc} vs ${found}`);
    const raw = BigInt("0x" + data);
    return { type: "command", status: parseStatusInt(raw) };
  }

  if (expectedType === TYPE_INFO) {
    if (obj.type !== TYPE_INFO) throw new Error(`Intex unexpected info response type: ${obj.type}`);
    const inner = JSON.parse(obj.data) as { ip: string; uid: string; dtype: string };
    if (inner.dtype !== "spa") throw new Error(`Intex dtype not spa: ${inner.dtype}`);
    return { type: "info", info: { ip: inner.ip, uid: inner.uid, dtype: inner.dtype } };
  }

  throw new Error(`Unexpected expectedType: ${expectedType}`);
}

export interface IntexSpaClientOptions {
  host: string;
  port?: number;
  // Timeout par requete TCP (ms). Defaut 5 s.
  timeoutMs?: number;
}

// Une instance = une socket reutilisee, requetes serialisees.
export class IntexSpaClient {
  private host: string;
  private port: number;
  private timeoutMs: number;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private busy: Promise<unknown> = Promise.resolve();

  constructor(opts: IntexSpaClientOptions) {
    this.host = opts.host;
    this.port = opts.port ?? 8990;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  private async connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket;
    const s = new net.Socket();
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => {
        s.destroy();
        reject(e);
      };
      s.once("error", onErr);
      s.connect(this.port, this.host, () => {
        s.off("error", onErr);
        resolve();
      });
    });
    s.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    });
    s.on("close", () => {
      if (this.socket === s) this.socket = null;
      this.buffer = Buffer.alloc(0);
    });
    this.socket = s;
    return s;
  }

  private disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
  }

  private async readLine(): Promise<Buffer> {
    const start = Date.now();
    while (Date.now() - start < this.timeoutMs) {
      const idx = this.buffer.indexOf(0x0a);
      if (idx >= 0) {
        const line = this.buffer.subarray(0, idx);
        this.buffer = this.buffer.subarray(idx + 1);
        return line;
      }
      // Le module ne termine pas toujours par \n : on accepte aussi un JSON
      // complet sans saut de ligne quand la socket idle un instant.
      if (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] === 0x7d) {
        const candidate = this.buffer;
        try {
          JSON.parse(candidate.toString("utf8"));
          this.buffer = Buffer.alloc(0);
          return candidate;
        } catch {
          // pas encore complet
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Intex spa response timeout");
  }

  private async sendOnce(intent: IntexIntent, presetTemp?: number): Promise<ParsedResponse> {
    const { sid, bytes, type } = buildRequestBytes(intent, presetTemp);
    const s = await this.connect();
    this.buffer = Buffer.alloc(0);
    await new Promise<void>((resolve, reject) => {
      s.write(bytes, (err) => (err ? reject(err) : resolve()));
    });
    const line = await this.readLine();
    return parseResponse(line, sid, type);
  }

  // Serialise les requetes (le module n'aime pas les requetes paralleles).
  private async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.busy;
    let release: (v: unknown) => void = () => {};
    this.busy = new Promise((r) => (release = r));
    try {
      await prev.catch(() => {});
      return await fn();
    } finally {
      release(undefined);
    }
  }

  async getStatus(): Promise<IntexSpaStatus> {
    return this.serialize(async () => {
      try {
        const r = await this.sendOnce("status");
        if (!r.status) throw new Error("status response missing");
        return r.status;
      } catch (e) {
        this.disconnect();
        throw e;
      }
    });
  }

  async getInfo(): Promise<IntexSpaInfo> {
    return this.serialize(async () => {
      try {
        const r = await this.sendOnce("info");
        if (!r.info) throw new Error("info response missing");
        return r.info;
      } catch (e) {
        this.disconnect();
        throw e;
      }
    });
  }

  // Les commandes Intex sont des bascules : le module inverse l'etat. Pour
  // arriver a un etat cible on lit le status, on n'envoie le toggle que si
  // l'etat courant differe de la consigne.
  async setToggle(intent: Exclude<IntexIntent, "status" | "info" | "preset_temp">, expected: boolean): Promise<IntexSpaStatus> {
    return this.serialize(async () => {
      try {
        const cur = await this.sendOnce("status");
        if (!cur.status) throw new Error("status response missing");
        if (cur.status[intent] === expected) return cur.status;
        const next = await this.sendOnce(intent);
        if (!next.status) throw new Error("toggle response missing");
        return next.status;
      } catch (e) {
        this.disconnect();
        throw e;
      }
    });
  }

  async setHeater(on: boolean) { return this.setToggle("heater", on); }
  async setFilter(on: boolean) { return this.setToggle("filter", on); }
  async setBubbles(on: boolean) { return this.setToggle("bubbles", on); }
  async setJets(on: boolean) { return this.setToggle("jets", on); }
  async setSanitizer(on: boolean) { return this.setToggle("sanitizer", on); }
  async setPower(on: boolean) { return this.setToggle("power", on); }

  async setPresetTemp(temp: number): Promise<IntexSpaStatus> {
    return this.serialize(async () => {
      try {
        const cur = await this.sendOnce("status");
        if (!cur.status) throw new Error("status response missing");
        if (cur.status.presetTemp === temp) return cur.status;
        const next = await this.sendOnce("preset_temp", temp);
        if (!next.status) throw new Error("preset_temp response missing");
        return next.status;
      } catch (e) {
        this.disconnect();
        throw e;
      }
    });
  }

  close(): void {
    this.disconnect();
  }
}

export function createIntexSpaClient(opts: IntexSpaClientOptions): IntexSpaClient {
  return new IntexSpaClient(opts);
}

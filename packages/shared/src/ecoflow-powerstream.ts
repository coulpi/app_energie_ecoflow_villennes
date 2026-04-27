// Pilotage du PowerStream EcoFlow via MQTT privé.
//
// Contrairement à la Delta Max (qui accepte du JSON simple), le PowerStream
// utilise des Protocol Buffers. Schéma issu du projet community
// tolwi/hassio-ecoflow-cloud (powerstream.proto), porté ici en JSON pour
// charger dynamiquement avec protobufjs.
//
// Topic publish : /app/{userId}/{sn}/thing/property/set
// Payload (binaire) : PowerStreamSendHeaderMsg { msg: [PowerStreamHeader] }
//   où PowerStreamHeader contient cmd_func, cmd_id, pdata (bytes du
//   sous-message protobuf encodé), src=32 (APP), dest=53 (MQTT).

import protobuf from "protobufjs/light";
import type { MqttClient } from "mqtt";
import crypto from "node:crypto";

const ROOT_DESC = {
  nested: {
    PowerStreamHeader: {
      fields: {
        pdata: { type: "bytes", id: 1 },
        src: { type: "int32", id: 2 },
        dest: { type: "int32", id: 3 },
        d_src: { type: "int32", id: 4 },
        d_dest: { type: "int32", id: 5 },
        enc_type: { type: "int32", id: 6 },
        check_type: { type: "int32", id: 7 },
        cmd_func: { type: "int32", id: 8 },
        cmd_id: { type: "int32", id: 9 },
        data_len: { type: "int32", id: 10 },
        need_ack: { type: "int32", id: 11 },
        is_ack: { type: "int32", id: 12 },
        seq: { type: "int32", id: 14 },
        product_id: { type: "int32", id: 15 },
        version: { type: "int32", id: 16 },
        payload_ver: { type: "int32", id: 17 },
        time_snap: { type: "int32", id: 18 },
        is_rw_cmd: { type: "int32", id: 19 },
        is_queue: { type: "int32", id: 20 },
        ack_type: { type: "int32", id: 21 },
        code: { type: "string", id: 22 },
        from_: { type: "string", id: 23 },
        module_sn: { type: "string", id: 24 },
        device_sn: { type: "string", id: 25 },
      },
    },
    PowerStreamSendHeaderMsg: {
      fields: {
        msg: { rule: "repeated", type: "PowerStreamHeader", id: 1 },
      },
    },
    PowerStreamPermanentWattsPack: {
      fields: { permanent_watts: { type: "uint32", id: 1 } },
    },
    PowerStreamSupplyPriorityPack: {
      fields: { supply_priority: { type: "uint32", id: 1 } },
    },
    PowerStreamBatLowerPack: {
      fields: { lower_limit: { type: "int32", id: 1 } },
    },
    PowerStreamBatUpperPack: {
      fields: { upper_limit: { type: "int32", id: 1 } },
    },
    PowerStreamSetValue: {
      fields: { value: { type: "int32", id: 1 } },
    },
  },
} as const;

const root = protobuf.Root.fromJSON(ROOT_DESC as unknown as protobuf.INamespace);

const Header = root.lookupType("PowerStreamHeader");
const SendHeader = root.lookupType("PowerStreamSendHeaderMsg");
const PermanentWatts = root.lookupType("PowerStreamPermanentWattsPack");
const SupplyPriority = root.lookupType("PowerStreamSupplyPriorityPack");
const BatLower = root.lookupType("PowerStreamBatLowerPack");
const BatUpper = root.lookupType("PowerStreamBatUpperPack");
const SetValue = root.lookupType("PowerStreamSetValue");

// cmd_func/cmd_id (issus de tolwi/hassio-ecoflow-cloud).
const CMD = {
  PERMANENT_WATTS_PACK: { func: 20, id: 129 },
  SET_SUPPLY_PRIORITY: { func: 20, id: 130 },
  SET_BAT_LOWER: { func: 20, id: 132 },
  SET_BAT_UPPER: { func: 20, id: 133 },
  SET_FEED_PROTECT: { func: 20, id: 143 },
} as const;

const SRC_APP = 32;
const DEST_MQTT = 53;

function buildEnvelope(
  deviceSn: string,
  cmd: { func: number; id: number },
  pdata: Uint8Array,
): Uint8Array {
  const seq = Math.floor(Math.random() * 1_000_000);
  const headerMsg = Header.create({
    pdata: Buffer.from(pdata),
    src: SRC_APP,
    dest: DEST_MQTT,
    cmd_func: cmd.func,
    cmd_id: cmd.id,
    data_len: pdata.length,
    seq,
    need_ack: 1,
    version: 19,
    payload_ver: 1,
    device_sn: deviceSn,
    from_: "ios",
  });
  const env = SendHeader.create({ msg: [headerMsg] });
  return SendHeader.encode(env).finish();
}

export interface PowerStreamCommand {
  /** Mode "manuel" : injection puissance fixe. 0 = mode AUTO suivi-de-charge. */
  setPermanentWatts(watts: number): Uint8Array;
  /** 1 = priorité alimentation directe (PV→maison), 0 = priorité batterie (PV→batt). */
  setSupplyPriority(priority: 0 | 1): Uint8Array;
  /** Limite haute SoC (%) au-dessus de laquelle on ne charge plus. */
  setBatUpper(percent: number): Uint8Array;
  /** Limite basse SoC (%) en dessous de laquelle on ne décharge plus. */
  setBatLower(percent: number): Uint8Array;
  /** Sécurité injection 0/1. */
  setFeedProtect(enabled: boolean): Uint8Array;
}

export function createPowerStreamCommands(deviceSn: string): PowerStreamCommand {
  return {
    setPermanentWatts(watts) {
      const pdata = PermanentWatts.encode(
        PermanentWatts.create({ permanent_watts: Math.max(0, Math.round(watts)) }),
      ).finish();
      return buildEnvelope(deviceSn, CMD.PERMANENT_WATTS_PACK, pdata);
    },
    setSupplyPriority(priority) {
      const pdata = SupplyPriority.encode(
        SupplyPriority.create({ supply_priority: priority }),
      ).finish();
      return buildEnvelope(deviceSn, CMD.SET_SUPPLY_PRIORITY, pdata);
    },
    setBatUpper(percent) {
      const pdata = BatUpper.encode(
        BatUpper.create({ upper_limit: Math.max(50, Math.min(100, Math.round(percent))) }),
      ).finish();
      return buildEnvelope(deviceSn, CMD.SET_BAT_UPPER, pdata);
    },
    setBatLower(percent) {
      const pdata = BatLower.encode(
        BatLower.create({ lower_limit: Math.max(0, Math.min(50, Math.round(percent))) }),
      ).finish();
      return buildEnvelope(deviceSn, CMD.SET_BAT_LOWER, pdata);
    },
    setFeedProtect(enabled) {
      const pdata = SetValue.encode(
        SetValue.create({ value: enabled ? 1 : 0 }),
      ).finish();
      return buildEnvelope(deviceSn, CMD.SET_FEED_PROTECT, pdata);
    },
  };
}

/** Publie un payload binaire sur le topic set du PowerStream. */
export function publishPowerStreamPayload(
  client: MqttClient,
  userId: string,
  sn: string,
  payload: Uint8Array,
): Promise<void> {
  const topic = `/app/${userId}/${sn}/thing/property/set`;
  return new Promise<void>((resolve, reject) => {
    client.publish(topic, Buffer.from(payload), { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Marqueur pour éviter le tree-shaking de crypto si jamais on en avait besoin
// (pas utilisé ici, gardé pour parité avec ecoflow-private.ts).
void crypto;

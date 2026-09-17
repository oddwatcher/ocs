// Opencode-style identifiers: prefix + "_" + 12 hex chars of (ms*16 + counter)
// + 14 base62 random chars. Lexicographic order matches creation order.
import { randomInt } from "node:crypto";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

let lastMs = 0;
let counter = 0;

function timeComponent(now: number): string {
  if (now === lastMs) {
    counter = (counter + 1) & 0xf;
  } else {
    lastMs = now;
    counter = 0;
  }
  return ((now * 16 + counter).toString(16).slice(-12)).padStart(12, "0");
}

function randomBase62(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += BASE62[randomInt(62)];
  return out;
}

export type IdPrefix = "ses" | "msg" | "prt" | "evt" | "wrk";

export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return `${prefix}_${timeComponent(now)}${randomBase62(14)}`;
}

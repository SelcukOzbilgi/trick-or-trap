/**
 * IP address parsing and range classification for the URL safety check.
 *
 * Pure functions, no I/O. Any text that is not a valid address is treated as
 * blocked, so the check fails closed.
 */

export type ParsedIp = { version: 4 | 6; bytes: number[] };

const IPV4_PART = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseIpv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!IPV4_PART.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/** Turns a list of groups into 16-bit numbers; a dotted IPv4 tail counts as two groups. */
function parseGroups(text: string, allowDottedTail: boolean): number[] | null {
  if (text === "") return [];
  const parts = text.split(":");
  const groups: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (allowDottedTail && i === parts.length - 1 && part.includes(".")) {
      const v4 = parseIpv4Bytes(part);
      if (!v4) return null;
      groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      continue;
    }
    if (!IPV6_GROUP.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function parseIpv6Bytes(text: string): number[] | null {
  if (text.includes("%")) return null;
  const gap = text.indexOf("::");
  let groups: number[];
  if (gap === -1) {
    const all = parseGroups(text, true);
    if (!all || all.length !== 8) return null;
    groups = all;
  } else {
    const head = text.slice(0, gap);
    const tail = text.slice(gap + 2);
    if (tail.includes("::")) return null;
    const headGroups = parseGroups(head, false);
    const tailGroups = parseGroups(tail, true);
    if (!headGroups || !tailGroups) return null;
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...new Array<number>(missing).fill(0), ...tailGroups];
  }
  const bytes: number[] = [];
  for (const group of groups) bytes.push(group >> 8, group & 0xff);
  return bytes;
}

/** Parses a dotted IPv4 or an IPv6 address. Returns `null` for anything else. */
export function parseIp(text: string): ParsedIp | null {
  if (text.includes(":")) {
    const bytes = parseIpv6Bytes(text);
    return bytes ? { version: 6, bytes } : null;
  }
  const bytes = parseIpv4Bytes(text);
  return bytes ? { version: 4, bytes } : null;
}

type Range = readonly [base: string, prefix: number];

const BLOCKED_IPV4: readonly Range[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["168.63.129.16", 32],
];

/** Blocked inside 2000::/3. Everything outside 2000::/3 is blocked separately. */
const BLOCKED_IPV6_IN_GLOBAL: readonly Range[] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];

function inRange(bytes: readonly number[], base: readonly number[], prefix: number): boolean {
  let remaining = prefix;
  for (let i = 0; remaining > 0; i += 1) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((bytes[i] & mask) !== (base[i] & mask)) return false;
    remaining -= bits;
  }
  return true;
}

function toBase(text: string): number[] {
  const parsed = parseIp(text);
  if (!parsed) throw new Error("invalid range table entry");
  return parsed.bytes;
}

const IPV4_RANGES = BLOCKED_IPV4.map(([base, prefix]) => ({ base: toBase(base), prefix }));
const IPV6_RANGES = BLOCKED_IPV6_IN_GLOBAL.map(([base, prefix]) => ({ base: toBase(base), prefix }));

function isBlockedIpv4(bytes: readonly number[]): boolean {
  return IPV4_RANGES.some((range) => inRange(bytes, range.base, range.prefix));
}

function isIpv4Mapped(bytes: readonly number[]): boolean {
  for (let i = 0; i < 10; i += 1) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

function isBlockedIpv6(bytes: readonly number[]): boolean {
  if (isIpv4Mapped(bytes)) return isBlockedIpv4(bytes.slice(12));
  // Only 2000::/3 (global unicast) may be reached.
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  return IPV6_RANGES.some((range) => inRange(bytes, range.base, range.prefix));
}

/** Says whether an address must not be reached. Unparsable text is blocked. */
export function classifyAddress(text: string): { blocked: boolean } {
  const parsed = parseIp(text);
  if (!parsed) return { blocked: true };
  return { blocked: parsed.version === 4 ? isBlockedIpv4(parsed.bytes) : isBlockedIpv6(parsed.bytes) };
}

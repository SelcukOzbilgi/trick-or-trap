import { describe, expect, it } from "vitest";
import { classifyAddress, parseIp } from "@/lib/capture/ip-ranges";

describe("parseIp", () => {
  it("parses dotted IPv4", () => {
    expect(parseIp("1.2.3.4")).toEqual({ version: 4, bytes: [1, 2, 3, 4] });
    expect(parseIp("0.0.0.0")).toEqual({ version: 4, bytes: [0, 0, 0, 0] });
    expect(parseIp("255.255.255.255")).toEqual({ version: 4, bytes: [255, 255, 255, 255] });
  });

  it("parses compressed IPv6", () => {
    const loopback = parseIp("::1");
    expect(loopback?.version).toBe(6);
    expect(loopback?.bytes).toHaveLength(16);
    expect(loopback?.bytes.slice(0, 15).every((b) => b === 0)).toBe(true);
    expect(loopback?.bytes[15]).toBe(1);

    const unspecified = parseIp("::");
    expect(unspecified?.bytes).toEqual(new Array(16).fill(0));

    const doc = parseIp("2001:db8::ff00:42:8329");
    expect(doc?.bytes).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0xff, 0x00, 0x00, 0x42, 0x83, 0x29,
    ]);
  });

  it("parses a full eight-group IPv6 address", () => {
    const full = parseIp("2606:4700:4700:0:0:0:0:1111");
    expect(full?.bytes).toEqual([0x26, 0x06, 0x47, 0, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x11, 0x11]);
  });

  it("parses IPv6 with a dotted IPv4 tail", () => {
    const mapped = parseIp("::ffff:1.2.3.4");
    expect(mapped?.version).toBe(6);
    expect(mapped?.bytes.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
  });

  it.each([
    "999.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "1.02.3.4",
    "1.2.3.256",
    "1.2.3.-4",
    "",
    "banana",
    "::g",
    "fe80::1%eth0",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1::2::3",
    ":::",
    ":1::",
    "12345::",
    "::1.2.3.4:5",
    "::ffff:1.2.3",
  ])("returns null for %j", (text) => {
    expect(parseIp(text)).toBeNull();
  });
});

describe("classifyAddress: IPv4 blocked ranges", () => {
  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.0.1",
    "169.254.169.254",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.5",
    "192.0.2.5",
    "192.88.99.1",
    "192.168.0.1",
    "192.168.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "168.63.129.16",
  ])("blocks %s", (address) => {
    expect(classifyAddress(address)).toEqual({ blocked: true });
  });
});

describe("classifyAddress: IPv4 allowed addresses", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "168.63.129.15",
    "168.63.129.17",
    "93.184.216.34",
  ])("allows %s", (address) => {
    expect(classifyAddress(address)).toEqual({ blocked: false });
  });
});

describe("classifyAddress: IPv6", () => {
  it.each([
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "ff02::1",
    "64:ff9b::1",
    "100::1",
    "fec0::1",
    "2001:db8::1",
    "2001::1",
    "2001:1ff::1",
    "2002::1",
    "2002:7f00:1::1",
    "3fff::1",
    "3fff:0fff::1",
    "1fff::1",
    "4000::1",
  ])("blocks %s", (address) => {
    expect(classifyAddress(address)).toEqual({ blocked: true });
  });

  it.each([
    "2606:4700:4700::1111",
    "2a00:1450:4001::1",
    "2001:200::1",
    "3fff:1000::1",
    "2000::1",
    "3ffe::1",
  ])("allows %s", (address) => {
    expect(classifyAddress(address)).toEqual({ blocked: false });
  });
});

describe("classifyAddress: IPv4-mapped IPv6", () => {
  it("applies the IPv4 rules to the embedded address in any spelling", () => {
    expect(classifyAddress("::ffff:127.0.0.1").blocked).toBe(true);
    expect(classifyAddress("::ffff:7f00:1").blocked).toBe(true);
    expect(classifyAddress("0:0:0:0:0:ffff:7f00:1").blocked).toBe(true);
    expect(classifyAddress("::FFFF:10.0.0.1").blocked).toBe(true);
    expect(classifyAddress("::ffff:a9fe:a9fe").blocked).toBe(true);
    expect(classifyAddress("::ffff:8.8.8.8").blocked).toBe(false);
    expect(classifyAddress("::ffff:808:808").blocked).toBe(false);
  });
});

describe("classifyAddress: unparsable text", () => {
  it.each(["", "banana", "999.1.1.1", "fe80::1%eth0", "2606:4700:4700::1111%1", "01.2.3.4", "1.2.3"])(
    "fails closed for %j",
    (text) => {
      expect(classifyAddress(text)).toEqual({ blocked: true });
    }
  );
});

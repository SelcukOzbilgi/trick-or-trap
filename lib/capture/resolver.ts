/**
 * The default `Resolver`: asks the operating system for the IPv4 and IPv6
 * addresses of a host name.
 */
import { lookup } from "node:dns/promises";
import type { Resolver } from "@/lib/capture/url-check";

export function createDnsResolver(): Resolver {
  return {
    async resolveAddresses(hostname: string): Promise<readonly string[]> {
      const results = await lookup(hostname, { all: true, verbatim: true });
      return results.map((result) => result.address);
    },
  };
}

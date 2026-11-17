import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { createDnsResolver } from "@/lib/capture/resolver";

const lookupMock = vi.mocked(lookup) as unknown as ReturnType<typeof vi.fn>;

describe("createDnsResolver", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("asks for all addresses, verbatim, and returns the address strings of both families", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    const addresses = await createDnsResolver().resolveAddresses("a.com");
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith("a.com", { all: true, verbatim: true });
    expect(addresses).toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
  });

  it("returns an empty list when the lookup returns no address", async () => {
    lookupMock.mockResolvedValue([]);
    expect(await createDnsResolver().resolveAddresses("a.com")).toEqual([]);
  });

  it("propagates a rejection", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(createDnsResolver().resolveAddresses("a.com")).rejects.toThrow("ENOTFOUND");
  });
});

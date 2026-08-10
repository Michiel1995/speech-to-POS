import type { POSAdapter } from "@/src/pos/adapter";
import { LightspeedPOSAdapter } from "@/src/pos/lightspeed-adapter";
import { MockPOSAdapter } from "@/src/pos/mock-adapter";

const mockAdapter = new MockPOSAdapter();

export function getPOSAdapter(): POSAdapter {
  return process.env.POS_ADAPTER === "lightspeed"
    ? LightspeedPOSAdapter.fromEnvironment()
    : mockAdapter;
}

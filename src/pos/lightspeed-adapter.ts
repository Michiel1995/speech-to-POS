import { UnsupportedCapabilityError, DomainError } from "@/src/domain/errors";
import {
  TenantMenuSchema,
  type DraftOrder,
  type MenuProduct,
  type ModifierGroup,
  type Table,
  type TenantMenu,
} from "@/src/domain/schemas";
import type { POSAdapter } from "@/src/pos/adapter";

interface LightspeedConfig {
  accessToken: string;
  businessLocationId: string;
  menuId?: string;
  baseUrl: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function flattenMenuEntries(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenMenuEntries);
  const item = record(value);
  const result: JsonRecord[] = item["@type"] === "menuItem" ? [item] : [];
  for (const key of ["menuEntryGroups", "menuEntry", "items"]) {
    result.push(...flattenMenuEntries(item[key]));
  }
  return result;
}

export class LightspeedPOSAdapter implements POSAdapter {
  readonly name = "lightspeed-k-series";
  readonly capabilities = {
    menuRead: true,
    tableRead: true,
    openOrderRead: true,
    draftOrderCreate: false,
    draftOrderUpdate: false,
  } as const;

  constructor(private readonly config: LightspeedConfig) {}

  static fromEnvironment() {
    const accessToken = process.env.LIGHTSPEED_ACCESS_TOKEN;
    const businessLocationId = process.env.LIGHTSPEED_BUSINESS_LOCATION_ID;
    if (!accessToken || !businessLocationId) {
      throw new DomainError(
        "Lightspeed requires LIGHTSPEED_ACCESS_TOKEN and LIGHTSPEED_BUSINESS_LOCATION_ID.",
        "LIGHTSPEED_NOT_CONFIGURED",
        503,
      );
    }
    return new LightspeedPOSAdapter({
      accessToken,
      businessLocationId,
      menuId: process.env.LIGHTSPEED_MENU_ID,
      baseUrl: process.env.LIGHTSPEED_BASE_URL ?? "https://api.lsk.lightspeed.app",
    });
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.config.baseUrl), {
      headers: { Authorization: `Bearer ${this.config.accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new DomainError(
        `Lightspeed ${response.status}: ${await response.text()}`,
        "LIGHTSPEED_API_ERROR",
        502,
      );
    }
    return (await response.json()) as T;
  }

  private async resolveMenuId(): Promise<string> {
    if (this.config.menuId) return this.config.menuId;
    const menus = await this.request<Array<{ ikentooMenuId: number }>>(
      `/o/op/1/menu/list?businessLocationId=${encodeURIComponent(this.config.businessLocationId)}`,
    );
    if (!menus[0]) throw new DomainError("Lightspeed returned no menu.", "LIGHTSPEED_MENU_MISSING", 404);
    return String(menus[0].ikentooMenuId);
  }

  async getTables(): Promise<Table[]> {
    const floors = await this.request<
      Array<{ tables?: Array<{ id: string; number: number; description?: string; active: boolean }> }>
    >(`/o/op/data/${encodeURIComponent(this.config.businessLocationId)}/floorplans?expandTables=true`);
    return floors.flatMap((floor) =>
      (floor.tables ?? []).map((table) => ({
        id: String(table.id),
        number: table.number,
        label: table.description || `Table ${table.number}`,
        active: table.active,
      })),
    );
  }

  async getMenu(): Promise<TenantMenu> {
    const menuId = await this.resolveMenuId();
    const [rawMenu, rawModifierGroups, tables] = await Promise.all([
      this.request<unknown>(
        `/o/op/2/menu/load/${encodeURIComponent(menuId)}?businessLocationId=${encodeURIComponent(this.config.businessLocationId)}&richContent=true`,
      ),
      this.request<
        Array<{
          multiSelectionPermitted: boolean;
          productionInstructionGroupName: string;
          productionIntructionGroupId: number;
          productionInstructionList: Array<{ instruction: string; ikentooModifierId: number }>;
        }>
      >(`/o/op/1/menu/modifiers?businessLocationId=${encodeURIComponent(this.config.businessLocationId)}`),
      this.getTables(),
    ]);

    const modifierGroups: ModifierGroup[] = rawModifierGroups.map((group) => ({
      id: String(group.productionIntructionGroupId),
      name: group.productionInstructionGroupName,
      required: false,
      min: 0,
      max: group.multiSelectionPermitted ? Math.max(1, group.productionInstructionList.length) : 1,
      options: group.productionInstructionList.map((option) => ({
        id: String(option.ikentooModifierId),
        posName: option.instruction,
        canonicalName: option.instruction,
        aliases: [option.instruction],
        priceCents: 0,
      })),
    }));

    const products: MenuProduct[] = flattenMenuEntries(rawMenu).map((item) => {
      const rich = record(item.itemRichData);
      const sku = String(item.sku ?? "");
      const productName = String(item.productName ?? sku);
      const instructionGroups = Array.isArray(item.productionInstructionList)
        ? item.productionInstructionList.map((group) => String(record(group).productionInstructionGroupId ?? ""))
        : [];
      return {
        id: `LSK:${sku}`,
        sku,
        posName: productName,
        canonicalName: productName,
        category: "Imported",
        defaultCourse: "unspecified" as const,
        priceCents: Math.round(Number(item.productPrice ?? 0) * 100),
        active: Boolean(sku),
        aliases: [productName],
        modifierGroupIds: instructionGroups.filter(Boolean),
        allergenCodes: Array.isArray(rich.allergenCodes) ? rich.allergenCodes.map(String) : [],
      };
    });

    return TenantMenuSchema.parse({
      tenantId: `lightspeed:${this.config.businessLocationId}`,
      restaurantName: "Lightspeed Restaurant",
      version: `lightspeed-menu-${menuId}`,
      currency: "EUR",
      products,
      modifierGroups,
      tables,
    });
  }

  async createDraftOrder(): Promise<DraftOrder> {
    throw new UnsupportedCapabilityError(
      "Lightspeed K-Series public API documentation does not expose a parked/draft order state. The live Create Local Order endpoint is intentionally not called because waiter confirmation in the POS must happen first.",
    );
  }

  async getOrder(externalOrderId: string) {
    const checks = await this.request<Array<JsonRecord>>(
      `/o/op/1/order/table/getCheck?businessLocationId=${encodeURIComponent(this.config.businessLocationId)}`,
    );
    return checks.find((check) => String(check.uuid ?? check.id ?? "") === externalOrderId) ?? null;
  }
}

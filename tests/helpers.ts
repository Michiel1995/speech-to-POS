import { demoMenu } from "@/src/data/demo-menu";
import { InterpretRequestSchema, type ConversationTurn, type DraftLine } from "@/src/domain/schemas";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";

export function interpret(turns: ConversationTurn[], priorLines?: DraftLine[], contextProductIds?: string[]) {
  const request = InterpretRequestSchema.parse({
    tenantId: demoMenu.tenantId,
    tableId: "TABLE-12",
    tableLabel: "Table 12",
    waiterId: "waiter-test",
    source: "text",
    engine: "deterministic",
    turns,
    priorLines,
    contextProductIds,
  });
  return interpretDeterministically(request, demoMenu);
}

export function customer(text: string): ConversationTurn {
  return { speaker: "customer", text };
}

export function waiter(text: string): ConversationTurn {
  return { speaker: "waiter", text };
}

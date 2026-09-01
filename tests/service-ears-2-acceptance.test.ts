import { describe, expect, it } from "vitest";

import { calculateEvaluationReport } from "@/src/analytics/evaluation-metrics";
import { analyzeAudioQuality } from "@/src/audio/audio-quality";
import { demoMenu } from "@/src/data/demo-menu";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { appendTableEvents, memoryEventFromAction, stableUtteranceId, wasUtteranceProcessed } from "@/src/memory/table-memory";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { buildMenuAnswer } from "@/src/order-understanding/menu-question";
import { planOrderAction } from "@/src/order-understanding/order-actions";
import { routeIntent } from "@/src/order-understanding/intent-router";
import { shouldClearTranscriptAfterSuccess } from "@/src/ui/transcript";
import { validateDraft } from "@/src/validation/order-validator";
import { customer, interpret, waiter } from "@/tests/helpers";

describe("20 mandatory Service Ears 2.0 acceptance scenarios", () => {
  it("1 answers a beer question without changing the order", () => {
    expect(buildMenuAnswer("Welke bieren hebben jullie?", demoMenu)?.message).toContain("Leffe Blond");
    expect(interpret([customer("Welke bieren hebben jullie?")]).lines).toHaveLength(0);
  });
  it("2 recognizes Flemish 'Wa hedde van bier?' as a question", () => {
    expect(routeIntent("Wa hedde van bier?", { menu: demoMenu }).intent).toBe("menu_question");
    expect(buildMenuAnswer("Wa hedde van bier?", demoMenu)?.productIds.length).toBeGreaterThan(0);
  });
  it("3 resolves 'die blonde' from the waiter's offer", () => {
    const draft = interpret([waiter("We hebben Duvel en Leffe Blond."), customer("Geef mij die blonde maar.")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1003", quantity: 1 }]);
  });
  it("4 maps 'leven blond' safely to Leffe Blond", () => {
    expect(interpret([customer("Ik neem een leven blond")]).lines).toMatchObject([{ productId: "POS-1003" }]);
  });
  it("5 requires confirmation for uncertain coka cola zero audio", () => {
    const request = InterpretRequestSchema.parse({ tenantId: demoMenu.tenantId, tableId: "TABLE-12", tableLabel: "Table 12", waiterId: "qa", source: "audio", engine: "deterministic", turns: [customer("Doe er een coka cola zero bij")] });
    const draft = interpretDeterministically(request, demoMenu);
    expect(draft.issues).toContainEqual(expect.objectContaining({ type: "speech_confirmation", blocking: true }));
  });
  it("6 ignores a family story mentioning Duvel", () => expect(interpret([customer("Mijn nonkel drinkt altijd Duvel")]).lines).toHaveLength(0));
  it("7 increments without replacing an existing order", () => {
    const first = interpret([customer("Ik neem een Duvel")]);
    const second = interpret([customer("Doe er nog een Stella bij")], first.lines);
    expect(second.lines.map((line) => line.productId).sort()).toEqual(["POS-1001", "POS-1002"]);
  });
  it("8 clears captured transcript after successful text or audio processing", () => {
    expect(shouldClearTranscriptAfterSuccess("audio")).toBe(true);
    expect(shouldClearTranscriptAfterSuccess("text")).toBe(true);
    expect(shouldClearTranscriptAfterSuccess("manual")).toBe(false);
  });
  it("9 removes a naturally cancelled Duvel", () => {
    const first = interpret([customer("Een Duvel en een Stella")]);
    const next = interpret([customer("Ik hoef misschien toch geen Duvel")], first.lines);
    expect(next.lines.map((line) => line.productId)).toEqual(["POS-1002"]);
  });
  it("10 removes only the intended pintje", () => {
    const first = interpret([customer("Een Duvel en een pintje")]);
    const next = interpret([customer("Laat dat pintje maar zitten")], first.lines);
    expect(next.lines.map((line) => line.productId)).toEqual(["POS-1001"]);
  });
  it("11 replaces cola with cola zero instead of adding both", () => {
    const first = interpret([customer("Een cola graag")]);
    const next = interpret([customer("Doe toch maar cola zero in plaats van cola")], first.lines);
    expect(next.lines).toMatchObject([{ productId: "POS-1102", quantity: 1 }]);
    expect(next.lines).toHaveLength(1);
  });
  it("12 uses the previous table line for 'dezelfde als daarnet'", () => {
    const first = interpret([customer("Een Duvel")]);
    const next = interpret([customer("Dezelfde als daarnet")], first.lines);
    expect(next.lines).toMatchObject([{ productId: "POS-1001", quantity: 2 }]);
  });
  it("13 represents resumable table context as a compact event", () => {
    const route = routeIntent("Een Duvel", { menu: demoMenu });
    const event = memoryEventFromAction("TABLE-12", stableUtteranceId("TABLE-12", "Een Duvel"), planOrderAction(route, demoMenu));
    expect(appendTableEvents([], [event])[0]).toMatchObject({ tableId: "TABLE-12", productIds: ["POS-1001"] });
  });
  it("14 never mixes table 12 and table 13 event context", () => {
    const action = planOrderAction(routeIntent("Een Duvel", { menu: demoMenu }), demoMenu);
    const table12 = appendTableEvents([], [memoryEventFromAction("TABLE-12", "u12", action)]);
    const table13 = appendTableEvents([], [memoryEventFromAction("TABLE-13", "u13", action)]);
    expect(table12.every((event) => event.tableId === "TABLE-12") && table13.every((event) => event.tableId === "TABLE-13")).toBe(true);
  });
  it("15 treats a question containing a product name as no order", () => expect(interpret([customer("Hebben jullie Duvel?")]).lines).toHaveLength(0));
  it("16 keeps offered-product context across a joke", () => {
    const draft = interpret([waiter("We hebben Duvel en Leffe Blond"), customer("Mijn nonkel maakt altijd een mop over bier"), customer("Geef mij die blonde maar")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1003" }]);
  });
  it("17 blocks an uncertain order from POS validation", () => {
    const request = InterpretRequestSchema.parse({ tenantId: demoMenu.tenantId, tableId: "TABLE-12", tableLabel: "Table 12", waiterId: "qa", source: "audio", engine: "deterministic", turns: [customer("Doe een coka cola zero")] });
    expect(validateDraft(interpretDeterministically(request, demoMenu), demoMenu).valid).toBe(false);
  });
  it("18 blocks an empty order from POS validation", () => expect(validateDraft(interpret([customer("Welke bieren hebben jullie?")]), demoMenu).valid).toBe(false));
  it("19 identifies a repeated utterance for idempotent processing", () => {
    const id = stableUtteranceId("TABLE-12", "Een Duvel");
    const action = planOrderAction(routeIntent("Een Duvel", { menu: demoMenu }), demoMenu);
    expect(wasUtteranceProcessed([memoryEventFromAction("TABLE-12", id, action)], id)).toBe(true);
  });
  it("20 keeps the deterministic core independent of API keys and reports offline metrics", () => {
    const draft = interpret([customer("Een Duvel")]);
    expect(draft.lines[0].productId).toBe("POS-1001");
    expect(calculateEvaluationReport([{ expectedIntent: "order", actualIntent: "order", expectedProductIds: ["POS-1001"], actualProductIds: ["POS-1001"], exactOrder: true, orderMutated: true, removalApplied: false, clarificationRequested: false, latencyMs: 12, dialectProfile: "standard" }]).exactOrderMatch).toBe(1);
  });

  it("21 gives an explicitly named product priority over stale offered-product context", () => {
    const first = interpret([customer("Een Leffe Blond")]);
    const next = interpret([customer("Doe er nog een Duvel bij")], first.lines, ["POS-1003"]);
    expect(next.lines.map((line) => ({ productId: line.productId, quantity: line.quantity }))).toEqual([
      { productId: "POS-1003", quantity: 1 },
      { productId: "POS-1001", quantity: 1 },
    ]);
  });
});

describe("audio and evaluation quality helpers", () => {
  it("answers a contextual price follow-up", () => expect(buildMenuAnswer("Hoeveel kost die?", demoMenu, ["POS-1001"])?.message).toContain("€5,20"));
  it("answers a contextual allergen follow-up", () => expect(buildMenuAnswer("Wat zit daarin?", demoMenu, ["POS-2001"])?.message).toContain("crustaceans"));
  it("flags silence", () => expect(analyzeAudioQuality([new Float32Array(2_000)]).warnings).toContain("mostly_silence"));
  it("flags clipping", () => expect(analyzeAudioQuality([new Float32Array(2_000).fill(1)]).warnings).toContain("clipping"));
  it("reports false-order rate separately", () => {
    const report = calculateEvaluationReport([{ expectedIntent: "non_order", actualIntent: "order", expectedProductIds: [], actualProductIds: ["POS-1001"], exactOrder: false, orderMutated: true, removalApplied: false, clarificationRequested: false, latencyMs: 20, dialectProfile: "antwerp" }]);
    expect(report.falseOrderRate).toBe(1);
  });
});

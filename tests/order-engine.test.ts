import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { DraftOrderSchema } from "@/src/domain/schemas";
import { MockPOSAdapter } from "@/src/pos/mock-adapter";
import { validateDraft } from "@/src/validation/order-validator";
import { customer, interpret, waiter } from "@/tests/helpers";

describe("deterministic hospitality order engine", () => {
  it("produces the complete core demo without duplicating waiter confirmation", () => {
    const draft = interpret([
      customer("Voor mij de steak saignant met frieten en pepersaus."),
      waiter("Dus steak saignant, frieten en pepersaus?"),
      customer("Ja."),
      customer("Voor mij de vol-au-vent met kroketten en twee Duvel."),
      customer("Nee wacht, één Duvel en doe er een Stella bij."),
    ]);

    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["POS-3001", 1],
      ["POS-3002", 1],
      ["POS-1001", 1],
      ["POS-1002", 1],
    ]);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId).sort()).toEqual([
      "MOD-FRIES",
      "MOD-PEPPER",
      "MOD-SAIGN",
    ]);
    expect(draft.lines[1].modifiers.map((modifier) => modifier.optionId)).toEqual(["MOD-CROQ"]);
    expect(draft.issues).toHaveLength(0);
  });

  it("returns unbiased Leffe choices and no guessed order line", () => {
    const draft = interpret([customer("Een Leffe.")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues[0].type).toBe("ambiguous_product");
    expect(draft.issues[0].productCandidates?.map((candidate) => candidate.productId)).toEqual([
      "POS-1003",
      "POS-1004",
      "POS-1005",
    ]);
  });

  it("never invents an unknown product", () => {
    const draft = interpret([customer("Voor mij een truffelpasta.")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{ type: "unresolved_product", blocking: true }]);
  });

  it("does not convert a product question into an order", () => {
    const draft = interpret([customer("Hebben jullie alcoholvrij bier?")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
  });

  it("orders a specific product after a question", () => {
    const draft = interpret([
      customer("Hebben jullie alcoholvrij bier?"),
      waiter("We hebben Leffe 0.0."),
      customer("Dan neem ik de alcoholvrije Leffe."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1005", quantity: 1 }]);
  });

  it("handles mixed-language modifiers", () => {
    const draft = interpret([customer("Voor mij de steak medium rare with fries en béarnaise.")]);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId).sort()).toEqual([
      "MOD-BEARN",
      "MOD-FRIES",
      "MOD-MRARE",
    ]);
    expect(draft.issues).toHaveLength(0);
  });

  it("surfaces required modifiers instead of filling defaults", () => {
    const draft = interpret([customer("Een steak.")]);
    expect(draft.issues.filter((issue) => issue.type === "missing_modifier")).toHaveLength(2);
  });

  it("applies an accepted waiter suggestion once", () => {
    const draft = interpret([
      customer("Voor mij een steak saignant."),
      waiter("Ik zet daar frieten bij, goed?"),
      customer("Ja"),
    ]);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId)).toContain("MOD-FRIES");
  });

  it("replaces a spoken correction rather than adding a second line", () => {
    const draft = interpret([
      customer("Een cola."),
      customer("Verander die cola naar cola zero."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1102", quantity: 1 }]);
  });

  it("removes a cancelled item before submission", () => {
    const draft = interpret([
      customer("Een koffie."),
      customer("Laat die koffie toch maar vallen."),
    ]);
    expect(draft.lines).toHaveLength(0);
  });

  it("understands implicit contextual quantity", () => {
    const draft = interpret([customer("Voor ons allebei frieten.")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-3101", quantity: 2 }]);
  });

  it("flags duplicate POS aliases as ambiguous", () => {
    const draft = interpret([customer("Twee witte huiswijn.")]);
    expect(draft.issues[0].productCandidates).toHaveLength(2);
  });

  it("captures allergy statements as manual checks", () => {
    const draft = interpret([customer("De vol-au-vent is voor iemand met een notenallergie, met frieten.")]);
    expect(draft.warnings).toMatchObject([{ type: "allergy_manual_check" }]);
    expect(draft.warnings[0].message).toContain("manual check required");
  });

  it("requires confirmation for unusual course timing", () => {
    const draft = interpret([customer("Ik neem de garnaalkroketten maar breng die samen met mijn steak.")]);
    expect(draft.issues.map((issue) => issue.type)).toContain("course_exception");
    expect(draft.lines.find((line) => line.productId === "POS-2001")?.course).toBe("main");
  });

  it("maps a POS-native composite drink as one product", () => {
    const draft = interpret([customer("Een gin tonic.")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1201", quantity: 1 }]);
  });

  it("rejects invalid POS IDs in deterministic validation", () => {
    const draft = interpret([customer("Een Duvel.")]);
    const invalid = DraftOrderSchema.parse({ ...draft, lines: [{ ...draft.lines[0], productId: "MADE-UP" }] });
    expect(validateDraft(invalid, demoMenu)).toMatchObject({ valid: false });
  });
});

describe("mock POS adapter", () => {
  it("creates an idempotent draft that still requires waiter confirmation", async () => {
    const adapter = new MockPOSAdapter();
    const draft = interpret([customer("Een Duvel.")]);
    const first = await adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-001", sentBy: "waiter-test" });
    const second = await adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-001", sentBy: "waiter-test" });
    expect(second.posSubmission?.externalOrderId).toBe(first.posSubmission?.externalOrderId);
    expect(first.status).toBe("SENT");
    expect(first.posSubmission?.confirmedByWaiter).toBe(false);
  });

  it("blocks a draft that still has human-resolution issues", async () => {
    const adapter = new MockPOSAdapter();
    const draft = interpret([customer("Een Leffe.")]);
    await expect(adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-002", sentBy: "waiter-test" })).rejects.toMatchObject({ code: "INVALID_DRAFT" });
  });
});

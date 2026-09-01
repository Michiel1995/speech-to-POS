import type { ConversationTurn } from "@/src/domain/schemas";

export interface EvaluationCase {
  id: string;
  category: string;
  turns: ConversationTurn[];
  deterministic: boolean;
  expected: {
    lines: Array<{ productId: string; quantity: number; modifierIds?: string[] }>;
    issueTypes?: string[];
    warningTypes?: string[];
    note?: string;
  };
}

const c = (text: string): ConversationTurn => ({ speaker: "customer", text });
const w = (text: string): ConversationTurn => ({ speaker: "waiter", text });

export const evaluationCases: EvaluationCase[] = [
  { id: "drink-01", category: "simple drinks", turns: [c("Drie Duvel.")], deterministic: true, expected: { lines: [{ productId: "POS-1001", quantity: 3 }] } },
  { id: "drink-02", category: "simple drinks", turns: [c("Twee Stella alstublieft.")], deterministic: true, expected: { lines: [{ productId: "POS-1002", quantity: 2 }] } },
  { id: "drink-03", category: "dialect", turns: [c("Voor mij ne zero.")], deterministic: true, expected: { lines: [{ productId: "POS-1102", quantity: 1 }] } },
  { id: "drink-04", category: "multilingual", turns: [c("Deux Duvel et one Stella.")], deterministic: true, expected: { lines: [{ productId: "POS-1001", quantity: 2 }, { productId: "POS-1002", quantity: 1 }] } },
  { id: "drink-05", category: "composite items", turns: [c("Een gin tonic.")], deterministic: true, expected: { lines: [{ productId: "POS-1201", quantity: 1 }] } },
  { id: "drink-06", category: "colloquial", turns: [c("Doe mij een pintje.")], deterministic: true, expected: { lines: [{ productId: "POS-1002", quantity: 1 }] } },
  { id: "drink-07", category: "soft drinks", turns: [c("Twee cola zero.")], deterministic: true, expected: { lines: [{ productId: "POS-1102", quantity: 2 }] } },
  { id: "drink-08", category: "French", turns: [c("Une eau plate.")], deterministic: true, expected: { lines: [{ productId: "POS-1103", quantity: 1 }] } },
  { id: "drink-09", category: "coffee", turns: [c("Een decaf koffie.")], deterministic: true, expected: { lines: [{ productId: "POS-4001", quantity: 1, modifierIds: ["MOD-DECAF"] }] } },
  { id: "drink-10", category: "coffee", turns: [c("Un café avec lait d'avoine.")], deterministic: true, expected: { lines: [{ productId: "POS-4001", quantity: 1, modifierIds: ["MOD-OAT"] }] } },
  { id: "food-01", category: "modifiers", turns: [c("Een steak saignant met frieten en pepersaus.")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-PEPPER", "MOD-SAIGN"] }] } },
  { id: "food-02", category: "mixed language", turns: [c("Voor mij de steak medium rare with fries en béarnaise.")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-BEARN", "MOD-FRIES", "MOD-MRARE"] }] } },
  { id: "food-03", category: "French", turns: [c("Pour moi le steak saignant avec frites et béarnaise.")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-BEARN", "MOD-FRIES", "MOD-SAIGN"] }] } },
  { id: "food-04", category: "required modifiers", turns: [c("Een steak.")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1 }], issueTypes: ["missing_modifier"] } },
  { id: "food-05", category: "sides", turns: [c("Vol-au-vent met kroketten.")], deterministic: true, expected: { lines: [{ productId: "POS-3002", quantity: 1, modifierIds: ["MOD-CROQ"] }] } },
  { id: "food-06", category: "implicit quantities", turns: [c("Voor ons allebei frieten.")], deterministic: true, expected: { lines: [{ productId: "POS-3101", quantity: 2 }] } },
  { id: "food-07", category: "shared items", turns: [c("Een portie frieten voor ons samen.")], deterministic: true, expected: { lines: [{ productId: "POS-3101", quantity: 1 }] } },
  { id: "food-08", category: "vegetarian", turns: [c("De vegetarische stoofpot met salade.")], deterministic: true, expected: { lines: [{ productId: "POS-3004", quantity: 1, modifierIds: ["MOD-SALAD"] }] } },
  { id: "food-09", category: "fish", turns: [c("Poisson du jour avec frites.")], deterministic: true, expected: { lines: [{ productId: "POS-3003", quantity: 1, modifierIds: ["MOD-FRIES"] }] } },
  { id: "food-10", category: "dessert", turns: [c("Deux mousse au chocolat.")], deterministic: true, expected: { lines: [{ productId: "POS-5001", quantity: 2 }] } },
  { id: "intent-01", category: "questions", turns: [c("Hebben jullie alcoholvrij bier?")], deterministic: true, expected: { lines: [] } },
  { id: "intent-02", category: "question then order", turns: [c("Hebben jullie alcoholvrij bier?"), w("We hebben Leffe 0.0."), c("Dan neem ik de alcoholvrije Leffe.")], deterministic: true, expected: { lines: [{ productId: "POS-1005", quantity: 1 }] } },
  { id: "intent-03", category: "waiter confirmation", turns: [c("Een Duvel."), w("Dus één Duvel?"), c("Ja.")], deterministic: true, expected: { lines: [{ productId: "POS-1001", quantity: 1 }] } },
  { id: "intent-04", category: "waiter suggestions", turns: [c("Een steak saignant."), w("Ik zet daar frieten bij, goed?"), c("Ja")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-SAIGN"] }] } },
  { id: "intent-05", category: "unconfirmed suggestion", turns: [c("Een steak saignant."), w("Ik zet daar frieten bij, goed?"), c("Nee")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-SAIGN"] }], issueTypes: ["missing_modifier"] } },
  { id: "intent-06", category: "informational", turns: [c("Mijn broer drinkt altijd Duvel, grappig hè.")], deterministic: false, expected: { lines: [], note: "A mention without ordering intent must be ignored." } },
  { id: "intent-07", category: "recommendation", turns: [w("Ik raad de vis van de dag aan."), c("Ik denk er nog over na.")], deterministic: false, expected: { lines: [] } },
  { id: "intent-08", category: "explicit acceptance", turns: [w("Zal ik de vis van de dag nemen?"), c("Ja graag, met frieten.")], deterministic: false, expected: { lines: [{ productId: "POS-3003", quantity: 1, modifierIds: ["MOD-FRIES"] }] } },
  { id: "correction-01", category: "quantity correction", turns: [c("Drie Duvel."), c("Nee wacht, twee Duvel en een Stella.")], deterministic: true, expected: { lines: [{ productId: "POS-1001", quantity: 2 }, { productId: "POS-1002", quantity: 1 }] } },
  { id: "correction-02", category: "replacement", turns: [c("Een cola."), c("Verander die cola naar cola zero.")], deterministic: true, expected: { lines: [{ productId: "POS-1102", quantity: 1 }] } },
  { id: "correction-03", category: "cancellation", turns: [c("Een koffie."), c("Laat die koffie toch maar vallen.")], deterministic: true, expected: { lines: [] } },
  { id: "correction-04", category: "modifier correction", turns: [c("Steak saignant met frieten."), c("Maak de cuisson medium rare.")], deterministic: false, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-MRARE"] }] } },
  { id: "correction-05", category: "multi-item correction", turns: [c("Twee Stella en een Duvel."), c("Doe toch drie Stella en geen Duvel.")], deterministic: false, expected: { lines: [{ productId: "POS-1002", quantity: 3 }] } },
  { id: "ambiguity-01", category: "ambiguous products", turns: [c("Een Leffe.")], deterministic: true, expected: { lines: [], issueTypes: ["ambiguous_product"] } },
  { id: "ambiguity-02", category: "duplicate POS products", turns: [c("Twee witte huiswijn.")], deterministic: true, expected: { lines: [], issueTypes: ["ambiguous_product"] } },
  { id: "ambiguity-03", category: "unknown products", turns: [c("Voor mij een truffelpasta.")], deterministic: true, expected: { lines: [], issueTypes: ["unresolved_product"] } },
  { id: "ambiguity-04", category: "specific resolution", turns: [c("Een alcoholvrije Leffe.")], deterministic: true, expected: { lines: [{ productId: "POS-1005", quantity: 1 }] } },
  { id: "ambiguity-05", category: "historical reference", turns: [c("Nog hetzelfde als daarnet.")], deterministic: false, expected: { lines: [], issueTypes: ["unresolved_product"], note: "Without one clear previous referent, ask." } },
  { id: "safety-01", category: "allergies", turns: [c("De vol-au-vent met frieten is voor iemand met een notenallergie.")], deterministic: true, expected: { lines: [{ productId: "POS-3002", quantity: 1, modifierIds: ["MOD-FRIES"] }], warningTypes: ["allergy_manual_check"] } },
  { id: "safety-02", category: "allergies", turns: [c("Is de chocolademousse glutenvrij?")], deterministic: false, expected: { lines: [], note: "Question only; never claim safety." } },
  { id: "safety-03", category: "dietary", turns: [c("Ik neem de vegetarische stoofpot; ik heb een selderallergie.")], deterministic: false, expected: { lines: [{ productId: "POS-3004", quantity: 1 }], warningTypes: ["allergy_manual_check"] } },
  { id: "safety-04", category: "free-text notes", turns: [c("Steak saignant met frieten, pepersaus apart.")], deterministic: true, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-PEPPER", "MOD-SAIGN"] }] } },
  { id: "course-01", category: "course changes", turns: [c("Ik neem de garnaalkroketten maar breng die samen met mijn steak.")], deterministic: false, expected: { lines: [{ productId: "POS-2001", quantity: 1 }], issueTypes: ["course_exception"] } },
  { id: "course-02", category: "courses", turns: [c("Eerst de garnaalkroketten, daarna de steak saignant met frieten.")], deterministic: false, expected: { lines: [{ productId: "POS-2001", quantity: 1 }, { productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-SAIGN"] }] } },
  { id: "course-03", category: "delayed service", turns: [c("Een witte huiswijn, maar breng die pas bij het hoofdgerecht.")], deterministic: false, expected: { lines: [], issueTypes: ["ambiguous_product"], note: "Preserve delayed-service instruction after product resolution." } },
  { id: "speaker-01", category: "multiple speakers", turns: [c("Voor mij de steak saignant."), w("Dus één steak saignant?"), c("Ja."), c("En frieten." )], deterministic: false, expected: { lines: [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-FRIES", "MOD-SAIGN"] }] } },
  { id: "speaker-02", category: "overlapping confirmations", turns: [c("Twee Duvel."), w("Twee Duvel?"), c("Ja, twee." )], deterministic: false, expected: { lines: [{ productId: "POS-1001", quantity: 2 }] } },
  { id: "speaker-03", category: "different guests", turns: [c("Voor mij vol-au-vent met kroketten."), c("En voor mij de vis van de dag met salade.")], deterministic: true, expected: { lines: [{ productId: "POS-3002", quantity: 1, modifierIds: ["MOD-CROQ"] }, { productId: "POS-3003", quantity: 1, modifierIds: ["MOD-SALAD"] }] } },
  { id: "speaker-04", category: "waiter voice profile", turns: [w("Ik herhaal: één gin tonic."), c("Dat klopt.")], deterministic: false, expected: { lines: [{ productId: "POS-1201", quantity: 1 }], note: "Requires reliable waiter/customer role evidence." } },
  { id: "noise-01", category: "restaurant noise", turns: [c("[glazen] twee... eh... twee Stella.")], deterministic: false, expected: { lines: [{ productId: "POS-1002", quantity: 2 }] } },
  { id: "noise-02", category: "Belgian accents", turns: [c("Ne kôffie mé wa melk.")], deterministic: false, expected: { lines: [{ productId: "POS-4001", quantity: 1, modifierIds: ["MOD-MILK"] }] } },
  { id: "noise-03", category: "code switching", turns: [c("Deux steaks medium rare met frites, one béarnaise and one pepper sauce.")], deterministic: false, expected: { lines: [{ productId: "POS-3001", quantity: 2 }], note: "Per-person modifier association must be retained." } },
  { id: "ops-01", category: "person context", turns: [c("De vol-au-vent met kroketten is voor de persoon met notenallergie.")], deterministic: true, expected: { lines: [{ productId: "POS-3002", quantity: 1, modifierIds: ["MOD-CROQ"] }], warningTypes: ["allergy_manual_check"] } },
  { id: "ops-02", category: "shared items", turns: [c("Een gin tonic voor mij en een portie frieten voor ons samen.")], deterministic: true, expected: { lines: [{ productId: "POS-1201", quantity: 1 }, { productId: "POS-3101", quantity: 1 }] } },
  { id: "ops-03", category: "invalid menu item", turns: [c("Een cola old.")], deterministic: false, expected: { lines: [], issueTypes: ["unresolved_product"], note: "Archived products cannot be submitted." } },
  { id: "ops-04", category: "missing modifiers", turns: [c("Twee vis van de dag.")], deterministic: true, expected: { lines: [{ productId: "POS-3003", quantity: 2 }], issueTypes: ["missing_modifier"] } },
  { id: "ops-05", category: "manual notes", turns: [c("Vol-au-vent met frieten, saus apart en snel graag.")], deterministic: false, expected: { lines: [{ productId: "POS-3002", quantity: 1, modifierIds: ["MOD-FRIES"] }], note: "Preserve operational note without inventing workflow." } },
  { id: "ops-06", category: "multilingual question", turns: [c("Quels bières sans alcool avez-vous?")], deterministic: false, expected: { lines: [] } },
];

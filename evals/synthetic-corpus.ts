import { createHash } from "node:crypto";

import { evaluationCases, type EvaluationCase } from "@/evals/conversations";
import { demoMenu } from "@/src/data/demo-menu";
import type { ConversationTurn } from "@/src/domain/schemas";

export const SYNTHETIC_CORPUS_VERSION = "1.0.0";
export const SYNTHETIC_CORPUS_SEED = 20260824;

export type SyntheticSplit = "development" | "validation" | "test";

export interface SyntheticCase extends EvaluationCase {
  difficulty: "basic" | "intermediate" | "hard" | "adversarial";
  language: "nl" | "fr" | "en" | "mixed";
  dialect: "standard" | "flemish" | "brussels" | "none";
  speakerRole: "customer" | "waiter" | "mixed";
  sourceCaseId: string;
  seed: number;
  generatorVersion: string;
  split: SyntheticSplit;
}

const registers = [
  (text: string) => text,
  (text: string) => `${text.replace(/[.!?]+$/, "")} alsjeblieft.`,
  (text: string) => `Voor mij ${text.toLowerCase()}`,
  (text: string) => `${text.replace(/[.!?]+$/, "")}, dank u.`,
  (text: string) => text.replace(/\./g, "").replace(/\s+/g, " ").trim(),
  (text: string) => text.toLowerCase(),
  (text: string) => text.toUpperCase(),
  (text: string) => `${text.replace(/[.!?]+$/, "")} hé.`,
  (text: string) => `Graag ${text.toLowerCase()}`,
  (text: string) => `${text.replace(/[.!?]+$/, "")}, merci.`,
];

const prefixes = ["", "Alstublieft, ", "Graag, ", "Voor ons, ", "Mag ik ", "We nemen ", "Ik zou graag ", "Doe maar ", "Voor mij ", "Kunt u noteren: "];
const suffixes = ["", ".", " alsjeblieft", " graag", " dank u", " merci", " hé", " voor deze tafel", " als het kan", " aub"];

const languageByCategory: Record<string, SyntheticCase["language"]> = {
  French: "fr",
  "mixed language": "mixed",
  "multilingual": "mixed",
};

function hash(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function splitFor(id: string): SyntheticSplit {
  const bucket = hash(id) % 20;
  return bucket < 14 ? "development" : bucket < 17 ? "validation" : "test";
}

function difficultyFor(source: EvaluationCase): SyntheticCase["difficulty"] {
  if (/ambiguous|unknown|allerg|noise|speaker|correction|course|question/i.test(source.category)) return "hard";
  if (source.turns.length > 1 || source.expected.issueTypes?.length) return "intermediate";
  return source.category === "simple drinks" ? "basic" : "intermediate";
}

function dialectFor(source: EvaluationCase, index: number): SyntheticCase["dialect"] {
  if (/dialect|Belgian|noise/i.test(source.category)) return index % 2 ? "brussels" : "flemish";
  return "standard";
}

function varyTurns(source: EvaluationCase, variant: number): ConversationTurn[] {
  const register = registers[variant % registers.length];
  const prefix = prefixes[Math.floor(variant / registers.length) % prefixes.length];
  const suffix = suffixes[Math.floor(variant / (registers.length * prefixes.length)) % suffixes.length];
  return source.turns.map((turn, turnIndex) => {
    if (turnIndex !== source.turns.length - 1 || turn.speaker !== "customer") return { ...turn };
    const registered = register(turn.text).replace(/[.!?]+$/, "");
    return { ...turn, text: `${prefix}${registered}${suffix}${suffix ? "." : ""}`.replace(/\s+/g, " ").trim() };
  });
}

function sourceCases(): EvaluationCase[] {
  return evaluationCases.filter((item) => item.deterministic || item.expected.lines.length === 0);
}

export function generateSyntheticCorpus(count = 5_000, seed = SYNTHETIC_CORPUS_SEED): SyntheticCase[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Synthetic corpus count must be a positive integer.");
  const sources = sourceCases();
  const generated: SyntheticCase[] = [];
  const seen = new Set<string>();
  let variant = 0;
  while (generated.length < count) {
    const source = sources[(variant + seed) % sources.length];
    const turns = varyTurns(source, variant);
    const fingerprint = turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|");
    if (!seen.has(fingerprint)) {
      const id = `synthetic-${String(generated.length + 1).padStart(5, "0")}`;
      generated.push({
        ...source,
        id,
        turns,
        difficulty: difficultyFor(source),
        language: languageByCategory[source.category] ?? "nl",
        dialect: dialectFor(source, variant),
        speakerRole: new Set(turns.map((turn) => turn.speaker)).size > 1 ? "mixed" : turns[0].speaker,
        sourceCaseId: source.id,
        seed,
        generatorVersion: SYNTHETIC_CORPUS_VERSION,
        split: splitFor(id),
      });
      seen.add(fingerprint);
    }
    variant += 1;
    if (variant > count * sources.length * registers.length * 2) {
      throw new Error(`Could not generate ${count} unique synthetic cases.`);
    }
  }
  return generated;
}

export function validateSyntheticCorpus(cases: SyntheticCase[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  const products = new Map(demoMenu.products.map((product) => [product.id, product]));
  const modifiers = new Map(demoMenu.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, group.id])));
  const validIssues = new Set(["ambiguous_product", "ambiguous_removal", "unresolved_product", "speech_confirmation", "missing_modifier", "course_exception"]);
  const validWarnings = new Set(["allergy_manual_check", "free_text_note", "stale_menu"]);
  for (const item of cases) {
    if (ids.has(item.id)) errors.push(`duplicate id: ${item.id}`);
    ids.add(item.id);
    const fingerprint = item.turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|");
    if (fingerprints.has(fingerprint)) errors.push(`duplicate transcript: ${item.id}`);
    fingerprints.add(fingerprint);
    if (!item.turns.length || item.turns.some((turn) => !turn.text.trim())) errors.push(`empty turn: ${item.id}`);
    for (const line of item.expected.lines) {
      const product = products.get(line.productId);
      if (!product) errors.push(`${item.id}: unknown product ${line.productId}`);
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) errors.push(`${item.id}: invalid quantity`);
      for (const modifierId of line.modifierIds ?? []) {
        if (!modifiers.has(modifierId)) errors.push(`${item.id}: unknown modifier ${modifierId}`);
        else if (!product?.modifierGroupIds.includes(modifiers.get(modifierId)!)) errors.push(`${item.id}: invalid modifier ${modifierId} for ${line.productId}`);
      }
    }
    for (const issue of item.expected.issueTypes ?? []) if (!validIssues.has(issue)) errors.push(`${item.id}: invalid issue ${issue}`);
    for (const warning of item.expected.warningTypes ?? []) if (!validWarnings.has(warning)) errors.push(`${item.id}: invalid warning ${warning}`);
  }
  const splitCounts = new Map<SyntheticSplit, number>();
  for (const item of cases) splitCounts.set(item.split, (splitCounts.get(item.split) ?? 0) + 1);
  if ((splitCounts.get("development") ?? 0) < cases.length * 0.6) errors.push("development split is too small");
  if ((splitCounts.get("validation") ?? 0) < cases.length * 0.1) errors.push("validation split is too small");
  if ((splitCounts.get("test") ?? 0) < cases.length * 0.1) errors.push("test split is too small");
  return errors;
}

export function corpusMetrics(cases: SyntheticCase[], evaluate: (item: SyntheticCase) => EvaluationCase["expected"]): Record<string, number> {
  let passed = 0;
  let negativeCases = 0;
  let negativePassed = 0;
  for (const item of cases) {
    const actual = evaluate(item);
    const expected = JSON.stringify(item.expected);
    if (JSON.stringify(actual) === expected) passed += 1;
    if (!item.expected.lines.length) {
      negativeCases += 1;
      if (!actual.lines.length) negativePassed += 1;
    }
  }
  return {
    cases: cases.length,
    passed,
    strictAccuracy: Number((passed / Math.max(1, cases.length)).toFixed(4)),
    negativeCases,
    negativeAccuracy: Number((negativePassed / Math.max(1, negativeCases)).toFixed(4)),
  };
}
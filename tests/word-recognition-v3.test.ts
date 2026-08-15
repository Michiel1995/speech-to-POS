import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { minimumSimilarityForAlias, phoneticKey, spokenSimilarity } from "@/src/language/phonetics";
import { normalizeFlemish } from "@/src/language/flemish-dialect";
import { routeIntent } from "@/src/order-understanding/intent-router";
import { findProductMentions, rankProductCandidatesForPhrase } from "@/src/semantic-menu/matcher";
import { isOrderableProduct, productSourceAliases } from "@/src/semantic-menu/product-index";
import {
  completedBrowserSpeechText,
  rankSpeechHypotheses,
  safeBrowserSpeechFallback,
  speechHypothesisMargin,
} from "@/src/speech/recognition-ranker";

describe("Service Ears 3 word recognition", () => {
  it.each([
    ["coka cola zero", "POS-1102"],
    ["stela artwa", "POS-1002"],
    ["duiffel", "POS-1001"],
    ["leffe blont", "POS-1003"],
    ["leven bruin", "POS-1004"],
    ["vol au van", "POS-3002"],
    ["garnaal kroketn", "POS-2001"],
    ["sjokolade moes", "POS-5001"],
  ])("ranks noisy product pronunciation %s as %s", (spoken, expectedProductId) => {
    expect(rankProductCandidatesForPhrase(spoken, demoMenu)[0]?.product.id).toBe(expectedProductId);
  });

  it("uses a question category and table context without overriding the sound", () => {
    const result = findProductMentions("Welke bieren lijken op een leffe blont?", demoMenu, {
      preferredProductIds: ["POS-1003"],
      categoryHints: ["beer"],
    });
    expect(result.flatMap((mention) => mention.candidates.map((product) => product.id))).toContain("POS-1003");
    expect(routeIntent("Welke bieren lijken op een leffe blont?", { menu: demoMenu }).intent).toBe("menu_question");
  });

  it("keeps an ordinary story out of the order even if it contains a product homophone", () => {
    expect(routeIntent("Mijn nonkel vertelde een verhaal over het leven blond en gelukkig.", { menu: demoMenu }).intent).toBe("non_order");
  });

  it("ranks five ASR alternatives with acoustic, menu and context evidence", () => {
    const ranked = rankSpeechHypotheses([
      { text: "Ik neem een levende plant", acousticConfidence: 0.82, index: 0 },
      { text: "Ik neem een leven blond", acousticConfidence: 0.76, index: 1 },
      { text: "Ik neem een even blond", acousticConfidence: 0.71, index: 2 },
      { text: "Ik neem alleen blond", acousticConfidence: 0.69, index: 3 },
      { text: "[MUSIC]", acousticConfidence: 0.94, index: 4 },
    ], demoMenu, { preferredProductIds: ["POS-1003"] });
    expect(ranked[0].text).toBe("Ik neem een leven blond");
    expect(ranked[0].productIds).toContain("POS-1003");
    expect(ranked.at(-1)?.text).toBe("[MUSIC]");
    expect(speechHypothesisMargin(ranked)).toBeGreaterThan(0);
  });

  it("keeps the last trustworthy interim words when Edge ends before its final event", () => {
    expect(completedBrowserSpeechText("", "een Duvel en twee Stella")).toBe("een Duvel en twee Stella");
    expect(completedBrowserSpeechText("een Duvel", "een Duvel en twee Stella")).toBe("een Duvel en twee Stella");
    expect(completedBrowserSpeechText("een Duvel", "een bier misschien")).toBe("een Duvel");
  });

  it("allows a menu-grounded Edge fallback but rejects unrelated conversation", () => {
    const orderFallback = safeBrowserSpeechFallback([
      { text: "Doe mij een duiffel en twee stela", acousticConfidence: 0.74 },
    ], demoMenu);
    expect(orderFallback?.productIds).toEqual(expect.arrayContaining(["POS-1001", "POS-1002"]));
    expect(safeBrowserSpeechFallback([
      { text: "Mijn nonkel vertelde een lang verhaal over zijn vakantie.", acousticConfidence: 0.9 },
    ], demoMenu)).toBeUndefined();
  });

  it("normalizes additional Belgian colloquialisms before intent routing", () => {
    expect(normalizeFlemish("Kannek nog ene krijgen en zet da derbij?", "auto")).toContain("kan ik nog eentje krijgen en zet dat erbij");
    expect(routeIntent("Kannek nog ene Duvel krijgen en zet da derbij?", { menu: demoMenu, hasOrder: true }).intent).toBe("addition");
  });

  it("repairs an ASR-joined Flemish side dish phrase", () => {
    expect(normalizeFlemish("Ikneemene steak metfriaten en pepper sauce", "auto"))
      .toContain("steak met frieten en pepersaus");
  });

  it("executes a 1,000-case phonetic mutation regression bank", () => {
    const mutations: Array<(value: string) => string> = [
      (value) => value,
      (value) => value.replace(/v/g, "f"),
      (value) => value.replace(/f/g, "v"),
      (value) => value.replace(/b/g, "p"),
      (value) => value.replace(/p/g, "b"),
      (value) => value.replace(/d\b/g, "t"),
      (value) => value.replace(/z/g, "s"),
      (value) => value.replace(/c/g, "k"),
      (value) => value.replace(/qu/g, "k"),
      (value) => value.replace(/ij/g, "ei"),
      (value) => value.replace(/ou/g, "au"),
      (value) => value.replace(/au/g, "ou"),
      (value) => value.replace(/ch/g, "g"),
      (value) => value.replace(/g/g, "ch"),
      (value) => value.replace(/n\b/g, ""),
      (value) => value.replace(/e\b/g, ""),
      (value) => value.replace(/([a-z])\1/g, "$1"),
      (value) => value.replace(/\s+/g, ""),
      (value) => value.replace(/o/g, "oo"),
      (value) => value.replace(/e/g, "ee"),
      (value) => value.replace(/a/g, "aa"),
      (value) => value.replace(/t/g, "d"),
      (value) => value.replace(/k/g, "c"),
      (value) => value.replace(/w/g, "v"),
      (value) => value.replace(/ie/g, "i"),
    ];
    const aliases = demoMenu.products
      .filter(isOrderableProduct)
      .flatMap(productSourceAliases)
      .map((alias) => alias.toLocaleLowerCase("nl-BE"))
      .filter((alias) => alias.replace(/[^a-z]/g, "").length >= 4);
    const cases = aliases.flatMap((alias) => mutations.map((mutate) => ({ alias, spoken: mutate(alias) }))).slice(0, 1_000);
    expect(cases).toHaveLength(1_000);
    const recognized = cases.filter(({ alias, spoken }) => {
      const similarity = spokenSimilarity(spoken, alias).score;
      return similarity >= Math.max(0.68, minimumSimilarityForAlias(alias) - 0.08) || phoneticKey(spoken) === phoneticKey(alias);
    });
    expect(recognized.length / cases.length).toBeGreaterThanOrEqual(0.86);
  });
});

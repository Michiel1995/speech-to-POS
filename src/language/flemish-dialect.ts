export const DIALECT_PROFILES = ["auto", "standard", "west_flemish", "east_flemish", "antwerp", "brabant", "limburg"] as const;
export type DialectProfile = (typeof DIALECT_PROFILES)[number];

const COMMON_PHRASES: Array<[RegExp, string]> = [
  [/\bawel\b/g, "wel"],
  [/\bnog\s+ene\b/g, "nog eentje"],
  [/\bwa(?:t)?\b/g, "wat"],
  [/\bwadde\b/g, "wat"],
  [/\bhedde\b/g, "heb je"],
  [/\bhebde\b/g, "heb je"],
  [/\bhebt\s+ge\b/g, "heb je"],
  [/\bkunde\b/g, "kan je"],
  [/\bkun(?:de|det)\s+gij\b/g, "kan jij"],
  [/\bkunne\b/g, "kunnen"],
  [/\bgade\b/g, "ga je"],
  [/\bwilde\b/g, "wil je"],
  [/\bwilt\s+gij\b/g, "wil jij"],
  [/\bzijde\b/g, "ben je"],
  [/\bzoude\b/g, "zou je"],
  [/\bmoete\b/g, "moeten"],
  [/\bnen\b/g, "een"],
  [/\bgene\b/g, "geen"],
  [/\bgennen\b/g, "geen"],
  [/\bene\b/g, "een"],
  [/\bne\b/g, "een"],
  [/\bder\b/g, "er"],
  [/\bdrbij\b/g, "erbij"],
  [/\bderbij\b/g, "erbij"],
  [/\bda\b/g, "dat"],
  [/\bdieje\b/g, "die"],
  [/\bdees\b/g, "deze"],
  [/\bgeef?\s+is\b/g, "geef eens"],
  [/\bdoe\s+is\b/g, "doe eens"],
  [/\bpak\s+is\b/g, "pak eens"],
  [/\bzeg\s+is\b/g, "zeg eens"],
  [/\blaat\s+maar\s+steek(?:en)?\b/g, "laat maar zitten"],
  [/\blaat\s+da\s+maar\s+steek(?:en)?\b/g, "laat dat maar zitten"],
  [/\bnie\b/g, "niet"],
  [/\bniemeer\b/g, "niet meer"],
  [/\btochni\b/g, "toch niet"],
  [/\bniks\b/g, "niets"],
  [/\bgoesting\b/g, "zin"],
  [/\bkhem\b/g, "ik heb"],
  [/\bkheb\b/g, "ik heb"],
  [/\'k\s*heb\b/g, "ik heb"],
  [/\bkzal\b/g, "ik zal"],
  [/\'k\s*zal\b/g, "ik zal"],
  [/\bkzen\b/g, "ik ben"],
  [/\bkem\b/g, "ik heb"],
  [/\bmoek\b/g, "moet ik"],
  [/\bkannek\b/g, "kan ik"],
  [/\bmaggek\b/g, "mag ik"],
  [/\bpaktem\b/g, "pak hem"],
  [/\bdoetem\b/g, "doe hem"],
  [/\bgeeftem\b/g, "geef hem"],
  [/\bdoe\s+mij\s+ook\s+zo\s+ene\b/g, "doe mij ook dezelfde"],
  [/\bnog\s+ene\b/g, "nog eentje"],
  [/\bzo\s+ene\b/g, "zo eentje"],
  [/\bzet\s+da\s+derbij\b/g, "zet dat erbij"],
  [/\bschrijf\s+da\s+maar\s+op\b/g, "schrijf dat maar op"],
  [/\bpilske\b/g, "pintje"],
  [/\bpinske\b/g, "pintje"],
  [/\bpintjen\b/g, "pintje"],
  [/\bpint(?:en|jes)?\b/g, "pintje"],
  [/\bmet(?:fria?ten|frieten|frietn)\b/g, "met frieten"],
  [/\b(?:friaten|frieten|frietn)\b/g, "frieten"],
  [/\bpatatjes\b/g, "frieten"],
  [/\bkroketn\b/g, "kroketten"],
  [/\bgarnaalkroketn\b/g, "garnaalkroketten"],
  [/\b(?:tui|twie|twi)\b/g, "twee"],
  [/\b(?:frieden|friden|friede)\b/g, "frieten"],
  [/\b(?:peppersas|pepersas|peppersaus|peppersauce|pepper sauce)\b/g, "pepersaus"],
  [/\bzonder\s+ies\b/g, "zonder ijs"],
  [/\bmee\s+ies\b/g, "met ijs"],
];

const PROFILE_PHRASES: Record<Exclude<DialectProfile, "auto" | "standard">, Array<[RegExp, string]>> = {
  west_flemish: [
    [/\boeveel\b/g, "hoeveel"],
    [/\bwuk\b/g, "wat"],
    [/\bgie\b/g, "jij"],
    [/\bjoen\b/g, "jouw"],
    [/\bkzie\b/g, "ik zie"],
    [/\bkpeinze\b/g, "ik denk"],
    [/\bmoej\b/g, "moet je"],
    [/\bkuj\b/g, "kan je"],
    [/\bneje\b/g, "nee"],
  ],
  east_flemish: [
    [/\bwatte\b/g, "wat"],
    [/\bgijle\b/g, "jullie"],
    [/\bnenen\b/g, "een"],
    [/\baffe\b/g, "af"],
    [/\bzuuk\b/g, "zoek"],
    [/\bgeire\b/g, "graag"],
    [/\bkeun\b/g, "kan"],
  ],
  antwerp: [
    [/\baant\b/g, "aan het"],
    [/\bwaarda\b/g, "waar dat"],
    [/\bzen\b/g, "zijn"],
    [/\bsmoske\b/g, "smos"],
    [/\bgaarne\b/g, "graag"],
    [/\bwa\s+hemme\b/g, "wat hebben"],
    [/\bdoe\s+ma\b/g, "doe maar"],
  ],
  brabant: [
    [/\bdoede\b/g, "doe je"],
    [/\bwetekik\b/g, "weet ik"],
    [/\bpakskes\b/g, "pakjes"],
    [/\ballei\b/g, "allee"],
    [/\bgeren\b/g, "graag"],
    [/\bwa\s+hebde\b/g, "wat heb je"],
    [/\bpak\s+maar\b/g, "neem maar"],
  ],
  limburg: [
    [/\bich\b/g, "ik"],
    [/\bdich\b/g, "jou"],
    [/\bwaat\b/g, "wat"],
    [/\bneet\b/g, "niet"],
    [/\bwaat\s+hub\s+se\b/g, "wat heb je"],
    [/\bnog\s+ein\b/g, "nog eentje"],
    [/\bgeer\b/g, "graag"],
  ],
};

function basicNormalize(value: string): string {
  return value
    .toLocaleLowerCase("nl-BE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[-–—/]/g, " ")
    .replace(/[^a-z0-9\s'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeFlemish(value: string, profile: DialectProfile = "auto"): string {
  let normalized = basicNormalize(value);
  const replacements = [
    ...(profile === "auto"
      ? Object.values(PROFILE_PHRASES).flat()
      : profile === "standard"
        ? []
        : PROFILE_PHRASES[profile]),
    ...COMMON_PHRASES,
  ];
  for (const [pattern, replacement] of replacements) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/\s+/g, " ").trim();
}

export function detectDialectProfile(value: string): DialectProfile {
  const normalized = basicNormalize(value);
  const scores = Object.entries(PROFILE_PHRASES).map(([profile, mappings]) => ({
    profile: profile as DialectProfile,
    score: mappings.filter(([pattern]) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(normalized)).length,
  }));
  const best = scores.sort((left, right) => right.score - left.score)[0];
  return best && best.score > 0 ? best.profile : "standard";
}

export function dialectPromptHints(profile: DialectProfile): string[] {
  const effective = profile === "auto" ? "Vlaams (automatische regiovarianten)" : profile.replaceAll("_", " ");
  return [
    `Dialectprofiel: ${effective}.`,
    "Verwacht Vlaamse spreektaal zoals ne/nen, hedde, kunde, wa, nie, pintje, patatjes en ingeslikte eindklanken.",
    "Behoud productnamen; normaliseer alleen gesprekstaal rond het product.",
  ];
}

import type { MenuProduct, TenantMenu } from "@/src/domain/schemas";
import { normalizeFlemish } from "@/src/language/flemish-dialect";
import { spokenSimilarity } from "@/src/language/phonetics";
import { isOrderableProduct, productSourceAliases } from "@/src/semantic-menu/product-index";

export interface CulinaryConcept {
  id: string;
  family: string;
  names: { nl: string; en: string; fr: string };
  tags: string[];
  aliases: string[];
}

export interface CulinaryMention {
  concept: CulinaryConcept;
  alias: string;
  confidence: number;
  start: number;
  end: number;
}

export interface CulinaryAdvice {
  requested: CulinaryConcept;
  alternatives: MenuProduct[];
  message: string;
}

// This compact, reviewable seed document is expanded deterministically into thousands
// of multilingual and ASR-tolerant recognition forms. It is deliberately separate
// from the POS menu: knowing a dish must never make it orderable.
const CULINARY_SEED_DOCUMENT = `
cod~fish~kabeljauw~cod~cabillaud~fish,main,white-fish
plaice~fish~pladijs~plaice~plie~fish,main,flatfish
sole~fish~tong~sole~sole meuniere~fish,main,flatfish
salmon~fish~zalm~salmon~saumon~fish,main,oily-fish
trout~fish~forel~trout~truite~fish,main,oily-fish
sea-bass~fish~zeebaars~sea bass~bar commun~fish,main,white-fish
tuna~fish~tonijn~tuna~thon~fish,main,oily-fish
haddock~fish~schelvis~haddock~eglefin~fish,main,white-fish
halibut~fish~heilbot~halibut~fletan~fish,main,flatfish
hake~fish~heek~hake~merlu~fish,main,white-fish
mackerel~fish~makreel~mackerel~maquereau~fish,main,oily-fish
herring~fish~haring~herring~hareng~fish,starter,oily-fish
sardine~fish~sardine~sardine~sardine~fish,starter,oily-fish
anchovy~fish~ansjovis~anchovy~anchois~fish,starter,oily-fish
eel~fish~paling~eel~anguille~fish,main,oily-fish
turbot~fish~tarbot~turbot~turbot~fish,main,flatfish
monkfish~fish~zeeduivel~monkfish~lotte~fish,main,white-fish
swordfish~fish~zwaardvis~swordfish~espadon~fish,main
fish-stew~fish~visstoofpot~fish stew~marmite de poisson~fish,main,stew
fish-and-chips~fish~fish and chips~fish and chips~poisson frit frites~fish,main,fried
shrimp~seafood~garnaal~shrimp~crevette~seafood,starter,crustacean
prawn~seafood~gamba~prawn~gambas~seafood,main,crustacean
scampi~seafood~scampi~scampi~scampis~seafood,main,crustacean
mussels~seafood~mosselen~mussels~moules~seafood,main,mollusc
oyster~seafood~oester~oyster~huitre~seafood,starter,mollusc
scallop~seafood~sint jakobsvrucht~scallop~coquille saint jacques~seafood,starter,mollusc
crab~seafood~krab~crab~crabe~seafood,starter,crustacean
lobster~seafood~kreeft~lobster~homard~seafood,main,crustacean
calamari~seafood~inktvis~calamari~calamar~seafood,starter,mollusc
octopus~seafood~octopus~octopus~poulpe~seafood,starter,mollusc
clams~seafood~venusschelpen~clams~palourdes~seafood,starter,mollusc
beef-steak~meat~biefstuk~beef steak~steak de boeuf~meat,main,beef
ribeye~meat~ribeye~ribeye steak~entrecote~meat,main,beef
sirloin~meat~lendensteak~sirloin steak~faux filet~meat,main,beef
filet-mignon~meat~ossenhaas~filet mignon~filet de boeuf~meat,main,beef
beef-stew~meat~runderstoofpot~beef stew~boeuf bourguignon~meat,main,beef,stew
beef-tartare~meat~steak tartaar~beef tartare~steak tartare~meat,starter,beef,raw
carpaccio~meat~carpaccio~beef carpaccio~carpaccio de boeuf~meat,starter,beef,raw
meatballs~meat~gehaktballen~meatballs~boulettes~meat,main
hamburger~meat~hamburger~hamburger~hamburger~meat,main,beef
cheeseburger~meat~cheeseburger~cheeseburger~burger au fromage~meat,main,beef
pork-chop~meat~varkenskotelet~pork chop~cote de porc~meat,main,pork
pork-belly~meat~buikspek~pork belly~poitrine de porc~meat,main,pork
spare-ribs~meat~spareribs~spare ribs~travers de porc~meat,main,pork
ham~meat~ham~ham~jambon~meat,starter,pork
sausage~meat~worst~sausage~saucisse~meat,main,pork
lamb-chop~meat~lamskotelet~lamb chop~cotelette agneau~meat,main,lamb
lamb-shank~meat~lamsschenkel~lamb shank~souris agneau~meat,main,lamb
rabbit~meat~konijn~rabbit~lapin~meat,main,game
venison~meat~hert~venison~cerf~meat,main,game
wild-boar~meat~everzwijn~wild boar~sanglier~meat,main,game
duck-breast~poultry~eendenborst~duck breast~magret de canard~poultry,main,duck
duck-confit~poultry~gekonfijte eend~duck confit~confit de canard~poultry,main,duck
roast-chicken~poultry~gebraden kip~roast chicken~poulet roti~poultry,main,chicken
chicken-breast~poultry~kipfilet~chicken breast~filet de poulet~poultry,main,chicken
chicken-curry~poultry~kipcurry~chicken curry~curry de poulet~poultry,main,chicken,curry
turkey~poultry~kalkoen~turkey~dinde~poultry,main
vol-au-vent~poultry~vol au vent~vol au vent~vol au vent~poultry,main,chicken,stew
caesar-salad~salad~caesarsalade~caesar salad~salade cesar~vegetarian,main,salad
goat-cheese-salad~salad~geitenkaassalade~goat cheese salad~salade de chevre~vegetarian,main,salad
greek-salad~salad~griekse salade~greek salad~salade grecque~vegetarian,main,salad
tomato-mozzarella~salad~tomaat mozzarella~tomato mozzarella~tomate mozzarella~vegetarian,starter,salad
falafel~vegetarian~falafel~falafel~falafel~vegetarian,main,legume
hummus~vegetarian~hummus~hummus~houmous~vegetarian,starter,legume
vegetable-curry~vegetarian~groentecurry~vegetable curry~curry de legumes~vegetarian,main,curry
vegetable-stew~vegetarian~groentestoofpot~vegetable stew~ragout de legumes~vegetarian,main,stew
stuffed-pepper~vegetarian~gevulde paprika~stuffed pepper~poivron farci~vegetarian,main
mushroom-risotto~rice~champignonrisotto~mushroom risotto~risotto aux champignons~vegetarian,main,rice
seafood-risotto~rice~zeevruchtenrisotto~seafood risotto~risotto aux fruits de mer~seafood,main,rice
paella~rice~paella~paella~paella~rice,main
fried-rice~rice~gebakken rijst~fried rice~riz saute~rice,main
spaghetti-bolognese~pasta~spaghetti bolognese~spaghetti bolognese~spaghetti bolognaise~pasta,main,meat
spaghetti-carbonara~pasta~spaghetti carbonara~spaghetti carbonara~spaghetti carbonara~pasta,main,meat
lasagna~pasta~lasagne~lasagna~lasagnes~pasta,main
ravioli~pasta~ravioli~ravioli~raviolis~pasta,main
tagliatelle~pasta~tagliatelle~tagliatelle~tagliatelles~pasta,main
penne-arrabbiata~pasta~penne arrabbiata~penne arrabbiata~penne arrabbiata~pasta,main,vegetarian
pesto-pasta~pasta~pasta pesto~pesto pasta~pates au pesto~pasta,main,vegetarian
truffle-pasta~pasta~truffelpasta~truffle pasta~pates a la truffe~pasta,main,vegetarian
mac-and-cheese~pasta~macaroni met kaas~mac and cheese~macaroni au fromage~pasta,main,vegetarian
margherita-pizza~pizza~pizza margherita~margherita pizza~pizza margherita~pizza,main,vegetarian
pepperoni-pizza~pizza~pepperonipizza~pepperoni pizza~pizza pepperoni~pizza,main,meat
four-cheese-pizza~pizza~vierkazenpizza~four cheese pizza~pizza quatre fromages~pizza,main,vegetarian
tomato-soup~soup~tomatensoep~tomato soup~soupe tomate~vegetarian,starter,soup
onion-soup~soup~uiensoep~onion soup~soupe oignon~vegetarian,starter,soup
pumpkin-soup~soup~pompoensoep~pumpkin soup~soupe de potiron~vegetarian,starter,soup
chicken-soup~soup~kippensoep~chicken soup~soupe de poulet~poultry,starter,soup
fish-soup~soup~vissoep~fish soup~soupe de poisson~fish,starter,soup
minestrone~soup~minestrone~minestrone~minestrone~vegetarian,starter,soup
croque-monsieur~snack~croque monsieur~croque monsieur~croque monsieur~meat,main,snack
cheese-croquettes~starter~kaaskroketten~cheese croquettes~croquettes au fromage~vegetarian,starter,fried
shrimp-croquettes~starter~garnaalkroketten~shrimp croquettes~croquettes aux crevettes~seafood,starter,fried
spring-rolls~starter~loempias~spring rolls~nems~starter,fried
bruschetta~starter~bruschetta~bruschetta~bruschetta~vegetarian,starter
garlic-bread~starter~lookbrood~garlic bread~pain ail~vegetarian,starter
fries~side~frieten~fries~frites~vegetarian,side,fried
croquettes~side~kroketten~croquettes~croquettes~vegetarian,side,fried
mashed-potatoes~side~aardappelpuree~mashed potatoes~puree de pommes de terre~vegetarian,side
baked-potato~side~gepofte aardappel~baked potato~pomme de terre au four~vegetarian,side
rice~side~rijst~rice~riz~vegetarian,side
salad~side~salade~salad~salade~vegetarian,side
grilled-vegetables~side~gegrilde groenten~grilled vegetables~legumes grilles~vegetarian,side
pepper-sauce~sauce~pepersaus~pepper sauce~sauce au poivre~sauce
mushroom-sauce~sauce~champignonsaus~mushroom sauce~sauce champignons~sauce
bearnaise~sauce~bearnaise~bearnaise~bearnaise~sauce
mayonnaise~sauce~mayonaise~mayonnaise~mayonnaise~sauce
ketchup~sauce~ketchup~ketchup~ketchup~sauce
apple-pie~dessert~appeltaart~apple pie~tarte aux pommes~dessert,sweet
chocolate-cake~dessert~chocoladetaart~chocolate cake~gateau au chocolat~dessert,sweet
cheesecake~dessert~cheesecake~cheesecake~gateau au fromage~dessert,sweet
tiramisu~dessert~tiramisu~tiramisu~tiramisu~dessert,sweet
creme-brulee~dessert~creme brulee~creme brulee~creme brulee~dessert,sweet
chocolate-mousse~dessert~chocolademousse~chocolate mousse~mousse au chocolat~dessert,sweet
ice-cream~dessert~ijs~ice cream~glace~dessert,sweet
vanilla-ice-cream~dessert~vanille ijs~vanilla ice cream~glace vanille~dessert,sweet
chocolate-ice-cream~dessert~chocolade ijs~chocolate ice cream~glace chocolat~dessert,sweet
sorbet~dessert~sorbet~sorbet~sorbet~dessert,sweet
panna-cotta~dessert~panna cotta~panna cotta~panna cotta~dessert,sweet
waffle~dessert~wafel~waffle~gaufre~dessert,sweet
pancakes~dessert~pannenkoeken~pancakes~crepes~dessert,sweet
rice-pudding~dessert~rijstpap~rice pudding~riz au lait~dessert,sweet
profiteroles~dessert~profiteroles~profiteroles~profiteroles~dessert,sweet
lemon-tart~dessert~citroentaart~lemon tart~tarte au citron~dessert,sweet
fruit-salad~dessert~fruitsalade~fruit salad~salade de fruits~dessert,sweet
coffee~drink~koffie~coffee~cafe~drink,hot
espresso~drink~espresso~espresso~espresso~drink,hot
cappuccino~drink~cappuccino~cappuccino~cappuccino~drink,hot
latte~drink~latte macchiato~latte~cafe latte~drink,hot
tea~drink~thee~tea~the~drink,hot
hot-chocolate~drink~warme chocolademelk~hot chocolate~chocolat chaud~drink,hot
still-water~drink~plat water~still water~eau plate~drink,cold
sparkling-water~drink~bruiswater~sparkling water~eau petillante~drink,cold
lemonade~drink~limonade~lemonade~limonade~drink,cold
orange-juice~drink~sinaasappelsap~orange juice~jus orange~drink,cold
apple-juice~drink~appelsap~apple juice~jus de pomme~drink,cold
cola~drink~cola~cola~cola~drink,cold
beer~drink~bier~beer~biere~drink,alcohol
white-wine~drink~witte wijn~white wine~vin blanc~drink,alcohol
red-wine~drink~rode wijn~red wine~vin rouge~drink,alcohol
rose-wine~drink~rose wijn~rose wine~vin rose~drink,alcohol
champagne~drink~champagne~champagne~champagne~drink,alcohol
gin-tonic~drink~gin tonic~gin and tonic~gin tonic~drink,alcohol
mojito~drink~mojito~mojito~mojito~drink,alcohol
aperol-spritz~drink~aperol spritz~aperol spritz~aperol spritz~drink,alcohol
`.trim();

function normalize(value: string): string {
  return normalizeFlemish(value, "auto")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speechVariants(value: string): string[] {
  const base = normalize(value);
  if (!base) return [];
  return [...new Set([
    base,
    base.replace(/\s+/g, ""),
    base.replace(/ij/g, "ei"),
    base.replace(/ou/g, "au"),
    base.replace(/c/g, "k"),
    base.replace(/ph/g, "f"),
    base.replace(/v/g, "f"),
    base.replace(/z/g, "s"),
    base.replace(/ch/g, "sj"),
    base.replace(/en\b/g, "e"),
    base.replace(/h/g, ""),
    base.replace(/r(?=[^aeiou]|$)/g, ""),
    base.replace(/t\b/g, "d"),
    base.replace(/s\b/g, "z"),
    base.replace(/([aeiou])\1/g, "$1"),
    base.replace(/([aeiou])/g, "$1$1"),
    base.replace(/\b(?:de|du|la|le)\s+/g, ""),
  ])].filter((item) => item.length >= 3);
}

function parseConcept(row: string): CulinaryConcept {
  const [id, family, nl, en, fr, tags] = row.split("~");
  const names = { nl, en, fr };
  return {
    id,
    family,
    names,
    tags: [...new Set([family, ...(tags?.split(",") ?? [])])],
    aliases: [...new Set(Object.values(names).flatMap(speechVariants))],
  };
}

export const CULINARY_CONCEPTS: CulinaryConcept[] = CULINARY_SEED_DOCUMENT
  .split(/\r?\n/)
  .map((row) => row.trim())
  .filter(Boolean)
  .map(parseConcept);

const REQUEST_TEMPLATES = [
  "ik neem {item}",
  "voor mij {item}",
  "mag ik {item}",
  "i would like {item}",
  "can i have {item}",
  "je prends {item}",
  "pour moi {item}",
  "hebben jullie {item}",
];

export const CULINARY_SPEECH_FORMS = CULINARY_CONCEPTS.flatMap((concept) =>
  Object.entries(concept.names).flatMap(([language, name]) => REQUEST_TEMPLATES.map((template) => ({
    conceptId: concept.id,
    language,
    text: template.replace("{item}", name),
  }))),
);

export const culinaryKnowledgeStats = {
  concepts: CULINARY_CONCEPTS.length,
  acousticAliases: CULINARY_CONCEPTS.reduce((sum, concept) => sum + concept.aliases.length, 0),
  speechForms: CULINARY_SPEECH_FORMS.length,
};

export function culinaryPromptPhrases(maximum = 72): string[] {
  const count = Math.max(0, Math.min(maximum, CULINARY_CONCEPTS.length));
  return Array.from({ length: count }, (_, index) => {
    const concept = CULINARY_CONCEPTS[Math.floor(index * CULINARY_CONCEPTS.length / Math.max(1, count))];
    return [concept.names.nl, concept.names.en, concept.names.fr][index % 3];
  });
}

function boundary(text: string, index: number): boolean {
  return index < 0 || index >= text.length || text[index] === " ";
}

export function recognizeCulinaryConcepts(value: string): CulinaryMention[] {
  const text = normalize(value);
  if (!text) return [];
  const mentions: CulinaryMention[] = [];
  for (const concept of CULINARY_CONCEPTS) {
    let best: CulinaryMention | undefined;
    for (const alias of concept.aliases) {
      const start = text.indexOf(alias);
      if (start < 0 || !boundary(text, start - 1) || !boundary(text, start + alias.length)) continue;
      const candidate = { concept, alias, confidence: 1, start, end: start + alias.length };
      if (!best || alias.length > best.alias.length) best = candidate;
    }
    if (best) mentions.push(best);
  }
  if (mentions.length) {
    return mentions
      .sort((left, right) => left.start - right.start || right.alias.length - left.alias.length)
      .filter((mention, index, values) => !values.some((other, otherIndex) => otherIndex < index && other.start <= mention.start && other.end >= mention.end));
  }

  const tokens = text.split(" ");
  const spans = tokens.flatMap((_, start) => [1, 2, 3, 4]
    .map((size) => tokens.slice(start, start + size).join(" "))
    .filter((span) => span.length >= 4));
  let fuzzyBest: CulinaryMention | undefined;
  for (const concept of CULINARY_CONCEPTS) {
    for (const alias of Object.values(concept.names).map(normalize)) {
      for (const span of spans) {
        const confidence = spokenSimilarity(span, alias).score;
        if (confidence < 0.88 || (fuzzyBest && confidence <= fuzzyBest.confidence)) continue;
        const start = text.indexOf(span);
        fuzzyBest = { concept, alias: span, confidence, start, end: start + span.length };
      }
    }
  }
  return fuzzyBest ? [fuzzyBest] : [];
}

function productKnowledgeText(product: MenuProduct): string {
  return normalize(productSourceAliases(product).join(" "));
}

function productTags(product: MenuProduct): Set<string> {
  const text = productKnowledgeText(product);
  const tags = new Set<string>([product.defaultCourse, product.category.toLowerCase()]);
  if (product.allergenCodes.includes("fish") || /\bfish|vis|zalm|pladijs|tong|forel\b/.test(text)) tags.add("fish");
  if (product.allergenCodes.includes("crustaceans") || /garnaal|shrimp|kreeft|scampi/.test(text)) tags.add("seafood");
  if (/steak|beef|rund|varken|lam|meat/.test(text)) tags.add("meat");
  if (/kip|chicken|eend|duck|vol au vent/.test(text)) tags.add("poultry");
  if (/veget|salad|salade|groente/.test(text)) tags.add("vegetarian");
  if (/dessert|mousse|taart|ijs|cake/.test(text)) tags.add("dessert");
  if (product.defaultCourse === "drinks") tags.add("drink");
  return tags;
}

function conceptAlreadyOnMenu(concept: CulinaryConcept, menu: TenantMenu): boolean {
  return menu.products.filter(isOrderableProduct).some((product) => {
    const productText = productKnowledgeText(product);
    return Object.values(concept.names).map(normalize).some((name) =>
      productText.includes(name) || spokenSimilarity(name, normalize(product.canonicalName)).score >= 0.94,
    );
  });
}

export function suggestMenuAlternatives(concept: CulinaryConcept, menu: TenantMenu): MenuProduct[] {
  return menu.products
    .filter(isOrderableProduct)
    .map((product) => {
      const tags = productTags(product);
      const overlap = concept.tags.filter((tag) => tags.has(tag)).length;
      const sameCourse = concept.tags.includes(product.defaultCourse) ? 1 : 0;
      const sameFamily = tags.has(concept.family) ? 1 : 0;
      return { product, score: overlap * 3 + sameFamily * 5 + sameCourse };
    })
    // A generic course match (for example "main") is not a meaningful
    // alternative by itself: it made fries appear next to fish suggestions.
    // Require either a culinary-family match or at least two semantic tags.
    .filter((candidate) => {
      const tags = productTags(candidate.product);
      const overlap = concept.tags.filter((tag) => tags.has(tag)).length;
      return tags.has(concept.family) || overlap >= 2;
    })
    .sort((left, right) => right.score - left.score || left.product.priceCents - right.product.priceCents)
    .slice(0, 3)
    .map((candidate) => candidate.product);
}

function spokenProductLabel(product: MenuProduct): string {
  return product.seasonLabel ? `${product.canonicalName} (${product.seasonLabel})` : product.canonicalName;
}

const REQUEST_CUE = /\b(?:neem|wil|graag|geef|doe|breng|bestel|hebben jullie|heb je|is er|i want|i would like|can i have|do you have|je prends|je voudrais|avez vous|pour moi)\b/;

export function culinaryAdviceForText(value: string, menu: TenantMenu): CulinaryAdvice | undefined {
  const normalized = normalize(value);
  if (!REQUEST_CUE.test(normalized)) return undefined;
  const mention = recognizeCulinaryConcepts(normalized)[0];
  if (!mention || conceptAlreadyOnMenu(mention.concept, menu)) return undefined;
  const alternatives = suggestMenuAlternatives(mention.concept, menu);
  const requestedName = mention.concept.names.nl;
  const alternativeText = alternatives.length
    ? alternatives.map(spokenProductLabel).join(" of ")
    : "geen rechtstreeks alternatief op de actieve kaart";
  return {
    requested: mention.concept,
    alternatives,
    message: `De gast vroeg om ${requestedName}, maar dat staat niet als actief product in het POS-menu. Richtlijn voor de ober: “${requestedName[0].toUpperCase()}${requestedName.slice(1)} hebben we niet. We hebben wel ${alternativeText}.” Voeg niets automatisch toe; laat de gast eerst kiezen.`,
  };
}

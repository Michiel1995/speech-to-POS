import { TenantMenuSchema, type ModifierGroup, type TenantMenu } from "@/src/domain/schemas";

const cuisson: ModifierGroup = {
  id: "MG-CUISSON",
  name: "Cooking",
  required: true,
  min: 1,
  max: 1,
  options: [
    { id: "MOD-SAIGN", posName: "SAIGN", canonicalName: "Saignant", aliases: ["saignant", "rare", "bleu"], priceCents: 0 },
    { id: "MOD-MRARE", posName: "MED R", canonicalName: "Medium rare", aliases: ["medium rare", "medium-rare"], priceCents: 0 },
    { id: "MOD-APOINT", posName: "A POINT", canonicalName: "À point", aliases: ["à point", "a point", "medium"], priceCents: 0 },
    { id: "MOD-WELL", posName: "BIEN CUIT", canonicalName: "Bien cuit", aliases: ["bien cuit", "well done", "doorbakken"], priceCents: 0 },
  ],
};

const side: ModifierGroup = {
  id: "MG-SIDE",
  name: "Side",
  required: true,
  min: 1,
  max: 1,
  options: [
    { id: "MOD-FRIES", posName: "FRIES", canonicalName: "Fries", aliases: ["frieten", "frietjes", "fries", "frites"], priceCents: 0 },
    { id: "MOD-CROQ", posName: "KROK", canonicalName: "Croquettes", aliases: ["kroketten", "croquettes", "croquetten"], priceCents: 100 },
    { id: "MOD-SALAD", posName: "SLA", canonicalName: "Salad", aliases: ["salade", "sla", "salad"], priceCents: 0 },
  ],
};

const sauce: ModifierGroup = {
  id: "MG-SAUCE",
  name: "Sauce",
  required: false,
  min: 0,
  max: 1,
  options: [
    { id: "MOD-PEPPER", posName: "PEPER", canonicalName: "Pepper sauce", aliases: ["pepersaus", "peppersaus", "peppersauce", "pepper sauce", "poivre"], priceCents: 350 },
    { id: "MOD-BEARN", posName: "BEARN", canonicalName: "Béarnaise", aliases: ["béarnaise", "bearnaise", "béarnaisesaus"], priceCents: 350 },
    { id: "MOD-MUSH", posName: "CHAMP", canonicalName: "Mushroom sauce", aliases: ["champignonsaus", "mushroom sauce"], priceCents: 350 },
  ],
};

const coffee: ModifierGroup = {
  id: "MG-COFFEE",
  name: "Coffee extras",
  required: false,
  min: 0,
  max: 2,
  options: [
    { id: "MOD-MILK", posName: "MELK", canonicalName: "Milk", aliases: ["melk", "milk", "lait"], priceCents: 0 },
    { id: "MOD-OAT", posName: "HAVER", canonicalName: "Oat milk", aliases: ["havermelk", "oat milk", "lait d'avoine"], priceCents: 50 },
    { id: "MOD-DECAF", posName: "DECA", canonicalName: "Decaf", aliases: ["decaf", "deca", "décaféiné"], priceCents: 0 },
  ],
};

const menu: TenantMenu = {
  tenantId: "tenant-demo-brussels",
  restaurantName: "Brasserie De Spraakwaterval",
  version: "mock-2026-08-10.1",
  currency: "EUR",
  modifierGroups: [cuisson, side, sauce, coffee],
  tables: Array.from({ length: 20 }, (_, index) => ({
    id: `TABLE-${index + 1}`,
    label: `Table ${index + 1}`,
    number: index + 1,
    active: true,
  })),
  products: [
    { id: "POS-1001", sku: "DUVEL-33", posName: "DUVEL 33", canonicalName: "Duvel", category: "Beer", defaultCourse: "drinks", priceCents: 520, active: true, aliases: ["duvel", "een duvel", "duivel", "duivels", "duvel bier"], modifierGroupIds: [], allergenCodes: ["gluten"] },
    { id: "POS-1002", sku: "STEL-25", posName: "STEL 25", canonicalName: "Stella Artois", category: "Beer", defaultCourse: "drinks", priceCents: 340, active: true, aliases: ["stella", "stelle", "stella arto", "stella artwa", "stellas", "stella artois", "pintje", "pinte", "pint", "pils", "pilsje"], modifierGroupIds: [], allergenCodes: ["gluten"] },
    { id: "POS-1003", sku: "LEFFE-BL", posName: "LEFFE BL 33", canonicalName: "Leffe Blond", category: "Beer", defaultCourse: "drinks", priceCents: 480, active: true, aliases: ["leffe blond", "blonde leffe", "leven blond", "blonde leven", "leffe", "leven"], modifierGroupIds: [], allergenCodes: ["gluten"] },
    { id: "POS-1004", sku: "LEFFE-BR", posName: "LEFFE BR 33", canonicalName: "Leffe Bruin", category: "Beer", defaultCourse: "drinks", priceCents: 480, active: true, aliases: ["leffe bruin", "leffe brown", "leven bruin", "bruine leven", "leffe", "leven"], modifierGroupIds: [], allergenCodes: ["gluten"] },
    { id: "POS-1005", sku: "LEFFE-00", posName: "LEFFE 0.0", canonicalName: "Leffe 0.0", category: "Alcohol-free beer", defaultCourse: "drinks", priceCents: 430, active: true, aliases: ["leffe 0.0", "leffe zero", "leven zero", "alcoholvrije leffe", "alcoholvrije leven", "leffe sans alcool", "leffe", "leven"], modifierGroupIds: [], allergenCodes: ["gluten"] },
    { id: "POS-1101", sku: "COCA-20", posName: "COCA 20CL", canonicalName: "Coca-Cola", category: "Soft drinks", defaultCourse: "drinks", priceCents: 320, active: true, aliases: ["coca cola", "coca", "cola", "coke"], modifierGroupIds: [], allergenCodes: [] },
    { id: "POS-1102", sku: "COCA-Z-20", posName: "COCA Z 20", canonicalName: "Coca-Cola Zero", category: "Soft drinks", defaultCourse: "drinks", priceCents: 320, active: true, aliases: ["coca cola zero", "coca colla zero", "coca zero", "cola zero", "coke zero", "ne zero", "zero", "cola zonder suiker"], modifierGroupIds: [], allergenCodes: [] },
    { id: "POS-1103", sku: "WATER-ST", posName: "WATER ST 50", canonicalName: "Still water", category: "Soft drinks", defaultCourse: "drinks", priceCents: 450, active: true, aliases: ["plat water", "still water", "stil water", "eau plate"], modifierGroupIds: [], allergenCodes: [] },
    { id: "POS-1201", sku: "GIN-TON", posName: "GIN TONIC H", canonicalName: "House gin and tonic", category: "Cocktails", defaultCourse: "drinks", priceCents: 1250, active: true, aliases: ["gin tonic", "gin tonik", "gin and tonic", "gin-tonic"], modifierGroupIds: [], allergenCodes: [] },
    { id: "POS-1301", sku: "W-WHITE-A", posName: "WIT HUIS A 20", canonicalName: "House white wine — Vermentino", category: "Wine", defaultCourse: "drinks", priceCents: 620, active: true, aliases: ["huiswijn wit", "witte huiswijn", "house white wine"], modifierGroupIds: [], allergenCodes: ["sulphites"] },
    { id: "POS-1302", sku: "W-WHITE-B", posName: "WIT HUIS B 20", canonicalName: "House white wine — Chardonnay", category: "Wine", defaultCourse: "drinks", priceCents: 650, active: true, aliases: ["huiswijn wit", "witte huiswijn", "house white wine"], modifierGroupIds: [], allergenCodes: ["sulphites"] },
    { id: "POS-2001", sku: "GAR-KROK", posName: "GARNAALKROK 2", canonicalName: "Shrimp croquettes", category: "Starters", defaultCourse: "starter", priceCents: 1750, active: true, aliases: ["garnaalkroketten", "garnaal kroketten", "garnaal kroket", "garnalen kroketten", "shrimp croquettes", "croquettes aux crevettes"], modifierGroupIds: [], allergenCodes: ["crustaceans", "gluten", "milk"] },
    { id: "POS-3001", sku: "STK-STD", posName: "STK STD", canonicalName: "Belgian beef steak", category: "Mains", defaultCourse: "main", priceCents: 2890, active: true, aliases: ["steak", "steek", "biefstuk", "beef steak"], modifierGroupIds: ["MG-CUISSON", "MG-SIDE", "MG-SAUCE"], allergenCodes: [] },
    { id: "POS-3002", sku: "VOLAU", posName: "VOLAU", canonicalName: "Vol-au-vent", category: "Mains", defaultCourse: "main", priceCents: 2350, active: true, aliases: ["vol-au-vent", "vol au vent", "vol au van", "vol over vent", "volovan", "videe", "vidée"], modifierGroupIds: ["MG-SIDE"], allergenCodes: ["gluten", "milk", "eggs"] },
    { id: "POS-3003", sku: "FISH-DAY", posName: "VIS VD DAG", canonicalName: "Fish of the day", category: "Mains", defaultCourse: "main", priceCents: 2690, active: true, variant: "Salmon", seasonLabel: "deze week: zalm", aliases: ["vis van de dag", "fish of the day", "poisson du jour", "zalm", "salmon", "saumon"], modifierGroupIds: ["MG-SIDE"], allergenCodes: ["fish"] },
    { id: "POS-3005", sku: "PLAICE", posName: "PLADIJS", canonicalName: "Plaice", category: "Mains", defaultCourse: "main", priceCents: 2780, active: true, aliases: ["pladijs", "plaice", "plie", "schol"], modifierGroupIds: ["MG-SIDE"], allergenCodes: ["fish"] },
    { id: "POS-3004", sku: "VEG-STEW", posName: "VEG STOOF", canonicalName: "Vegetarian stew", category: "Mains", defaultCourse: "main", priceCents: 2190, active: true, aliases: ["vegetarische stoofpot", "vegetarian stew", "stoofpot zonder vlees"], modifierGroupIds: ["MG-SIDE"], allergenCodes: ["celery"] },
    { id: "POS-3101", sku: "FRIES", posName: "FRIES PORT", canonicalName: "Portion of fries", category: "Sides", defaultCourse: "main", priceCents: 450, active: true, aliases: ["portie frieten", "frieten", "fries", "frites"], modifierGroupIds: [], allergenCodes: [] },
    { id: "POS-4001", sku: "COFFEE", posName: "KOFFIE", canonicalName: "Coffee", category: "Hot drinks", defaultCourse: "dessert", priceCents: 310, active: true, aliases: ["koffie", "koffi", "coffee", "café"], modifierGroupIds: ["MG-COFFEE"], allergenCodes: [] },
    { id: "POS-5001", sku: "CHOC-MOUS", posName: "CHOC MOUS", canonicalName: "Chocolate mousse", category: "Desserts", defaultCourse: "dessert", priceCents: 890, active: true, aliases: ["chocolademousse", "chocolade moes", "chocolate mousse", "mousse au chocolat"], modifierGroupIds: [], allergenCodes: ["milk", "eggs"] },
    { id: "POS-9999", sku: "OLD-COLA", posName: "COLA OLD", canonicalName: "Legacy cola", category: "Archived", defaultCourse: "drinks", priceCents: 250, active: false, aliases: ["cola"], modifierGroupIds: [], allergenCodes: [] },
  ],
};

export const demoMenu = TenantMenuSchema.parse(menu);

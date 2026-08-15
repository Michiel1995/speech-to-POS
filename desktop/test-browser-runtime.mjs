import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => typeof address === "object" && address
        ? resolve(address.port)
        : reject(new Error("Geen testpoort beschikbaar.")));
    });
  });
}

function sanitizedEnvironment() {
  const environment = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(process.env).reverse()) {
    const normalizedKey = key.toUpperCase();
    if (seen.has(normalizedKey) || value === undefined) continue;
    seen.add(normalizedKey);
    environment[key] = value;
  }
  for (const key of Object.keys(environment)) {
    if (["OPENAI_API_KEY", "LOCAL_WHISPER_CLI", "LOCAL_WHISPER_MODEL"].includes(key.toUpperCase())) {
      delete environment[key];
    }
  }
  return environment;
}

async function waitForHealth(origin, child, stderr) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server stopte met code ${child.exitCode}: ${stderr()}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Browsertestserver startte niet op tijd: ${stderr()}`);
}

const browserRoot = process.env.TEST_BROWSER_ROOT;
if (!browserRoot) throw new Error("TEST_BROWSER_ROOT ontbreekt.");
const appRoot = path.join(browserRoot, "app");
const nodeExecutable = path.join(browserRoot, "node", "node.exe");
const port = await getFreePort();
const origin = `http://127.0.0.1:${port}`;
const environment = {
  ...sanitizedEnvironment(),
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  NODE_PATH: path.join(appRoot, "runtime_modules"),
  POS_ADAPTER: "mock",
  ORDER_ENGINE_MODE: "deterministic",
  DEBUG_RETAIN_CONVERSATION: "false",
};

let stderrOutput = "";
const server = spawn(nodeExecutable, ["server-bootstrap.cjs"], {
  cwd: appRoot,
  env: environment,
  windowsHide: true,
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (chunk) => { stderrOutput += chunk.toString(); });

try {
  const health = await waitForHealth(origin, server, () => stderrOutput);
  const menuResponse = await fetch(`${origin}/api/menu`).then((response) => response.json());
  const table = menuResponse.menu.tables.find((candidate) => candidate.active);
  const interpret = (text, priorLines, contextProductIds) => fetch(`${origin}/api/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: menuResponse.menu.tenantId,
      tableId: table.id,
      tableLabel: table.label,
      waiterId: "waiter-browser-test",
      source: "audio",
      engine: "deterministic",
      turns: [{ speaker: "customer", text }],
      priorLines,
      contextProductIds,
    }),
  }).then((response) => response.json());

  const first = await interpret("Ik neem een Duvel");
  const addition = await interpret("Doe er een Stella bij", first.draft.lines);
  if (addition.draft?.lines?.length !== 2) {
    throw new Error(`Vervolgitem verving de vorige bestelling: ${JSON.stringify(addition)}`);
  }
  const question = await interpret("Welke bieren hebben jullie?", addition.draft.lines);
  if (!question.assistantMessage?.includes("Leffe Blond") || question.draft.lines.length !== 2) {
    throw new Error(`Biervraag werd niet beantwoord of wijzigde de bestelling: ${JSON.stringify(question)}`);
  }
  const contextualPrice = await interpret("Hoeveel kost die?", question.draft.lines, ["POS-1001"]);
  if (!contextualPrice.assistantMessage?.includes("€5,20") || contextualPrice.draft.lines.length !== 2) {
    throw new Error(`Contextuele prijsvraag mislukte: ${JSON.stringify(contextualPrice)}`);
  }
  const contextualIngredient = await interpret("Wat zit daarin?", contextualPrice.draft.lines, ["POS-2001"]);
  if (!contextualIngredient.assistantMessage?.includes("crustaceans") || contextualIngredient.draft.lines.length !== 2) {
    throw new Error(`Contextuele allergenenvraag mislukte: ${JSON.stringify(contextualIngredient)}`);
  }
  const fuzzyAddition = await interpret("Doe er een leven blond bij", question.draft.lines);
  if (fuzzyAddition.draft?.lines?.length !== 3 || !fuzzyAddition.draft.lines.some((line) => line.productId === "POS-1003")) {
    throw new Error(`Spraakvariant werd niet veilig als Leffe Blond verwerkt: ${JSON.stringify(fuzzyAddition)}`);
  }
  const unlistedFuzzyAddition = await interpret("Doe er een coka cola zero bij", fuzzyAddition.draft.lines);
  if (
    unlistedFuzzyAddition.draft?.lines?.length !== 4 ||
    !unlistedFuzzyAddition.draft.lines.some((line) => line.productId === "POS-1102") ||
    !unlistedFuzzyAddition.draft.issues.some((issue) => issue.type === "speech_confirmation" && issue.blocking)
  ) {
    throw new Error(`Onbekende fuzzy variant kreeg geen gerichte bevestigingsvraag: ${JSON.stringify(unlistedFuzzyAddition)}`);
  }
  const nonOrderStatement = await interpret("Mijn zus heet Stella", unlistedFuzzyAddition.draft.lines);
  if (nonOrderStatement.draft.lines.length !== 4) {
    throw new Error(`Niet-bestellende productzin wijzigde de bestelling: ${JSON.stringify(nonOrderStatement)}`);
  }
  const misrecognizedQuestion = await interpret("Welke dieren hebben jullie?", nonOrderStatement.draft.lines);
  if (!misrecognizedQuestion.assistantMessage?.includes("Leffe Blond") || misrecognizedQuestion.draft.lines.length !== 4) {
    throw new Error(`Foutief herkende biervraag werd niet veilig beantwoord: ${JSON.stringify(misrecognizedQuestion)}`);
  }
  const removal = await interpret("Ik hoef misschien toch geen Duvel", misrecognizedQuestion.draft.lines);
  if (removal.draft.lines.some((line) => line.productId === "POS-1001") || removal.draft.lines.length !== 3) {
    throw new Error(`Natuurlijke verwijdering werkte niet: ${JSON.stringify(removal)}`);
  }
  const starterQuestion = await interpret("Welke voorgerechten hebben jullie?", removal.draft.lines);
  if (starterQuestion.nextContextProductIds?.length !== 1 || starterQuestion.nextContextProductIds[0] !== "POS-2001") {
    throw new Error(`Voorgerechtcontext werd niet bewaard: ${JSON.stringify(starterQuestion)}`);
  }
  const interleavedJoke = await interpret(
    "Mijn nonkel vertelt altijd een mop over Duvel",
    starterQuestion.draft.lines,
    starterQuestion.nextContextProductIds,
  );
  if (interleavedJoke.draft.lines.length !== 3 || interleavedJoke.nextContextProductIds?.[0] !== "POS-2001") {
    throw new Error(`Mop wijzigde bestelling of context: ${JSON.stringify(interleavedJoke)}`);
  }
  const contextualOrder = await interpret(
    "Dat klinkt goed, geef me die maar",
    interleavedJoke.draft.lines,
    interleavedJoke.nextContextProductIds,
  );
  if (!contextualOrder.draft.lines.some((line) => line.productId === "POS-2001")) {
    throw new Error(`Vage vervolgkeuze gebruikte tafelcontext niet: ${JSON.stringify(contextualOrder)}`);
  }
  const posResponse = await fetch(`${origin}/api/pos/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft: contextualOrder.draft,
      idempotencyKey: `browser-test:${contextualOrder.draft.id}`,
      sentBy: "waiter-browser-test",
    }),
  }).then((response) => response.json());
  if (posResponse.draft?.status !== "SENT") {
    throw new Error(`Conceptbestelling werd niet naar de mock-POS gestuurd: ${JSON.stringify({ posResponse, issues: contextualOrder.draft.issues })}`);
  }
  console.log(JSON.stringify({
    health: health.ok,
    offlineWhisperConfigured: health.offlineSpeechConfigured,
    adapter: menuResponse.adapter,
    cumulativeLines: contextualOrder.draft.lines.map((line) => `${line.quantity}x ${line.canonicalName}`),
    beerQuestionAnswered: question.assistantMessage,
    contextualPriceAnswered: contextualPrice.assistantMessage,
    contextualIngredientAnswered: contextualIngredient.assistantMessage,
    fuzzySpeechMappedTo: fuzzyAddition.draft.lines.find((line) => line.productId === "POS-1003")?.canonicalName,
    unlistedFuzzyMappedTo: unlistedFuzzyAddition.draft.lines.find((line) => line.productId === "POS-1102")?.canonicalName,
    fuzzySpeechConfirmation: unlistedFuzzyAddition.draft.issues.find((issue) => issue.type === "speech_confirmation")?.message,
    nonOrderStatementIgnored: nonOrderStatement.draft.lines.length === unlistedFuzzyAddition.draft.lines.length,
    misrecognizedBeerQuestionAnswered: misrecognizedQuestion.assistantMessage,
    naturalRemovalWorked: !removal.draft.lines.some((line) => line.productId === "POS-1001"),
    contextualStarterMappedTo: contextualOrder.draft.lines.find((line) => line.productId === "POS-2001")?.canonicalName,
    jokeIgnoredWhileContextPersisted: interleavedJoke.nextContextProductIds?.[0] === "POS-2001",
    posStatus: posResponse.draft?.status,
  }, null, 2));
} finally {
  server.kill();
}

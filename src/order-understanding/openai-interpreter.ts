import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  ConversationExtractionSchema,
  type DraftOrder,
  type InterpretRequest,
  type TenantMenu,
} from "@/src/domain/schemas";
import { DomainError } from "@/src/domain/errors";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { productCandidatesForPhrase } from "@/src/semantic-menu/matcher";

function compactMenu(menu: TenantMenu) {
  return menu.products
    .filter((product) => product.active)
    .map((product) => ({
      name: product.canonicalName,
      aliases: product.aliases,
      allowedModifiers: product.modifierGroupIds.flatMap(
        (groupId) =>
          menu.modifierGroups
            .find((group) => group.id === groupId)
            ?.options.map((option) => option.canonicalName) ?? [],
      ),
    }));
}

export async function interpretWithOpenAI(
  request: InterpretRequest,
  menu: TenantMenu,
): Promise<DraftOrder> {
  if (!process.env.OPENAI_API_KEY) {
    throw new DomainError(
      "OPENAI_API_KEY is not configured. Use deterministic mode or add a server-side key.",
      "OPENAI_NOT_CONFIGURED",
      503,
    );
  }

  const started = performance.now();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcript = request.turns
    .map((turn) => `${turn.speaker.toUpperCase()}: ${turn.text}`)
    .join("\n");

  const response = await client.responses.parse({
    model: process.env.OPENAI_ORDER_MODEL ?? "gpt-5.4-mini",
    instructions: [
      "Extract the final confirmed hospitality order from a waiter/customer conversation.",
      "A waiter repetition is confirmation, not a duplicate item.",
      "Questions and recommendations without customer acceptance are not orders.",
      "Apply corrections, replacements, quantity changes, and cancellations so only the final intent remains.",
      "Preserve mixed Dutch, English, and French item/modifier wording.",
      "Do not invent menu products. Put uncertain spoken product phrases in unresolvedMentions.",
      "Allergy statements are notes, never claims of safety.",
    ].join(" "),
    input: `ACTIVE MENU (semantic names only):\n${JSON.stringify(compactMenu(menu))}\n\nCONVERSATION:\n${transcript}`,
    text: { format: zodTextFormat(ConversationExtractionSchema, "hospitality_order_extraction") },
  });

  const extraction = response.output_parsed;
  if (!extraction) {
    throw new DomainError("The model returned no validated structured order.", "INVALID_AI_OUTPUT", 502);
  }

  const syntheticTurns = extraction.confirmedItems.map((item) => ({
    speaker: "customer" as const,
    text: [
      String(item.quantity),
      item.spokenItem,
      ...item.spokenModifiers,
      ...item.notes,
      item.allergyStatement ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  }));
  syntheticTurns.push(
    ...extraction.unresolvedMentions.map((mention) => ({
      speaker: "customer" as const,
      text: `Ik neem ${mention}`,
    })),
  );

  const draft = interpretDeterministically({ ...request, turns: syntheticTurns }, menu);
  for (const item of extraction.confirmedItems) {
    if (item.course === "unspecified") continue;
    const candidates = productCandidatesForPhrase(item.spokenItem, menu);
    if (candidates.length !== 1) continue;
    const line = draft.lines.find((candidate) => candidate.productId === candidates[0].id);
    if (line) line.course = item.course;
  }
  draft.interpretationLatencyMs = Math.round(performance.now() - started);
  return draft;
}

import { NextResponse } from "next/server";

import { DomainError } from "@/src/domain/errors";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { apiError } from "@/src/http/api-error";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { buildMenuAnswer } from "@/src/order-understanding/menu-question";
import { routeUtterance } from "@/src/order-understanding/intent-router";
import { planOrderAction } from "@/src/order-understanding/order-actions";
import { memoryEventFromAction, stableUtteranceId } from "@/src/memory/table-memory";
import { getPOSAdapter } from "@/src/pos/registry";
import { findProductMentions, normalizeSpoken } from "@/src/semantic-menu/matcher";
import { culinaryAdviceForText } from "@/src/knowledge/culinary-knowledge";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const menu = await getPOSAdapter().getMenu();
    const probe = "ik neem een duvel en een steak met frieten";
    findProductMentions(probe, menu);
    routeUtterance(probe, { menu, dialectProfile: "auto" });
    culinaryAdviceForText("hebben jullie kabeljauw", menu);
    return NextResponse.json({ warmed: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = InterpretRequestSchema.parse(await request.json());
    const baseMenu = await getPOSAdapter().getMenu();
    const approvedByProduct = new Map<string, string[]>();
    for (const alias of input.approvedAliases ?? []) {
      approvedByProduct.set(alias.productId, [...(approvedByProduct.get(alias.productId) ?? []), alias.spokenFragment]);
    }
    const menu = {
      ...baseMenu,
      products: baseMenu.products.map((product) => ({
        ...product,
        aliases: [...new Set([...product.aliases, ...(approvedByProduct.get(product.id) ?? [])])],
      })),
    };
    if (input.tenantId !== menu.tenantId) {
      throw new DomainError("The selected menu tenant is stale. Refresh the menu.", "STALE_MENU", 409);
    }
    const duplicateIgnored = Boolean(input.utteranceId && input.processedUtteranceIds?.includes(input.utteranceId));
    const draft = interpretDeterministically(input, menu, { ignoreTurns: duplicateIgnored });
    const latestGuestText = [...input.turns].reverse().find((turn) => turn.speaker !== "waiter")?.text ?? "";
    const culinaryAdvice = culinaryAdviceForText(latestGuestText, menu);
    const answers = [...input.turns]
      .reverse()
      .filter((turn) => turn.speaker !== "waiter")
      .flatMap((turn) => routeUtterance(turn.text, {
        menu,
        dialectProfile: input.dialectProfile,
        hasOrder: Boolean(input.priorLines?.length),
        hasContext: Boolean(input.contextProductIds?.length),
        contextProductIds: input.contextProductIds,
        existingProductIds: input.priorLines?.map((line) => line.productId),
      })
        .map((route) => buildMenuAnswer(route.normalizedText, menu, input.contextProductIds))
        .filter((answer): answer is NonNullable<typeof answer> => Boolean(answer)));
    const assistantMessage = culinaryAdvice?.message ?? (answers.map((answer) => answer.message).join(" ") || undefined);
    const assistantContextProductIds = culinaryAdvice?.alternatives.map((product) => product.id).slice(0, 12)
      ?? answers.flatMap((answer) => answer.productIds).slice(0, 12);
    const waiterContextProductIds = [...input.turns]
      .reverse()
      .filter((turn) => turn.speaker === "waiter")
      .map((turn) => findProductMentions(turn.text, menu)
        .flatMap((mention) => mention.candidates)
        .filter((product, index, products) => products.findIndex((candidate) => candidate.id === product.id) === index)
        .map((product) => product.id)
        .slice(0, 12))
      .find((productIds) => productIds.length > 0);
    const normalizedGuestText = normalizeSpoken(latestGuestText);
    const consumedContext = /\b(die|dat|deze|daarvan|dezelfde|hetzelfde|doe maar|geef maar|voor mij ook|nog eentje|nog eens)\b/.test(normalizedGuestText);
    const routedSegments = input.turns.flatMap((turn) => routeUtterance(turn.text, {
      menu,
      dialectProfile: input.dialectProfile,
      hasOrder: Boolean(input.priorLines?.length),
      hasContext: Boolean(input.contextProductIds?.length),
      contextProductIds: input.contextProductIds,
      existingProductIds: input.priorLines?.map((line) => line.productId),
    }));
    const previousQuantities = new Map((input.priorLines ?? []).map((line) => [line.productId, line.quantity]));
    const changedProductIds = draft.lines
      .filter((line) => previousQuantities.get(line.productId) !== line.quantity)
      .map((line) => line.productId)
      .slice(-5);
    const refusedContext = routedSegments.some((route) => route.intent === "refusal");
    const nextContextProductIds = refusedContext
      ? []
      : assistantContextProductIds.length
        ? assistantContextProductIds
        : waiterContextProductIds ?? (consumedContext && changedProductIds.length ? changedProductIds : input.contextProductIds ?? []);
    const latestText = input.turns.map((turn) => turn.text).join(" ");
    const utteranceId = input.utteranceId ?? stableUtteranceId(input.tableId, latestText);
    const actions = routedSegments.map((route) => planOrderAction(route, menu));
    const events = actions.map((action) => memoryEventFromAction(input.tableId, utteranceId, action, draft.issues.some((issue) => issue.blocking)));
    return NextResponse.json({
      operationId: input.operationId,
      tableId: input.tableId,
      baseDraftRevision: input.baseDraftRevision,
      draft,
      assistantMessage: duplicateIgnored ? "Deze uitspraak was al verwerkt en is niet opnieuw toegevoegd." : assistantMessage,
      nextContextProductIds,
      routedSegments,
      actions,
      events,
      utteranceId,
      duplicateIgnored,
      rawConversationRetained: false,
    });
  } catch (error) {
    return apiError(error);
  }
}

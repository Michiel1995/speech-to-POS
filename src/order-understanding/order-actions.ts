import type { TenantMenu } from "@/src/domain/schemas";
import type { ConversationIntent, RoutedIntent } from "@/src/order-understanding/intent-router";

export const ORDER_ACTION_TYPES = [
  "ADD", "INCREMENT", "DECREMENT", "REMOVE", "REPLACE", "SET_QUANTITY", "SET_MODIFIER", "REMOVE_MODIFIER",
  "SET_COURSE", "ADD_NOTE", "ANSWER_QUESTION", "NO_ORDER_ACTION", "REQUEST_CLARIFICATION",
] as const;
export type OrderActionType = (typeof ORDER_ACTION_TYPES)[number];

export interface PlannedOrderAction {
  type: OrderActionType;
  intent: ConversationIntent;
  productIds: string[];
  confidence: number;
  summary: string;
  mutatesOrder: boolean;
}

const actionForIntent: Record<ConversationIntent, OrderActionType> = {
  order: "ADD",
  addition: "INCREMENT",
  removal: "REMOVE",
  replacement: "REPLACE",
  correction: "SET_QUANTITY",
  menu_question: "ANSWER_QUESTION",
  availability_question: "ANSWER_QUESTION",
  price_question: "ANSWER_QUESTION",
  ingredient_question: "ANSWER_QUESTION",
  recommendation_question: "ANSWER_QUESTION",
  answer: "NO_ORDER_ACTION",
  refusal: "NO_ORDER_ACTION",
  non_order: "NO_ORDER_ACTION",
  unclear: "REQUEST_CLARIFICATION",
};

export function planOrderAction(route: RoutedIntent, menu?: TenantMenu): PlannedOrderAction {
  const type = actionForIntent[route.intent];
  const names = route.productIds
    .map((id) => menu?.products.find((product) => product.id === id)?.canonicalName)
    .filter((name): name is string => Boolean(name));
  const label = names.length ? names.slice(0, 3).join(", ") : "gesprekscontext";
  const verb: Record<OrderActionType, string> = {
    ADD: "Toevoegen",
    INCREMENT: "Bijbestellen",
    DECREMENT: "Verminderen",
    REMOVE: "Verwijderen",
    REPLACE: "Vervangen",
    SET_QUANTITY: "Hoeveelheid instellen",
    SET_MODIFIER: "Bereiding aanpassen",
    REMOVE_MODIFIER: "Bereiding verwijderen",
    SET_COURSE: "Gang instellen",
    ADD_NOTE: "Notitie toevoegen",
    ANSWER_QUESTION: "Vraag beantwoorden",
    NO_ORDER_ACTION: "Geen bestelactie",
    REQUEST_CLARIFICATION: "Verduidelijking vragen",
  };
  return {
    type,
    intent: route.intent,
    productIds: route.productIds,
    confidence: route.confidence,
    summary: `${verb[type]}: ${label}`,
    mutatesOrder: route.requiresOrderMutation,
  };
}

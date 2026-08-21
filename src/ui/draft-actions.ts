import type {
  DraftIssue,
  DraftLine,
  DraftOrder,
  MenuProduct,
  ModifierOption,
  TenantMenu,
} from "@/src/domain/schemas";

function nextDraft(draft: DraftOrder, lines: DraftLine[], issues: DraftIssue[]): DraftOrder {
  return { ...draft, lines, issues, status: "NOT_SENT", updatedAt: new Date().toISOString() };
}

function requiredModifierIssues(line: DraftLine, product: MenuProduct, menu: TenantMenu): DraftIssue[] {
  return product.modifierGroupIds.flatMap((groupId) => {
    const group = menu.modifierGroups.find((candidate) => candidate.id === groupId);
    if (!group?.required) return [];
    return [{
      id: `issue-${crypto.randomUUID()}`,
      type: "missing_modifier" as const,
      blocking: true,
      message: `${product.canonicalName} needs ${group.name.toLowerCase()}.`,
      lineId: line.lineId,
      modifierGroupId: group.id,
      modifierOptions: group.options,
    }];
  });
}

export function resolveWithProduct(
  draft: DraftOrder,
  issueId: string,
  product: MenuProduct,
  menu: TenantMenu,
): DraftOrder {
  const line: DraftLine = {
    lineId: `line-${crypto.randomUUID()}`,
    productId: product.id,
    sku: product.sku,
    posName: product.posName,
    canonicalName: product.canonicalName,
    category: product.category,
    quantity: 1,
    course: product.defaultCourse,
    modifiers: [],
    notes: [],
    confidence: 1,
  };
  const remaining = draft.issues.filter((issue) => issue.id !== issueId);
  return nextDraft(draft, [...draft.lines, line], [...remaining, ...requiredModifierIssues(line, product, menu)]);
}

export function resolveRemovingProduct(
  draft: DraftOrder,
  issueId: string,
  product: MenuProduct,
): DraftOrder {
  const removedLineIds = new Set(
    draft.lines.filter((line) => line.productId === product.id).map((line) => line.lineId),
  );
  const lines = draft.lines.filter((line) => line.productId !== product.id);
  const issues = draft.issues.filter(
    (issue) => issue.id !== issueId && (!issue.lineId || !removedLineIds.has(issue.lineId)),
  );
  return nextDraft(draft, lines, issues);
}

export function resolveModifier(
  draft: DraftOrder,
  issueId: string,
  groupId: string,
  option: ModifierOption,
): DraftOrder {
  const issue = draft.issues.find((candidate) => candidate.id === issueId);
  if (!issue?.lineId) return draft;
  const lines = draft.lines.map((line) =>
    line.lineId === issue.lineId
      ? {
          ...line,
          modifiers: [
            ...line.modifiers.filter((modifier) => modifier.groupId !== groupId),
            {
              groupId,
              optionId: option.id,
              posName: option.posName,
              canonicalName: option.canonicalName,
              priceCents: option.priceCents,
            },
          ],
        }
      : line,
  );
  return nextDraft(draft, lines, draft.issues.filter((candidate) => candidate.id !== issueId));
}

export function resolveIssueWithoutData(draft: DraftOrder, issueId: string): DraftOrder {
  return nextDraft(draft, draft.lines, draft.issues.filter((issue) => issue.id !== issueId));
}

export function confirmSpeechProduct(draft: DraftOrder, issueId: string): DraftOrder {
  const issue = draft.issues.find((candidate) => candidate.id === issueId && candidate.type === "speech_confirmation");
  if (!issue?.lineId) return draft;
  const lines = draft.lines.map((line) =>
    line.lineId === issue.lineId ? { ...line, confidence: 1 } : line,
  );
  return nextDraft(draft, lines, draft.issues.filter((candidate) => candidate.id !== issueId));
}

export function rejectSpeechProduct(draft: DraftOrder, issueId: string): DraftOrder {
  const issue = draft.issues.find((candidate) => candidate.id === issueId && candidate.type === "speech_confirmation");
  if (!issue?.lineId) return draft;
  const line = draft.lines.find((candidate) => candidate.lineId === issue.lineId);
  if (!line) return resolveIssueWithoutData(draft, issueId);
  const quantityDelta = Math.max(1, issue.quantityDelta ?? 1);
  const removeLine = line.quantity <= quantityDelta;
  const lines = removeLine
    ? draft.lines.filter((candidate) => candidate.lineId !== line.lineId)
    : draft.lines.map((candidate) =>
        candidate.lineId === line.lineId
          ? { ...candidate, quantity: candidate.quantity - quantityDelta }
          : candidate,
      );
  const issues = draft.issues.filter((candidate) =>
    candidate.id !== issueId && (!removeLine || candidate.lineId !== line.lineId),
  );
  return nextDraft(draft, lines, issues);
}

export function addManualProduct(draft: DraftOrder, product: MenuProduct, menu: TenantMenu): DraftOrder {
  return resolveWithProduct(draft, "__manual__", product, menu);
}

export function changeDraftLineQuantity(
  draft: DraftOrder,
  lineId: string,
  delta: -1 | 1,
): DraftOrder {
  const line = draft.lines.find((candidate) => candidate.lineId === lineId);
  if (!line) return draft;
  const quantity = line.quantity + delta;
  if (quantity <= 0) {
    return nextDraft(
      draft,
      draft.lines.filter((candidate) => candidate.lineId !== lineId),
      draft.issues.filter((issue) => issue.lineId !== lineId),
    );
  }
  return nextDraft(
    draft,
    draft.lines.map((candidate) => candidate.lineId === lineId ? { ...candidate, quantity } : candidate),
    draft.issues,
  );
}

export function removeDraftLine(draft: DraftOrder, lineId: string): DraftOrder {
  const line = draft.lines.find((candidate) => candidate.lineId === lineId);
  if (!line) return draft;
  return nextDraft(
    draft,
    draft.lines.filter((candidate) => candidate.lineId !== lineId),
    draft.issues.filter((issue) => issue.lineId !== lineId),
  );
}

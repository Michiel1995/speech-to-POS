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

export function addManualProduct(draft: DraftOrder, product: MenuProduct, menu: TenantMenu): DraftOrder {
  return resolveWithProduct(draft, "__manual__", product, menu);
}

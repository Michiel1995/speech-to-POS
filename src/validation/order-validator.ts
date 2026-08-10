import type { DraftOrder, TenantMenu } from "@/src/domain/schemas";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDraft(draft: DraftOrder, menu: TenantMenu): ValidationResult {
  const errors: string[] = [];

  if (draft.tenantId !== menu.tenantId) {
    errors.push("Draft tenant does not match the active menu tenant.");
  }
  if (!menu.tables.some((table) => table.id === draft.tableId && table.active)) {
    errors.push(`Table ${draft.tableId} is not active in the POS.`);
  }
  if (draft.issues.some((issue) => issue.blocking)) {
    errors.push("Draft has unresolved blocking issues.");
  }

  for (const line of draft.lines) {
    const product = menu.products.find((candidate) => candidate.id === line.productId);
    if (!product || !product.active) {
      errors.push(`Line ${line.lineId} references an unavailable POS product.`);
      continue;
    }
    if (line.sku !== product.sku || line.posName !== product.posName) {
      errors.push(`Line ${line.lineId} does not match current POS product data.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      errors.push(`Line ${line.lineId} has an invalid quantity.`);
    }

    const selectedByGroup = new Map<string, number>();
    for (const modifier of line.modifiers) {
      if (!product.modifierGroupIds.includes(modifier.groupId)) {
        errors.push(`Modifier ${modifier.optionId} does not apply to ${product.posName}.`);
        continue;
      }
      const group = menu.modifierGroups.find((candidate) => candidate.id === modifier.groupId);
      const option = group?.options.find((candidate) => candidate.id === modifier.optionId);
      if (!group || !option) {
        errors.push(`Modifier ${modifier.optionId} is not in the active POS menu.`);
        continue;
      }
      selectedByGroup.set(group.id, (selectedByGroup.get(group.id) ?? 0) + 1);
    }

    for (const groupId of product.modifierGroupIds) {
      const group = menu.modifierGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        errors.push(`Product ${product.posName} references missing modifier group ${groupId}.`);
        continue;
      }
      const count = selectedByGroup.get(group.id) ?? 0;
      if (count < group.min) errors.push(`${product.posName} is missing required ${group.name}.`);
      if (count > group.max) errors.push(`${product.posName} has too many ${group.name} choices.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

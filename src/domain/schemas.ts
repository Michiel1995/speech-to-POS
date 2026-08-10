import { z } from "zod";

export const SpeakerRoleSchema = z.enum(["customer", "waiter", "unknown"]);
export type SpeakerRole = z.infer<typeof SpeakerRoleSchema>;

export const ConversationTurnSchema = z.object({
  speaker: SpeakerRoleSchema,
  text: z.string().trim().min(1).max(2_000),
  providerSpeaker: z.string().max(64).optional(),
  startedAtMs: z.number().nonnegative().optional(),
  endedAtMs: z.number().nonnegative().optional(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const CourseSchema = z.enum(["drinks", "starter", "main", "dessert", "unspecified"]);
export type Course = z.infer<typeof CourseSchema>;

export const ModifierOptionSchema = z.object({
  id: z.string().min(1),
  posName: z.string().min(1),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  priceCents: z.number().int().nonnegative(),
});
export type ModifierOption = z.infer<typeof ModifierOptionSchema>;

export const ModifierGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean(),
  min: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  options: z.array(ModifierOptionSchema).min(1),
});
export type ModifierGroup = z.infer<typeof ModifierGroupSchema>;

export const MenuProductSchema = z.object({
  id: z.string().min(1),
  sku: z.string().min(1),
  posName: z.string().min(1),
  canonicalName: z.string().min(1),
  category: z.string().min(1),
  defaultCourse: CourseSchema,
  priceCents: z.number().int().nonnegative(),
  active: z.boolean(),
  aliases: z.array(z.string().min(1)).min(1),
  modifierGroupIds: z.array(z.string()),
  allergenCodes: z.array(z.string()),
});
export type MenuProduct = z.infer<typeof MenuProductSchema>;

export const TableSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  number: z.number().int().positive(),
  active: z.boolean(),
});
export type Table = z.infer<typeof TableSchema>;

export const TenantMenuSchema = z.object({
  tenantId: z.string().min(1),
  restaurantName: z.string().min(1),
  version: z.string().min(1),
  currency: z.literal("EUR"),
  products: z.array(MenuProductSchema).min(1),
  modifierGroups: z.array(ModifierGroupSchema),
  tables: z.array(TableSchema),
});
export type TenantMenu = z.infer<typeof TenantMenuSchema>;

export const SelectedModifierSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
  posName: z.string().min(1),
  canonicalName: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
});
export type SelectedModifier = z.infer<typeof SelectedModifierSchema>;

export const DraftLineSchema = z.object({
  lineId: z.string().min(1),
  productId: z.string().min(1),
  sku: z.string().min(1),
  posName: z.string().min(1),
  canonicalName: z.string().min(1),
  category: z.string().min(1),
  quantity: z.number().int().positive(),
  course: CourseSchema,
  modifiers: z.array(SelectedModifierSchema),
  notes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type DraftLine = z.infer<typeof DraftLineSchema>;

export const ResolutionCandidateSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().min(1),
  posName: z.string().min(1),
  canonicalName: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
});
export type ResolutionCandidate = z.infer<typeof ResolutionCandidateSchema>;

export const DraftIssueSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["ambiguous_product", "unresolved_product", "missing_modifier", "course_exception"]),
  blocking: z.boolean(),
  message: z.string().min(1),
  rawText: z.string().optional(),
  lineId: z.string().optional(),
  productCandidates: z.array(ResolutionCandidateSchema).max(5).optional(),
  modifierGroupId: z.string().optional(),
  modifierOptions: z.array(ModifierOptionSchema).max(10).optional(),
});
export type DraftIssue = z.infer<typeof DraftIssueSchema>;

export const DraftWarningSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["allergy_manual_check", "free_text_note", "stale_menu"]),
  message: z.string().min(1),
  lineId: z.string().optional(),
});
export type DraftWarning = z.infer<typeof DraftWarningSchema>;

export const DraftOrderSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tableId: z.string().min(1),
  tableLabel: z.string().min(1),
  createdBy: z.string().min(1),
  lastEditedBy: z.string().min(1),
  sentBy: z.string().optional(),
  status: z.enum(["NOT_SENT", "SENT", "ERROR"]),
  source: z.enum(["text", "audio", "manual"]),
  lines: z.array(DraftLineSchema),
  issues: z.array(DraftIssueSchema),
  warnings: z.array(DraftWarningSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  interpretationLatencyMs: z.number().nonnegative(),
  posSubmission: z
    .object({
      adapter: z.string(),
      externalOrderId: z.string(),
      idempotencyKey: z.string(),
      confirmedByWaiter: z.literal(false),
      sentAt: z.string().datetime(),
    })
    .optional(),
});
export type DraftOrder = z.infer<typeof DraftOrderSchema>;

export const PriorOrderLineSchema = DraftLineSchema.pick({
  productId: true,
  sku: true,
  posName: true,
  canonicalName: true,
  category: true,
  quantity: true,
  course: true,
  modifiers: true,
  notes: true,
  confidence: true,
  lineId: true,
});

export const InterpretRequestSchema = z.object({
  tenantId: z.string().default("tenant-demo-brussels"),
  tableId: z.string().min(1),
  tableLabel: z.string().min(1),
  waiterId: z.string().min(1).default("waiter-demo"),
  source: z.enum(["text", "audio", "manual"]).default("text"),
  engine: z.enum(["deterministic", "openai"]).default("deterministic"),
  turns: z.array(ConversationTurnSchema).min(1).max(100),
  priorLines: z.array(PriorOrderLineSchema).max(50).optional(),
});
export type InterpretRequest = z.infer<typeof InterpretRequestSchema>;

export const ExtractedItemSchema = z.object({
  spokenItem: z.string().min(1),
  quantity: z.number().int().positive(),
  spokenModifiers: z.array(z.string()),
  course: CourseSchema,
  notes: z.array(z.string()),
  allergyStatement: z.string().nullable(),
});

export const ConversationExtractionSchema = z.object({
  confirmedItems: z.array(ExtractedItemSchema),
  unresolvedMentions: z.array(z.string()),
  conversationNotes: z.array(z.string()),
});
export type ConversationExtraction = z.infer<typeof ConversationExtractionSchema>;

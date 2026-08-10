import { z } from "zod";

export const CorrectionSignalSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  waiterId: z.string().min(1),
  spokenFragment: z.string().min(1).max(160),
  previousProductId: z.string().nullable(),
  correctedProductId: z.string().min(1),
  errorCategory: z.enum(["product", "quantity", "modifier", "course", "note"]),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
});
export type CorrectionSignal = z.infer<typeof CorrectionSignalSchema>;

export interface MappingProposal {
  id: string;
  tenantId: string;
  spokenFragment: string;
  correctedProductId: string;
  supportingSignals: number;
  status: "PENDING_MANAGER_APPROVAL" | "APPROVED";
  approvedAt?: string;
}

function normalized(fragment: string) {
  return fragment.trim().toLocaleLowerCase("nl-BE").replace(/\s+/g, " ");
}

export class CorrectionLearningStore {
  private readonly signals: CorrectionSignal[] = [];
  private readonly proposals = new Map<string, MappingProposal>();

  constructor(private readonly proposalThreshold = 3) {}

  record(input: CorrectionSignal): MappingProposal | null {
    const signal = CorrectionSignalSchema.parse(input);
    this.signals.push(signal);
    const fragment = normalized(signal.spokenFragment);
    const matching = this.signals.filter(
      (candidate) =>
        candidate.tenantId === signal.tenantId &&
        normalized(candidate.spokenFragment) === fragment &&
        candidate.correctedProductId === signal.correctedProductId,
    );
    if (matching.length < this.proposalThreshold) return null;

    const key = `${signal.tenantId}:${fragment}:${signal.correctedProductId}`;
    const existing = this.proposals.get(key);
    const proposal: MappingProposal = existing ?? {
      id: `proposal:${key}`,
      tenantId: signal.tenantId,
      spokenFragment: fragment,
      correctedProductId: signal.correctedProductId,
      supportingSignals: matching.length,
      status: "PENDING_MANAGER_APPROVAL",
    };
    proposal.supportingSignals = matching.length;
    this.proposals.set(key, proposal);
    return { ...proposal };
  }

  approve(proposalId: string): MappingProposal {
    const entry = [...this.proposals.entries()].find(([, proposal]) => proposal.id === proposalId);
    if (!entry) throw new Error("Mapping proposal not found.");
    entry[1].status = "APPROVED";
    entry[1].approvedAt = new Date().toISOString();
    return { ...entry[1] };
  }

  personalPatternWeight(waiterId: string, spokenFragment: string, now = new Date()): number {
    const related = this.signals.filter(
      (signal) => signal.waiterId === waiterId && normalized(signal.spokenFragment) === normalized(spokenFragment),
    );
    return related.reduce((sum, signal) => {
      const ageDays = Math.max(0, (now.getTime() - new Date(signal.createdAt).getTime()) / 86_400_000);
      return sum + Math.exp(-ageDays / 30);
    }, 0);
  }

  listProposals() {
    return [...this.proposals.values()].map((proposal) => ({ ...proposal }));
  }
}

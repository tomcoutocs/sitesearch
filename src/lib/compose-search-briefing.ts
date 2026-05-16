export const outreachChannelValues = [
  "email",
  "phone",
  "linkedin",
  "in_person",
  "mixed",
] as const;

export type OutreachChannel = (typeof outreachChannelValues)[number];

export const outreachChannelLabels: Record<OutreachChannel, string> = {
  email: "Email (plan to enrich inboxes afterward)",
  phone: "Cold call / texting",
  linkedin: "LinkedIn DM",
  in_person: "Walk-in / local drop-offs",
  mixed: "Mix of channels",
};

export type SearchFormInput = {
  profession: string;
  corridor: string;
  radiusMiles: number;
  exclusions: string;
  outreachChannel: OutreachChannel;
  additionalNotes?: string;
};

/** Turns structured UI inputs into prose the planner model already understands. */
export function composeBriefingFromForm(input: SearchFormInput) {
  const profession = input.profession.trim();
  const corridor = input.corridor.trim();
  const exclusions = input.exclusions.trim();
  const extras = input.additionalNotes?.trim() ?? "";
  const channelSummary =
    outreachChannelLabels[input.outreachChannel] ?? outreachChannelLabels.mixed;

  const ringHint = `${input.radiusMiles} miles`;

  return [
    `Profession focus: ${profession}.`,
    `Geographic corridor / anchors: ${corridor}. Prioritize storefronts roughly within a ${ringHint} radius from that anchored area unless the wording above specifies something tighter.`,
    exclusions
      ? `Exclude / down-rank mentions of: ${exclusions}.`
      : "",
    `Preferred outreach channel: ${channelSummary}.`,
    extras ? `Designer notes / extra signals: ${extras}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function isOutreachChannel(
  value: string,
): value is OutreachChannel {
  return outreachChannelValues.includes(value as OutreachChannel);
}

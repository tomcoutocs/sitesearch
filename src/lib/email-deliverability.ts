import { EMAIL_TEMPLATE_PLACEHOLDERS } from "@/lib/email-template";

export type SpamRiskLevel = "low" | "medium" | "high";

export type DeliverabilitySignal = {
  id: string;
  kind: "positive" | "warning" | "negative";
  label: string;
  detail: string;
  impact: number;
};

export type DeliverabilityReport = {
  /** 0–100 — higher means more likely to land in the primary inbox. */
  inboxScore: number;
  /** Estimated chance the message is filtered as spam (inverse of inbox tendency). */
  spamRiskPercent: number;
  riskLevel: SpamRiskLevel;
  /** How confident the heuristic analysis is (more signals checked → higher). */
  confidencePercent: number;
  signals: DeliverabilitySignal[];
  summary: string;
};

const HIGH_SPAM_PHRASES = [
  "act now",
  "apply now",
  "buy now",
  "click here",
  "click below",
  "congratulations",
  "dear friend",
  "dear sir",
  "dear madam",
  "double your",
  "earn money",
  "extra income",
  "free gift",
  "guarantee",
  "guaranteed",
  "limited time",
  "make money",
  "no obligation",
  "no risk",
  "order now",
  "please read",
  "special promotion",
  "this is not spam",
  "unsubscribe",
  "urgent",
  "while supplies last",
  "winner",
  "you have been selected",
  "100% free",
  "cash bonus",
];

const SALES_PHRASES = [
  "web design",
  "seo",
  "marketing agency",
  "increase traffic",
  "convert visitors",
  "online presence",
  "no charge",
  "free consultation",
  "limited offer",
];

const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*?>/iu;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}

function containsPhrase(text: string, phrase: string) {
  return text.toLowerCase().includes(phrase);
}

function hasPersonalization(text: string) {
  return EMAIL_TEMPLATE_PLACEHOLDERS.some((token) => text.includes(token));
}

function countPersonalizationTokens(text: string) {
  return EMAIL_TEMPLATE_PLACEHOLDERS.reduce(
    (total, token) => total + (text.split(token).length - 1),
    0,
  );
}

function riskLevelFromScore(inboxScore: number): SpamRiskLevel {
  if (inboxScore >= 75) return "low";
  if (inboxScore >= 55) return "medium";
  return "high";
}

function summaryForReport(
  inboxScore: number,
  riskLevel: SpamRiskLevel,
  negativeCount: number,
): string {
  if (riskLevel === "low") {
    return "This template reads like a personal note — likely to pass most filters when sent one-to-one from Gmail.";
  }
  if (riskLevel === "medium") {
    return "Some patterns may trigger filters. Tweak the flagged items before sending at volume.";
  }
  if (negativeCount >= 4) {
    return "Several spam-like patterns detected. Rewrite before sending to protect your sender reputation.";
  }
  return "High spam risk — this reads like bulk marketing mail. Personalize and soften the pitch.";
}

export function analyzeEmailDeliverability(
  subject: string,
  body: string,
): DeliverabilityReport {
  const signals: DeliverabilitySignal[] = [];
  let score = 72;
  let checksRun = 0;

  const subjectTrim = subject.trim();
  const bodyTrim = body.trim();
  const combined = `${subjectTrim}\n${bodyTrim}`.toLowerCase();

  const add = (
    id: string,
    kind: DeliverabilitySignal["kind"],
    label: string,
    detail: string,
    impact: number,
  ) => {
    checksRun += 1;
    score += impact;
    signals.push({ id, kind, label, detail, impact });
  };

  if (!subjectTrim) {
    add(
      "missing-subject",
      "negative",
      "Missing subject",
      "Empty subject lines often get flagged or ignored.",
      -18,
    );
  } else {
    checksRun += 1;

    if (subjectTrim.length > 60) {
      add(
        "subject-long",
        "warning",
        "Long subject line",
        "Keep subjects under ~60 characters so they display fully on mobile.",
        -6,
      );
    } else if (subjectTrim.length <= 60 && subjectTrim.length >= 8) {
      add(
        "subject-length-ok",
        "positive",
        "Subject length looks good",
        "Short, readable subject lines perform better in cold outreach.",
        4,
      );
    }

    if (/^(re:|fwd:|fw:)/iu.test(subjectTrim)) {
      add(
        "fake-thread",
        "negative",
        "Fake reply prefix",
        "Starting with Re:/Fwd: mimics an existing thread and hurts trust.",
        -22,
      );
    }

    if (subjectTrim === subjectTrim.toUpperCase() && subjectTrim.length > 4) {
      add(
        "subject-all-caps",
        "negative",
        "Subject in ALL CAPS",
        "All-caps subjects are a common spam filter signal.",
        -16,
      );
    }

    if (/[!?]{2,}/u.test(subjectTrim)) {
      add(
        "subject-punctuation",
        "warning",
        "Heavy punctuation in subject",
        "Multiple ! or ? marks can look promotional.",
        -8,
      );
    }

    if (hasPersonalization(subjectTrim)) {
      add(
        "subject-personalized",
        "positive",
        "Personalized subject",
        "Using {name} in the subject helps this feel one-to-one.",
        6,
      );
    }
  }

  if (!bodyTrim) {
    add(
      "missing-body",
      "negative",
      "Missing body",
      "An empty message will not send meaningfully.",
      -25,
    );
  } else {
    checksRun += 1;
    const wordCount = bodyTrim.split(/\s+/u).filter(Boolean).length;

    if (wordCount < 20) {
      add(
        "body-short",
        "warning",
        "Very short body",
        "Ultra-short cold emails can look automated or suspicious.",
        -5,
      );
    } else if (wordCount >= 40 && wordCount <= 180) {
      add(
        "body-length-ok",
        "positive",
        "Good email length",
        "Concise but substantive — typical for effective cold outreach.",
        5,
      );
    } else if (wordCount > 250) {
      add(
        "body-long",
        "warning",
        "Long email body",
        "Long walls of text reduce replies and can trigger filters at volume.",
        -6,
      );
    }

    const nameTokens = countPersonalizationTokens(bodyTrim);
    if (nameTokens >= 1) {
      add(
        "body-personalized",
        "positive",
        "Personalized greeting",
        "Using {name} signals a hand-written note rather than a blast.",
        8,
      );
    } else {
      add(
        "body-generic",
        "warning",
        "No personalization tokens",
        "Add {name} or {profession} so each send feels individual.",
        -10,
      );
    }

    if (/\?[\s\S]*$/u.test(bodyTrim.trim())) {
      add(
        "soft-cta",
        "positive",
        "Conversational close",
        "Ending with a question feels human and less salesy than hard CTAs.",
        4,
      );
    }

    if (/^(hi there|hello there|dear customer|to whom it may concern)/iu.test(bodyTrim)) {
      add(
        "generic-greeting",
        "warning",
        "Generic greeting",
        "Replace broad greetings with the recipient's name.",
        -8,
      );
    }

    const allCapsWords = countMatches(bodyTrim, /\b[A-Z]{4,}\b/gu);
    if (allCapsWords > 0) {
      add(
        "body-all-caps",
        "warning",
        "ALL CAPS emphasis",
        `${allCapsWords} word${allCapsWords === 1 ? "" : "s"} in all caps can look shouty or spammy.`,
        -Math.min(12, allCapsWords * 4),
      );
    }

    const exclamations = countMatches(bodyTrim, /!/gu);
    if (exclamations >= 3) {
      add(
        "many-exclamations",
        "warning",
        "Many exclamation marks",
        "More than two exclamation marks often correlates with promotional mail.",
        -Math.min(10, exclamations * 2),
      );
    }

    const linkCount = countMatches(bodyTrim, URL_PATTERN);
    if (linkCount === 0) {
      add(
        "no-links",
        "positive",
        "No links in body",
        "Plain-text cold emails without links are less likely to be filtered.",
        5,
      );
    } else if (linkCount === 1) {
      add(
        "one-link",
        "warning",
        "Link included",
        "A single link is fine — make sure it is their site, not a tracker.",
        -3,
      );
    } else {
      add(
        "many-links",
        "negative",
        "Multiple links",
        `${linkCount} links increase spam-score weight for cold mail.`,
        -Math.min(18, linkCount * 6),
      );
    }

    if (HTML_TAG_PATTERN.test(bodyTrim)) {
      add(
        "html-tags",
        "negative",
        "HTML markup detected",
        "Gmail compose works best as plain text for cold outreach.",
        -12,
      );
    }

    if (/\b(bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly)\b/iu.test(bodyTrim)) {
      add(
        "url-shortener",
        "negative",
        "URL shortener detected",
        "Short links are heavily associated with spam and phishing.",
        -20,
      );
    }
  }

  for (const phrase of HIGH_SPAM_PHRASES) {
    if (containsPhrase(combined, phrase)) {
      add(
        `spam-phrase-${phrase.replaceAll(/\s+/gu, "-")}`,
        "negative",
        `Spam trigger: “${phrase}”`,
        "This phrase appears frequently in filtered marketing mail.",
        -9,
      );
    }
  }

  let salesHits = 0;
  for (const phrase of SALES_PHRASES) {
    if (containsPhrase(combined, phrase)) {
      salesHits += 1;
    }
  }

  if (salesHits >= 3) {
    add(
      "sales-density",
      "warning",
      "Sales-heavy language",
      `${salesHits} promotional phrases detected — soften the pitch for cold mail.`,
      -Math.min(12, salesHits * 3),
    );
  } else if (salesHits >= 1 && salesHits <= 2) {
    add(
      "mild-sales",
      "warning",
      "Some promotional wording",
      "A little sales language is expected — balance it with specificity about them.",
      -4,
    );
  }

  if (containsPhrase(combined, "no charge") || containsPhrase(combined, "free")) {
    add(
      "free-offer",
      "warning",
      "Free / no-charge offer",
      "“Free” offers are common in spam — frame as a specific mockup you already made.",
      -5,
    );
  }

  const inboxScore = clamp(Math.round(score), 5, 98);
  const spamRiskPercent = clamp(100 - inboxScore, 2, 95);
  const riskLevel = riskLevelFromScore(inboxScore);
  const negativeCount = signals.filter((s) => s.kind === "negative").length;
  const confidencePercent = clamp(
    55 + checksRun * 3 + signals.length * 2,
    60,
    92,
  );

  return {
    inboxScore,
    spamRiskPercent,
    riskLevel,
    confidencePercent,
    signals: signals.sort((a, b) => {
      const order = { negative: 0, warning: 1, positive: 2 };
      return order[a.kind] - order[b.kind];
    }),
    summary: summaryForReport(inboxScore, riskLevel, negativeCount),
  };
}

export const RISK_LABELS: Record<SpamRiskLevel, string> = {
  low: "Low spam risk",
  medium: "Medium spam risk",
  high: "High spam risk",
};

export const RISK_STYLES: Record<
  SpamRiskLevel,
  { ring: string; bar: string; text: string; badge: string }
> = {
  low: {
    ring: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-800 dark:text-emerald-200",
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
  },
  medium: {
    ring: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-800 dark:text-amber-200",
    badge:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
  },
  high: {
    ring: "text-rose-600 dark:text-rose-400",
    bar: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-800 dark:text-rose-200",
    badge:
      "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100",
  },
};

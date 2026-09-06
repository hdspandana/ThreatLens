/**
 * Deterministic threat/abuse signal extraction.
 *
 * This is a RULE-BASED detector (regex + lexicon), not a trained classifier.
 * It is intentionally transparent: every match records the exact pattern
 * category, the triggering text span, and a fixed, documented confidence
 * value. It is a recall-oriented baseline meant to surface candidate signals
 * for human review -- it does NOT determine that a crime occurred.
 *
 * Confidence values are hand-assigned on a simple scale:
 *   0.85-0.95 : highly specific phrase pattern, low false-positive rate
 *   0.55-0.75 : moderately specific pattern or keyword combination
 *   0.30-0.50 : single-keyword heuristic, higher false-positive rate
 * These are heuristic weights, not calibrated probabilities.
 */
import type { SignalCategoryT, ThreatSignal } from "../schemas/models";
import { makeProvenance, VERSIONS, textRef } from "../provenance";

/** Version of this rule set. Bump when any pattern/confidence changes. */
export const RULE_SET_VERSION = VERSIONS.ruleSet;

interface SignalPattern {
  /** Stable rule id (category.NN). Recorded on every signal for reproducibility; never renumber. */
  id: string;
  category: SignalCategoryT;
  regex: RegExp;
  confidence: number;
  explanation: string;
}

const PATTERNS: SignalPattern[] = [
  // --- direct_threat ---------------------------------------------------
  {
    id: "direct_threat.01",
    category: "direct_threat",
    regex: /\bi(?:'m| am)?\s*(?:going to|gonna|will)\s+(?:kill|hurt|beat|stab|shoot|choke|strangle|destroy)\s+you\b/gi,
    confidence: 0.92,
    explanation: "Explicit first-person statement of intent to physically harm the recipient.",
  },
  {
    id: "direct_threat.02",
    category: "direct_threat",
    regex: /\byou('re| are)?\s*(?:going to|gonna)\s+(?:die|get hurt|regret)\b/gi,
    confidence: 0.75,
    explanation: "Statement framing physical harm or death as a near-certain outcome for the recipient.",
  },
  {
    id: "direct_threat.03",
    category: "direct_threat",
    regex: /\bi (?:have|own|got) a (?:gun|knife|weapon)\b/gi,
    confidence: 0.6,
    explanation: "Reference to weapon possession in a message directed at the recipient.",
  },

  // --- intimidation ------------------------------------------------------
  {
    id: "intimidation.01",
    category: "intimidation",
    regex: /\byou('ll| will) regret (this|it)\b/gi,
    confidence: 0.65,
    explanation: "Vague but menacing statement implying future negative consequences.",
  },
  {
    id: "intimidation.02",
    category: "intimidation",
    regex: /\bi know where you (live|work|are)\b/gi,
    confidence: 0.8,
    explanation: "Statement asserting knowledge of the recipient's physical location, used to instill fear.",
  },
  {
    id: "intimidation.03",
    category: "intimidation",
    regex: /\bwatch your back\b/gi,
    confidence: 0.7,
    explanation: "Common intimidation idiom implying threat of retaliation.",
  },

  // --- coercion ------------------------------------------------------
  {
    id: "coercion.01",
    category: "coercion",
    regex: /\bif you don't\b[^.!?\n]{0,60}\bi('ll| will)\b/gi,
    confidence: 0.7,
    explanation: "Conditional 'if you don't X, I will Y' structure indicating coercive pressure.",
  },
  {
    id: "coercion.02",
    category: "coercion",
    regex: /\bdo (?:what i say|as i say|this)\s*or (?:else)?\b/gi,
    confidence: 0.65,
    explanation: "Demand paired with an implied negative consequence for non-compliance.",
  },

  // --- extortion / blackmail ------------------------------------------------------
  {
    id: "extortion.01",
    category: "extortion",
    regex: /\b(?:pay|send)\s*(?:me)?\s*\$?\d+[^.!?\n]{0,40}\bor i('ll| will)\b/gi,
    confidence: 0.85,
    explanation: "Explicit monetary demand tied to a threatened consequence.",
  },
  {
    id: "blackmail.01",
    category: "blackmail",
    regex: /\b(?:i will|i'll) (?:post|share|leak|send|release)[^.!?\n]{0,40}(photos?|pics?|video|screenshots?|nudes?|information)\s*(?:unless|if you don't)\b/gi,
    confidence: 0.9,
    explanation: "Threat to release private material unless a condition (typically payment or compliance) is met.",
  },
  {
    id: "blackmail.02",
    category: "blackmail",
    regex: /\bunless you\b[^.!?\n]{0,60}\bi (?:will|'ll) (?:post|share|leak|tell|send)\b/gi,
    confidence: 0.85,
    explanation: "Conditional threat to expose material or information unless a demand is met.",
  },

  // --- stalking indicators ------------------------------------------------------
  {
    id: "stalking.01",
    category: "stalking",
    regex: /\bi (?:saw|followed|been watching|am watching|have been watching) you\b/gi,
    confidence: 0.85,
    explanation: "Statement indicating covert observation or following of the recipient.",
  },
  {
    id: "stalking.02",
    category: "stalking",
    regex: /\bi (?:drove|walked|went) (?:by|past) your (?:house|home|work|school)\b/gi,
    confidence: 0.8,
    explanation: "Reference to physically visiting the recipient's home/work/school without consent context.",
  },
  {
    id: "stalking.03",
    category: "stalking",
    regex: /\bwhere are you right now\b/gi,
    confidence: 0.35,
    explanation: "Request for real-time location; weak signal alone but relevant combined with other indicators.",
  },

  // --- sexual_harassment ------------------------------------------------------
  {
    id: "sexual_harassment.01",
    category: "sexual_harassment",
    regex: /\bsend (?:me\s*)?(?:nudes?|naked pics?|nude pics?)\b/gi,
    confidence: 0.9,
    explanation: "Unsolicited request for sexually explicit images.",
  },
  {
    id: "sexual_harassment.02",
    category: "sexual_harassment",
    regex: /\bi (?:want to|wanna) (?:have sex with|sleep with) you\b/gi,
    confidence: 0.55,
    explanation: "Unsolicited sexual proposition; context determines whether it is unwanted.",
  },

  // --- hate_abusive_language ------------------------------------------------------
  {
    id: "hate_abusive_language.01",
    category: "hate_abusive_language",
    regex: /\b(?:you'?re|you are)\s+(?:worthless|pathetic|disgusting|a whore|a slut|an idiot|stupid|ugly|garbage|trash)\b/gi,
    confidence: 0.6,
    explanation: "Direct demeaning insult targeted at the recipient.",
  },
  {
    id: "hate_abusive_language.02",
    category: "hate_abusive_language",
    regex: /\bkill yourself\b/gi,
    confidence: 0.9,
    explanation: "Direct incitement of self-harm, a severe form of abusive language.",
  },
  {
    id: "hate_abusive_language.03",
    category: "hate_abusive_language",
    regex: /\bnobody (?:likes|loves|wants) you\b/gi,
    confidence: 0.4,
    explanation: "Demeaning statement intended to isolate or demoralize the recipient.",
  },

  // --- impersonation ------------------------------------------------------
  {
    id: "impersonation.01",
    category: "impersonation",
    regex: /\bthis is (?:the police|the irs|your bank|customer support|tech support)\b/gi,
    confidence: 0.55,
    explanation: "Claim of authority/identity commonly associated with impersonation scams.",
  },
  {
    id: "impersonation.02",
    category: "impersonation",
    regex: /\bi am (?:contacting you on behalf of|calling from)\b/gi,
    confidence: 0.35,
    explanation: "Framing associated with impersonation of an organization; requires context to confirm.",
  },

  // --- repeated_unwanted_contact ------------------------------------------------------
  {
    id: "repeated_unwanted_contact.01",
    category: "repeated_unwanted_contact",
    regex: /\b(?:answer (?:me|your phone)|pick up the phone|why (?:aren't|are not) you (?:answering|responding))\b/gi,
    confidence: 0.4,
    explanation: "Language pressuring an immediate response, consistent with repeated unwanted contact.",
  },
  {
    id: "repeated_unwanted_contact.02",
    category: "repeated_unwanted_contact",
    regex: /\b\d{2,}\s*(?:missed calls?|texts?|messages?)\b/gi,
    confidence: 0.55,
    explanation: "Explicit reference to a high volume of contact attempts.",
  },
  {
    id: "repeated_unwanted_contact.03",
    category: "repeated_unwanted_contact",
    regex: /\bstop (?:ignoring|avoiding) me\b/gi,
    confidence: 0.45,
    explanation: "Statement indicating the sender is persisting despite the recipient's disengagement.",
  },

  // --- suspicious_demand ------------------------------------------------------
  {
    id: "suspicious_demand.01",
    category: "suspicious_demand",
    regex: /\b(?:gift cards?|bitcoin|crypto|wire transfer|western union|venmo|cash ?app)\b/gi,
    confidence: 0.4,
    explanation: "Mention of a payment method commonly associated with scams or extortion demands.",
  },
  {
    id: "suspicious_demand.02",
    category: "suspicious_demand",
    regex: /\bsend (?:me\s*)?\$\d+/gi,
    confidence: 0.45,
    explanation: "Direct monetary demand of a specific amount.",
  },
];

/**
 * Scans normalized text for all configured patterns and returns one
 * ThreatSignal per match, including its exact character span so the UI can
 * highlight the triggering text.
 */
export function detectSignals(normalizedText: string): ThreatSignal[] {
  if (!normalizedText || normalizedText.trim().length === 0) return [];

  const signals: ThreatSignal[] = [];
  const inputRef = textRef(normalizedText);
  const timestamp = new Date().toISOString();
  for (const pattern of PATTERNS) {
    // Ensure the 'g' flag is present so exec() advances through the string.
    const flags = pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g";
    const re = new RegExp(pattern.regex.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(normalizedText)) !== null) {
      signals.push({
        category: pattern.category,
        evidenceSpan: match[0],
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        confidence: pattern.confidence,
        explanation: pattern.explanation,
        detectionSource: "rule_based",
        detectorId: pattern.id,
        provenance: makeProvenance({
          status: "INFERRED",
          sourceType: "RULE",
          sourceId: pattern.id,
          sourceVersion: RULE_SET_VERSION,
          confidence: pattern.confidence,
          explanation: `Deterministic regex rule ${pattern.id} matched the verified text.`,
          derivedFrom: [inputRef],
          timestamp,
        }),
      });
      if (match[0].length === 0) re.lastIndex += 1; // guard against zero-width infinite loops
    }
  }

  // Stable sort by position in the text for a readable, deterministic UI order.
  signals.sort((a, b) => a.startOffset - b.startOffset);
  return signals;
}

/** Exposes rule ids for evaluation tooling and documentation. */
export function listRuleIds(): string[] {
  return PATTERNS.map((p) => p.id);
}

export const ALL_SIGNAL_CATEGORIES: SignalCategoryT[] = Array.from(
  new Set(PATTERNS.map((p) => p.category))
);

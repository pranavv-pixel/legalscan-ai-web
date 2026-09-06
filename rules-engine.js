/* rules-engine.js
   Extraction heuristics + rule-based compliance checking.
   Rules themselves live in rules.json / localStorage, not hardcoded here —
   this file only contains the (fixed) extraction patterns and the (data-driven) scoring logic.
*/

const DEFAULT_RULES_URL = "rules.json";

async function loadRules() {
  const saved = localStorage.getItem("legalscan_rules");
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { /* fall through */ }
  }
  const res = await fetch(DEFAULT_RULES_URL);
  const rules = await res.json();
  localStorage.setItem("legalscan_rules", JSON.stringify(rules));
  return rules;
}

function saveRules(rules) {
  localStorage.setItem("legalscan_rules", JSON.stringify(rules));
}

async function resetRules() {
  const res = await fetch(DEFAULT_RULES_URL);
  const rules = await res.json();
  localStorage.setItem("legalscan_rules", JSON.stringify(rules));
  return rules;
}

/* ---------- Field extraction from raw OCR text ---------- */

const FIELD_PATTERNS = {
  mrp: /(?:MRP|Maximum\s+Retail\s+Price)[^\d₹]{0,20}(₹|Rs\.?|INR)?\s?([\d,]+(?:\.\d{1,2})?)/i,
  netQuantity: /(?:Net\s?(?:Qty|Quantity|Wt|Weight)\.?)[^\d]{0,12}([\d.]+)\s?(g|gm|gms|kg|kgs|ml|l|litre|litres|mg)\b/i,
  mfgDate: /(?:Mfg|Manufactur(?:ed|ing)|Pkd|Packed(?:\s+on)?|Date\s+of\s+Mfg|Import(?:ed)?)[^\d]{0,15}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|[A-Za-z]{3,9}\s?\d{4}|\d{4})/i,
  manufacturer: /(?:Manufactured\s+by|Marketed\s+by|Packed\s+by|Mfd\s+by|Imported\s+by)\s*[:\-]?\s*([^\n]{6,120})/i,
  consumerCare: /(?:Consumer\s+Care|Customer\s+Care|Toll[- ]?Free|Helpline|For\s+complaints)[^\n]{0,80}((?:\+?\d[\d\s\-]{7,}\d)|(?:[\w.+-]+@[\w-]+\.[a-z]{2,}))/i,
  countryOfOrigin: /(?:Country\s+of\s+Origin|Made\s+in|Manufactured\s+in)\s*[:\-]?\s*([A-Za-z][A-Za-z .]{2,30})/i
};

// Build a fallback regex that looks for a Hindi/regional label word and grabs
// whatever follows it, so bilingual labels (very common on Indian packaging)
// are still detected even if the English pattern above doesn't match.
function buildHindiPattern(keywords) {
  if (!keywords || !keywords.length) return null;
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("(?:" + escaped.join("|") + ")\\s*[:\\-]?\\s*([^\\n]{2,80})", "i");
}

// crude unit-ambiguity check, uses rules.disallowedAmbiguousUnits
function unitIsAmbiguous(unit, rules) {
  if (!unit) return false;
  return rules.disallowedAmbiguousUnits.some(u => u.toLowerCase() === unit.toLowerCase());
}

/**
 * Given full OCR text and per-word confidence/box data (Tesseract 'data.words'),
 * extract each required field, its matched substring, and an estimated confidence
 * (average confidence of the OCR words that overlap the match).
 */
function extractFields(fullText, words, imageHeight, rules) {
  const results = {};

  for (const field of rules.requiredFields) {
    const pattern = FIELD_PATTERNS[field.id];
    let match = pattern ? fullText.match(pattern) : null;
    let value = null, confidence = null, prominenceRatio = null, ambiguousUnit = false, matchedLanguage = "en";

    if (match) {
      value = match[0].trim();
      confidence = estimateConfidenceForMatch(value, words);
      if (field.id === "netQuantity" && match[2]) {
        ambiguousUnit = unitIsAmbiguous(match[2], rules);
      }
      prominenceRatio = estimateProminence(value, words, imageHeight);
    } else {
      // Fallback: try to find the field via its Hindi / regional label instead.
      const hindiPattern = buildHindiPattern((rules.hindiKeywords || {})[field.id]);
      const hindiMatch = hindiPattern ? fullText.match(hindiPattern) : null;
      if (hindiMatch) {
        match = hindiMatch;
        value = hindiMatch[0].trim();
        matchedLanguage = "hi";
        confidence = estimateConfidenceForMatch(value, words);
        prominenceRatio = estimateProminence(value, words, imageHeight);
      }
    }

    results[field.id] = {
      label: field.label,
      severity: field.severity,
      hint: field.hint,
      found: !!match,
      value,
      confidence,
      prominenceRatio,
      ambiguousUnit,
      matchedLanguage
    };
  }
  return results;
}

// Average confidence of OCR words whose text appears inside the matched value string
function estimateConfidenceForMatch(value, words) {
  if (!words || !words.length) return null;
  const tokens = value.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const hits = words.filter(w => tokens.some(t => w.text && w.text.toLowerCase().includes(t.slice(0, Math.min(4, t.length)))));
  if (!hits.length) return null;
  const avg = hits.reduce((s, w) => s + (w.confidence || 0), 0) / hits.length;
  return Math.round(avg);
}

// Rough font-prominence proxy: tallest matching word's bbox height / image height
function estimateProminence(value, words, imageHeight) {
  if (!words || !words.length || !imageHeight) return null;
  const tokens = value.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const hits = words.filter(w => tokens.some(t => w.text && w.text.toLowerCase().includes(t.slice(0, Math.min(4, t.length)))));
  if (!hits.length) return null;
  const heights = hits.map(w => (w.bbox.y1 - w.bbox.y0));
  const maxH = Math.max(...heights);
  return +(maxH / imageHeight).toFixed(4);
}

/**
 * Combine per-field results into an overall verdict.
 * Returns { status, score, criticalMissing, minorIssues, needsReview }
 */
function scoreInspection(fieldResults, rules) {
  const fields = Object.values(fieldResults);
  let criticalMissing = 0, minorIssues = 0, needsReview = 0, totalWeight = 0, earnedWeight = 0;

  fields.forEach(f => {
    const weight = f.severity === "critical" ? 2 : 1;
    totalWeight += weight;

    if (!f.found) {
      if (f.severity === "critical") criticalMissing++; else minorIssues++;
      return; // 0 credit
    }

    let credit = weight;

    if (f.confidence !== null && f.confidence < rules.minOcrConfidence) {
      needsReview++;
      credit *= 0.5; // low confidence -> half credit, flagged for manual review
    }
    if (f.ambiguousUnit) {
      minorIssues++;
      credit *= 0.5;
    }
    if (f.prominenceRatio !== null && f.prominenceRatio < rules.minFontProminenceRatio) {
      minorIssues++;
      credit *= 0.75;
    }
    earnedWeight += credit;
  });

  const score = totalWeight ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  let status;
  if (criticalMissing > 0) status = "Non-Compliant";
  else if (needsReview > 0 || minorIssues > 0) status = "Needs Review";
  else status = "Compliant";

  return { status, score, criticalMissing, minorIssues, needsReview };
}

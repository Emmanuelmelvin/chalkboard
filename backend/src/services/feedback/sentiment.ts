/**
 * Sentiment for the admin feedback console, derived heuristically.
 *
 * No LLM is involved: room ratings map directly to a sentiment bucket, and
 * submission text is scored against small curated word lists with basic
 * negation handling and a per-category bias. This is enough to surface
 * trends at a glance; swap the scoring body for a model-backed job later
 * without changing the call sites.
 */

export type FeedbackSentiment = 'positive' | 'neutral' | 'negative';

const NEGATIVE_WORDS = [
  'crash', 'crashed', 'crashes', 'broken', 'break', 'breaks', 'bug', 'bugs',
  'fails', 'failed', 'failure', 'error', 'errors', 'freeze', 'freezes',
  'frozen', 'stuck', 'lag', 'laggy', 'slow', 'useless', 'awful', 'terrible',
  'horrible', 'frustrating', 'frustrated', 'annoying', 'annoyed',
  'disappointed', 'disappointing', 'hate', 'worse', 'worst', 'impossible',
  'missing', 'unusable', 'confusing', 'confused', 'furious', 'angry',
  'unable', 'glitch', 'glitchy', 'spam', 'scam', 'waste', 'never works',
  'not working', "doesn't work", "doesn't work anymore", "can't use",
  'cannot use', 'broken again', 'disgusting',
];

const POSITIVE_WORDS = [
  'great', 'awesome', 'amazing', 'love', 'loved', 'excellent', 'perfect',
  'fantastic', 'wonderful', 'thanks', 'thank', 'works', 'working',
  'works well', 'works perfectly', 'helpful', 'best', 'nice', 'good',
  'useful', 'solved', 'fixed', 'impressed', 'smooth', 'easy', 'brilliant',
  'outstanding', 'happy', 'liked', 'enjoy', 'beautiful', 'seamless',
  'recommend', 'well done', 'amazingly', 'work',
];

const NEGATIONS = [
  'not ', 'no ', "don't ", 'dont ', "doesn't ", 'doesnt ', "can't ", 'cant ',
  'never ', "isn't ", 'isnt ', 'wasn\'t ', 'wasnt ', 'without ',
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(text: string, word: string) {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(text);
}

/** Score free-text feedback into positive / neutral / negative buckets. */
export function sentimentFromText(
  message: string,
  category: 'bug_report' | 'feature_request' | 'general',
): FeedbackSentiment {
  const text = message.toLowerCase();
  let score = 0;

  for (const word of NEGATIVE_WORDS) {
    if (containsWord(text, word)) score -= 1;
  }

  for (const word of POSITIVE_WORDS) {
    if (!containsWord(text, word)) continue;
    // A negated positive ("not good", "no thanks") reads as a complaint.
    const negated = NEGATIONS.some((prefix) => containsWord(text, `${prefix}${word}`));
    score += negated ? -1 : 1;
  }

  // Bug reports without strong language still skew negative; feature
  // requests are usually constructive, so leave them neutral alone.
  if (category === 'bug_report') score -= 0.5;

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

/** Map a 1-5 star session rating to a sentiment bucket. */
export function sentimentFromRating(rating: number): FeedbackSentiment {
  if (rating >= 4) return 'positive';
  if (rating >= 2) return 'neutral';
  return 'negative';
}
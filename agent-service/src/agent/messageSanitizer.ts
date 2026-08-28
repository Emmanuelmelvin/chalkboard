/**
 * @file messageSanitizer.ts
 * @description Sanitizes and validates messages from LLM to ensure no raw JSON,
 * tool dumps, or stack traces leak into classroom chat.
 */

export function sanitizeChatMessage(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;

  let cleaned = text.trim();
  if (!cleaned) return null;

  // 1. If text is wrapped in markdown json code fences (```json ... ``` or ``` ... ```)
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    // If the inner code block is pure JSON, check if it contains a human message or is a raw tool dump
    try {
      const parsed = JSON.parse(inner);
      if (typeof parsed === 'string') {
        cleaned = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (typeof parsed.message === 'string') {
          cleaned = parsed.message;
        } else if (typeof parsed.text === 'string') {
          cleaned = parsed.text;
        } else if (typeof parsed.response === 'string') {
          cleaned = parsed.response;
        } else {
          // It is a raw JSON payload (e.g. tool error or output dict) -> DO NOT send to chat
          return null;
        }
      }
    } catch {
      // Not valid JSON inside code block, use inner text if not technical code
      cleaned = inner;
    }
  }

  // 2. If entire text is raw JSON object or array: e.g. {"error": ...} or {"output": ...}
  if ((cleaned.startsWith('{') && cleaned.endsWith('}')) || (cleaned.startsWith('[') && cleaned.endsWith(']'))) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.message === 'string') {
          cleaned = parsed.message;
        } else if (typeof parsed.text === 'string') {
          cleaned = parsed.text;
        } else if (typeof parsed.response === 'string') {
          cleaned = parsed.response;
        } else {
          // Raw JSON dump -> filter out completely
          return null;
        }
      }
    } catch {
      // If parsing fails but it looks like a raw JSON error dump, filter it out
      if (cleaned.includes('"error"') || cleaned.includes('"success":') || cleaned.includes('"functionResponse":')) {
        return null;
      }
    }
  }

  // 3. Strip internal meta prefixes like "Actions Taken:", "### Actions Taken", "Tool Output:"
  cleaned = cleaned
    .replace(/^(?:###\s*)?Actions\s+Taken:?[\s\S]*?(?=\n\n|$)/i, '')
    .replace(/^Tool\s+Output:?[\s\S]*?(?=\n\n|$)/i, '')
    .replace(/^Result:?[\s\S]*?(?=\n\n|$)/i, '')
    .trim();

  // 4. If text starts with technical error signatures, return friendly fallback or null
  if (/^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|APIError|AxiosError):/i.test(cleaned)) {
    return 'I ran into a small issue processing that action. Would you like me to try again?';
  }

  return cleaned.length > 0 ? cleaned : null;
}

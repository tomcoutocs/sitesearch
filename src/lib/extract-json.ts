export function extractLikelyJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body);
}

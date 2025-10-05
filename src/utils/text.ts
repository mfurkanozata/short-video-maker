export function stripBracketDirectives(input: string): string {
  if (!input) return "";
  // Remove bracketed directives like [excited], [laughs], [music], etc.
  // Keep actual text and normalize whitespace
  const withoutDirectives = input.replace(/\[[^\]]+\]/g, "");
  return withoutDirectives.replace(/\s+/g, " ").trim();
}



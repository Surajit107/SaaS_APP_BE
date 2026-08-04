/**
 * Escapes a user-supplied fragment so it is treated as a literal in a Mongo `$regex`.
 */
export function escapeMongoRegexLiteral(fragment: string): string {
  return fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

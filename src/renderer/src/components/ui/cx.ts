/** 条件拼接 className：过滤 false / null / undefined，避免空档位。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

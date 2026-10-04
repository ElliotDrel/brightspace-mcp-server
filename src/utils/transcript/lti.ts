/** Identify D2L LTI quickLinks without launching them or disclosing session parameters. */
export function brightspaceLtiLaunchUrl(value: string): string | null {
  const relative = value.startsWith("/") && !value.startsWith("//");
  let parsed: URL;
  try {
    parsed = new URL(value, relative ? "https://brightspace.invalid" : undefined);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (!/^\/d2l\/common\/dialogs\/quicklink\/quicklink\.d2l$/i.test(parsed.pathname)) return null;
  if (parsed.searchParams.get("type")?.toLowerCase() !== "lti") return null;
  for (const key of [...parsed.searchParams.keys()]) {
    if (["d2lsessionval", "d2lsecuresessionval", "_"].includes(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
}

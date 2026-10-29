/** Copy text without throwing: a missing or refusing clipboard (plain-HTTP LAN) reports false. */
export async function copyText(
  text: string,
  clipboard?: Pick<Clipboard, "writeText">,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

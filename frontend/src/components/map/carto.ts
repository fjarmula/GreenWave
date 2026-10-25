/** Add the public browser key to CARTO basemap resources only. */
export function cartoRequestUrl(url: string, apiKey: string): string {
  if (!apiKey) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "basemaps.cartocdn.com" &&
      !parsed.hostname.endsWith(".basemaps.cartocdn.com"))
  ) {
    return url;
  }
  parsed.searchParams.set("key", apiKey);
  return parsed.toString();
}

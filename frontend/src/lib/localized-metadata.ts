import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, resolveLanguage, translate } from "./localization";

export async function pageMetadata(title: string) {
  const language = resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return { title: translate(title, language) };
}

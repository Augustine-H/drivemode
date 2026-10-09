import type { FetchMessageObject, ImapFlow } from "imapflow";

export const NAVER_SEARCH_RECENT_LIMIT = 100;
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR");

export function naverEnvelopeMatches(row: FetchMessageObject, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return false;
  // ImapFlow decodes MIME encoded words in ENVELOPE; never compare raw headers.
  const fields = [
    row.envelope?.subject || "",
    ...(row.envelope?.from || []).flatMap((person) => [person.name || "", person.address || ""]),
  ];
  return fields.some((value) => normalize(value).includes(needle));
}

export async function searchNaverRows(client: ImapFlow, query: string, unread: boolean) {
  const flags = unread ? { seen: false } : {};
  const serverMatches = await client.search(
    { ...(query ? { text: query } : { all: true }), ...flags },
    { uid: true },
  );
  const nativeUids = Array.isArray(serverMatches) ? serverMatches : [];
  if (!query) {
    const uids = nativeUids.sort((a, b) => b - a).slice(0, 20);
    return uids.length
      ? client.fetchAll(uids, { uid: true, envelope: true, flags: true }, { uid: true })
      : [];
  }

  // Preserve whole-mailbox server matches (including body matches), and supplement
  // them with decoded recent headers even when SEARCH returns some other matches.
  const candidates = await client.search({ all: true, ...flags }, { uid: true });
  const recent = (Array.isArray(candidates) ? candidates : [])
    .sort((a, b) => b - a)
    .slice(0, NAVER_SEARCH_RECENT_LIMIT);
  const serverTop = nativeUids.sort((a, b) => b - a).slice(0, 20);
  const uids = [...new Set([...recent, ...serverTop])];
  if (!uids.length) return [];
  const nativeSet = new Set(nativeUids);
  const rows = await client.fetchAll(uids, { uid: true, envelope: true, flags: true }, { uid: true });
  return rows
    .filter((row) => (!unread || !row.flags?.has("\\Seen")) &&
      (nativeSet.has(row.uid) || naverEnvelopeMatches(row, query)))
    .sort((a, b) => b.uid - a.uid)
    .slice(0, 20);
}

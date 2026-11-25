import { assertNoEntityDeclarations, createXmlParser, FeedParseError } from './parser.js';
import { htmlToText, safeHttpUrl } from './sanitize.js';

export const OPML_MAX_BYTES = 1024 * 1024;
export const OPML_MAX_OUTLINES = 500;

export interface OpmlEntry {
  url: string;
  title: string | null;
  /** Category hint from parent outlines or attributes (lower-case), if any. */
  hint: string;
}

type Outline = Record<string, unknown>;

/** Extracts feed outlines (`xmlUrl`) from an OPML document, depth-first. */
export function parseOpml(text: string): { entries: OpmlEntry[]; invalid: number } {
  if (Buffer.byteLength(text) > OPML_MAX_BYTES) throw new FeedParseError('OPML file too large');
  assertNoEntityDeclarations(text);
  let doc: Record<string, unknown>;
  try {
    doc = createXmlParser().parse(text) as Record<string, unknown>;
  } catch {
    throw new FeedParseError('Invalid OPML');
  }
  const body = (doc.opml as Outline | undefined)?.body as Outline | undefined;
  if (!body) throw new FeedParseError('Invalid OPML');

  const entries: OpmlEntry[] = [];
  let invalid = 0;
  let visited = 0;

  const walk = (outlines: unknown, parentHint: string, depth: number): void => {
    if (!Array.isArray(outlines) || depth > 10) return;
    for (const outline of outlines as Outline[]) {
      if (++visited > OPML_MAX_OUTLINES) throw new FeedParseError('Too many outlines');
      const label = String(outline['@_title'] ?? outline['@_text'] ?? '');
      const hint = `${parentHint} ${label} ${String(outline['@_category'] ?? '')}`.toLowerCase();
      const xmlUrl = outline['@_xmlUrl'];
      if (typeof xmlUrl === 'string') {
        const url = safeHttpUrl(xmlUrl);
        const parsed = url ? new URL(url) : undefined;
        // Credentials in feed URLs would be stored and shown in plain text (and are refused on fetch anyway).
        if (parsed && !parsed.username && !parsed.password) {
          entries.push({ url: parsed.toString(), title: htmlToText(label, 200) || null, hint });
        } else invalid++;
      }
      walk(outline.outline, hint, depth + 1);
    }
  };
  walk(body.outline, '', 0);
  return { entries, invalid };
}

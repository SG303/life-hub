import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { htmlToText, safeHttpUrl, truncate } from './sanitize.js';

export interface ParsedItem {
  guid: string | null;
  videoId: string | null;
  link: string | null;
  title: string;
  summary: string;
  publishedAt: string | null;
  hasAudio: boolean;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  isPodcast: boolean;
  items: ParsedItem[];
}

export class FeedParseError extends Error {}

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'enclosure', 'outline', 'category']);

export function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    htmlEntities: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  });
}

/** Rejects documents that declare entities (XXE / entity expansion attacks). */
export function assertNoEntityDeclarations(xml: string): void {
  if (/<!ENTITY/i.test(xml)) throw new FeedParseError('XML with entity declarations is not accepted');
}

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | undefined {
  if (Array.isArray(value)) return asNode(value[0]);
  return typeof value === 'object' && value !== null ? (value as Node) : undefined;
}

/** Text content of an element that may be a string, number or `{ '#text': ... }`. */
export function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return textOf((value as Node)['#text']);
  return '';
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function atomLink(links: unknown, base: string | undefined): string | null {
  if (!Array.isArray(links)) return safeHttpUrl(textOf(links), base);
  const nodes = links.map((link) => (typeof link === 'string' ? { '#text': link } : (link as Node)));
  const preferred =
    nodes.find((link) => (link['@_rel'] ?? 'alternate') === 'alternate' && link['@_href']) ??
    nodes.find((link) => link['@_href']) ??
    nodes.find((link) => textOf(link));
  if (!preferred) return null;
  return safeHttpUrl(String(preferred['@_href'] ?? textOf(preferred)), base);
}

function title(value: unknown): string {
  return truncate(htmlToText(textOf(value), 1000).replace(/\s+/g, ' '), 300) || '(ohne Titel)';
}

function hasAudioEnclosure(item: Node): boolean {
  const enclosures = Array.isArray(item.enclosure) ? (item.enclosure as Node[]) : [];
  const links = Array.isArray(item.link) ? (item.link as unknown[]) : [];
  const enclosureLinks = links
    .map((link) => asNode(link))
    .filter((link): link is Node => link !== undefined && link['@_rel'] === 'enclosure');
  return [...enclosures, ...enclosureLinks].some((node) => String(node['@_type'] ?? '').startsWith('audio/'));
}

function parseRssItem(item: Node, base: string | undefined): ParsedItem {
  const guid = textOf(item.guid).trim() || null;
  const description = textOf(item['content:encoded']) || textOf(item.description) || textOf(item['itunes:summary']);
  return {
    guid,
    videoId: null,
    link: atomLink(item.link, base),
    title: title(item.title),
    summary: htmlToText(description),
    publishedAt: parseDate(textOf(item.pubDate) || textOf(item['dc:date'])),
    hasAudio: hasAudioEnclosure(item),
  };
}

function parseAtomEntry(entry: Node, base: string | undefined): ParsedItem {
  const media = asNode(entry['media:group']);
  const description =
    textOf(entry.summary) || textOf(entry.content) || (media ? textOf(media['media:description']) : '');
  return {
    guid: textOf(entry.id).trim() || null,
    videoId: textOf(entry['yt:videoId']).trim() || null,
    link: atomLink(entry.link, base),
    title: title(entry.title),
    summary: htmlToText(description),
    publishedAt: parseDate(textOf(entry.published) || textOf(entry.updated)),
    hasAudio: hasAudioEnclosure(entry),
  };
}

/** Parses an RSS 2.0, RSS 1.0 (RDF) or Atom document. `baseUrl` resolves relative links. */
export function parseFeed(xml: string, baseUrl?: string): ParsedFeed {
  assertNoEntityDeclarations(xml);
  let doc: Node;
  try {
    doc = createXmlParser().parse(xml) as Node;
  } catch {
    throw new FeedParseError('Invalid XML');
  }

  const rss = asNode(doc.rss);
  const rdf = asNode(doc['rdf:RDF']);
  const atom = asNode(doc.feed);

  if (rss || rdf) {
    const channel = asNode((rss ?? rdf)!.channel) ?? {};
    const rawItems = (rss ? channel.item : rdf!.item) ?? [];
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).map((item) => parseRssItem(item as Node, baseUrl));
    const isPodcast =
      Object.keys(channel).some((key) => key.startsWith('itunes:')) || items.some((item) => item.hasAudio);
    return {
      title: title(channel.title),
      siteUrl: atomLink(channel.link, baseUrl),
      isPodcast,
      items,
    };
  }

  if (atom) {
    const rawEntries = atom.entry ?? [];
    const items = (Array.isArray(rawEntries) ? rawEntries : [rawEntries]).map((entry) =>
      parseAtomEntry(entry as Node, baseUrl),
    );
    // A channel's long-form uploads feed is titled just "Videos"; its author is the channel name.
    const isLongFormUploads = textOf(atom['yt:playlistId']).startsWith('UULF');
    const author = textOf(asNode(atom.author)?.name);
    return {
      title: title(isLongFormUploads && author ? author : atom.title),
      siteUrl: atomLink(atom.link, baseUrl),
      isPodcast: items.some((item) => item.hasAudio),
      items,
    };
  }

  throw new FeedParseError('Not an RSS or Atom feed');
}

/** Deterministic per-source identity: `guid` -> `yt:videoId` -> `link` -> content hash. */
export function dedupKey(item: ParsedItem): string {
  if (item.guid) return `guid:${item.guid}`;
  if (item.videoId) return `yt:${item.videoId}`;
  if (item.link) return `link:${item.link}`;
  const hash = createHash('sha256')
    .update([item.title, item.publishedAt ?? '', item.summary].join('\u0000'))
    .digest('hex');
  return `hash:${hash}`;
}

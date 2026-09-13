import ReactMarkdown from 'react-markdown';

type MarkdownMessageProps = {
  text: string;
  allowedUrls: readonly string[];
};

const MARKDOWN_ELEMENTS = [
  'p', 'strong', 'em', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'br', 'hr', 'a',
];

const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'msclkid',
]);

/**
 * OpenAI sometimes escapes Markdown punctuation even though the answer is
 * plain Markdown. ReactMarkdown correctly treats those escapes as literal
 * characters, which made `**bold**` and `[source](url)` appear unformatted.
 *
 * Only CommonMark presentation punctuation is restored. Angle brackets stay
 * escaped, raw HTML remains disabled below, and every link still has to match
 * the evidence ledger before it can become clickable.
 */
export function normalizeAssistantMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B\uFEFF]/gu, '')
    .replace(/\\([!*_[\]()#.+-])/gu, '$1');
}

function safeEvidenceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Renders assistant-authored Markdown without raw HTML or remote images.
 * A Markdown URL becomes clickable only when the backend returned it as
 * evidence for this exact message.
 */
export function MarkdownMessage({ text, allowedUrls }: MarkdownMessageProps) {
  const approvedUrls = new Set(
    allowedUrls
      .map((url) => safeEvidenceUrl(url))
      .filter((url): url is string => url !== null),
  );
  const markdown = normalizeAssistantMarkdown(text);

  return (
    <div className="message-markdown">
      <ReactMarkdown
        skipHtml
        allowedElements={MARKDOWN_ELEMENTS}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => {
            const url = safeEvidenceUrl(href);
            if (!url || !approvedUrls.has(url)) {
              return <span className="markdown-link-blocked">{children}</span>;
            }
            return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

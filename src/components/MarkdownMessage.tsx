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

function canonicalHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
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
      .map((url) => canonicalHttpsUrl(url))
      .filter((url): url is string => url !== null),
  );

  return (
    <div className="message-markdown">
      <ReactMarkdown
        skipHtml
        allowedElements={MARKDOWN_ELEMENTS}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => {
            const url = canonicalHttpsUrl(href);
            if (!url || !approvedUrls.has(url)) {
              return <span className="markdown-link-blocked">{children}</span>;
            }
            return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

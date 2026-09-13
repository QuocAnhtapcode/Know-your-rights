// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownMessage } from './MarkdownMessage';

afterEach(cleanup);

describe('MarkdownMessage', () => {
  it('renders Vietnamese headings, emphasis, lists and an approved evidence link', () => {
    const sourceUrl = 'https://www.fairwork.gov.au/find-help-for/visa-holders-migrants?utm_source=openai';
    const cleanSourceUrl = 'https://www.fairwork.gov.au/find-help-for/visa-holders-migrants';
    const { container } = render(
      <MarkdownMessage
        text={`### Trang nên xem trước\n\n- **Fair Work Ombudsman**: quyền của người lao động. ([fairwork.gov.au](${sourceUrl}))\n\n1. Kiểm tra điều kiện visa\n2. Tìm nơi hỗ trợ`}
        allowedUrls={[sourceUrl]}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Trang nên xem trước' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('Fair Work Ombudsman');
    expect(container.querySelectorAll('ul li')).toHaveLength(1);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'fairwork.gov.au' });
    expect(link.getAttribute('href')).toBe(cleanSourceUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).not.toContain('###');
    expect(container.textContent).not.toContain('**');
  });

  it('repairs escaped OpenAI-style Markdown while preserving evidence URL checks', () => {
    const sourceUrl = 'https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/migrant-worker-protections/information-for-migrant-workers?TermId=95284cda&UTM_Source=openai';
    const { container } = render(
      <MarkdownMessage
        text={'Nếu chủ \\*\\*giữ hộ chiếu\\*\\*, hãy làm như sau:\r\n\r\n1\\. \\*\\*Giữ lại giấy tờ\\*\\*.\r\n2\\. Liên hệ nguồn chính thức. \\([immi.homeaffairs.gov.au]\\(https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/migrant-worker-protections/information-for-migrant-workers?TermId=95284cda&UTM_Source=openai\\)\\)'}
        allowedUrls={[sourceUrl]}
      />,
    );

    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('giữ hộ chiếu');
    const link = screen.getByRole('link', { name: 'immi.homeaffairs.gov.au' });
    expect(link.getAttribute('href')).toBe('https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/migrant-worker-protections/information-for-migrant-workers?TermId=95284cda');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).not.toContain('\\*\\*');
    expect(container.textContent).not.toContain('\\[');
  });

  it('drops raw HTML and images and does not activate unapproved links', () => {
    const { container } = render(
      <MarkdownMessage
        text={'<script>alert(1)</script>\n\n![tracker](https://evil.example/pixel.png)\n\n[bad](javascript:alert(1)) [unknown](https://evil.example/)'}
        allowedUrls={[]}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('bad')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });

  it('does not activate escaped javascript, data or unapproved HTTPS links', () => {
    const { container } = render(
      <MarkdownMessage
        text={'\\[script\\]\\(javascript:alert(1)\\) \\[data\\]\\(data:text/html,bad\\) \\[unknown\\]\\(https://evil.example/path?utm_source=openai\\)'}
        allowedUrls={['https://www.fairwork.gov.au/']}
      />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('script')).toBeTruthy();
    expect(screen.getByText('data')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });
});

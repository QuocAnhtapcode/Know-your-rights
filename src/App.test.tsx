// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { closeClientSession } from './lib/chat-client';

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  await closeClientSession();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('M1 web routes and mock journey', () => {
  it('requires disclosure then opens Chat and returns an explicit mock answer', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    const start = screen.getByRole('button', { name: 'Bắt đầu trò chuyện' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(start);
    await screen.findByRole('heading', { name: /Cuộc trò chuyện mới/ });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tin nhắn của bạn' }), { target: { value: 'Một tình huống hoàn toàn hư cấu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
    await screen.findByText(/mình chưa gọi AI hay tra cứu web/);
    expect(screen.getByText('Một tình huống hoàn toàn hư cấu')).toBeTruthy();
    expect(screen.getByText('MOCK / OFFLINE')).toBeTruthy();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem('kyr:conversation')).toMatch(/^[\da-f-]{36}$/);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('explains refresh loss without fabricating a restored transcript', async () => {
    sessionStorage.setItem('kyr:conversation', crypto.randomUUID());
    render(<MemoryRouter initialEntries={['/chat']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Bắt đầu lại, theo cách của bạn.' });
    expect(screen.getByText(/Bản mock không lưu nội dung qua lần tải lại/)).toBeTruthy();
    expect(sessionStorage.getItem('kyr:conversation')).toBeNull();
  });

  it('Quick Exit clears visible transcript and leaves a suppression pointer', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trò chuyện' }));
    await screen.findByRole('heading', { name: /Cuộc trò chuyện mới/ });
    fireEvent.click(screen.getByRole('button', { name: 'Thoát nhanh' }));
    await screen.findByRole('heading', { name: 'Đã đóng nội dung trước đó.' });
    await waitFor(() => expect(screen.getByText(/Phiên thử trong bộ nhớ đã được đóng/)).toBeTruthy());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(sessionStorage.getItem('kyr:suppressed')).toBe('1');
    expect(sessionStorage.getItem('kyr:conversation')).toBeNull();
  });

  it('Help is directly reachable and labels its static directory', async () => {
    render(<MemoryRouter initialEntries={['/help']}><App /></MemoryRouter>);
    expect(screen.getByText('Danh bạ tĩnh, không phải nguồn đã tra cứu cho câu trả lời.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Fair Work Ombudsman/ }).getAttribute('href')).toBe('https://www.fairwork.gov.au/');
    fireEvent.click(screen.getByRole('button', { name: 'Pháp lý' }));
    expect(screen.queryByRole('link', { name: /Fair Work Ombudsman/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Legal Aid NSW/ })).toBeTruthy();
  });
});

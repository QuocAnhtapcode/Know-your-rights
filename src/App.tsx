import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Clipboard, DoorOpen, ExternalLink, Globe2, HeartHandshake, Info, Leaf, LockKeyhole, MessageCircle, PanelRightClose, RefreshCw, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MAX_MESSAGE_LENGTH, type ConversationView, type SendMessageRequest, type StartConversationRequest } from '../shared/contracts';
import { MarkdownMessage } from './components/MarkdownMessage';
import { chatMode, closeClientSession, getClientSession } from './lib/chat-client';

const POINTER = 'kyr:conversation';
const SUPPRESSED = 'kyr:suppressed';
const SESSION_CHANNEL = 'know-your-rights-session-events';

function readSession(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function setSession(key: string, value: string | null) {
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Memory-only use remains possible. */ }
}
function readableError(error: unknown) {
  if (error instanceof Error && (chatMode === 'mock' || /Thiếu cấu hình|Emulator|loopback|PORT/.test(error.message))) return error.message;
  return 'Chưa hoàn tất yêu cầu. Hãy kiểm tra kết nối hoặc cấu hình demo rồi thử lại. Không có phản hồi AI nào được giả lập thay thế.';
}

type SessionProps = {
  conversation: ConversationView | null;
  busy: boolean;
  error: string;
  responseMode: 'mock' | 'live' | null;
  start: (accessCode?: string, replaceConversationId?: string) => Promise<void>;
  send: (text: string) => Promise<boolean>;
  retry: () => Promise<void>;
  retryText: string;
  clear: () => Promise<void>;
  restoring: boolean;
  language: 'vi' | 'en';
  setLanguage: (language: 'vi' | 'en') => void;
};

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [responseMode, setResponseMode] = useState<'mock' | 'live' | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const [retryRequest, setRetryRequest] = useState<SendMessageRequest | null>(null);
  const [safeStatus, setSafeStatus] = useState('Nội dung trước đó đã được che khỏi trang này.');
  const [exiting, setExiting] = useState(false);
  const [language, setLanguage] = useState<'vi' | 'en'>('vi');
  const generation = useRef(0);
  const busyRef = useRef(false);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const startRequest = useRef<StartConversationRequest | null>(null);
  const operations = useRef(new Set<Promise<void>>());
  const lateCleanupFailed = useRef(false);
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const notifyCleared = useCallback((conversationId: string) => {
    sessionChannel.current?.postMessage({ type: 'cleared', conversationId });
  }, []);

  useEffect(() => {
    document.title = location.pathname === '/safe'
      ? (language === 'en' ? 'New page' : 'Trang mới')
      : (language === 'en' ? 'Know Your Rights — Worker-rights demo' : 'Know Your Rights — Hiểu quyền của bạn');
  }, [language, location.pathname]);

  useEffect(() => {
    let alive = true;
    const stamp = generation.current;
    const pointer = readSession(POINTER);
    if (!pointer || readSession(SUPPRESSED) === '1') {
      setRestoring(false);
      return;
    }
    void getClientSession().then(({ client }) => client.getConversation({ conversationId: pointer })).then((result) => {
      if (!alive || stamp !== generation.current) return;
      setConversation(result.conversation);
      setResponseMode(result.mode);
    }).catch((cause: unknown) => {
      if (!alive || stamp !== generation.current) return;
      setSession(POINTER, null);
      setError(readableError(cause));
    }).finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !('type' in data) || !('conversationId' in data)
        || data.type !== 'cleared' || typeof data.conversationId !== 'string') return;
      const currentId = conversationRef.current?.conversationId;
      if (currentId !== data.conversationId && readSession(POINTER) !== data.conversationId) return;
      generation.current += 1;
      setSession(SUPPRESSED, '1');
      setSession(POINTER, null);
      setConversation(null);
      setResponseMode(null);
      setRetryRequest(null);
      setError('');
      setBusy(false);
      setRestoring(false);
      startRequest.current = null;
      busyRef.current = false;
      setExiting(false);
      setSafeStatus('Phiên này đã được xóa từ một tab khác. Nội dung đã được che trên tab này.');
      navigate('/safe', { replace: true });
    };
    return () => {
      if (sessionChannel.current === channel) sessionChannel.current = null;
      channel.close();
    };
  }, [navigate]);

  const track = (operation: Promise<void>) => {
    operations.current.add(operation);
    void operation.finally(() => operations.current.delete(operation));
    return operation;
  };

  async function start(accessCode?: string, replaceConversationId?: string) {
    if (busyRef.current || exiting) return;
    const current = conversationRef.current;
    if (current && !replaceConversationId) { navigate('/chat'); return; }
    if (replaceConversationId && current?.conversationId !== replaceConversationId) {
      setError('Phiên cần thay không còn là phiên đang mở. Hãy tải lại trước khi thử tiếp.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setSession(SUPPRESSED, null);
    const stamp = generation.current;
    if (!startRequest.current || startRequest.current.accessCode !== accessCode
      || startRequest.current.replaceConversationId !== replaceConversationId) {
      startRequest.current = {
        requestId: crypto.randomUUID(),
        ...(accessCode ? { accessCode } : {}),
        ...(replaceConversationId ? { replaceConversationId } : {}),
      };
    }
    const request = startRequest.current;
    return track((async () => {
      try {
        const { client } = await getClientSession();
        const result = await client.startConversation(request);
        if (stamp !== generation.current) {
          await client.clearConversation({ conversationId: result.conversation.conversationId });
          return;
        }
        setConversation(result.conversation);
        setResponseMode(result.mode);
        setSession(POINTER, result.conversation.conversationId);
        startRequest.current = null;
        if (replaceConversationId) notifyCleared(replaceConversationId);
        navigate('/chat');
      } catch (cause) {
        if (stamp === generation.current) setError(readableError(cause));
        else lateCleanupFailed.current = true;
      } finally {
        if (stamp === generation.current) { setBusy(false); busyRef.current = false; }
      }
    })());
  }

  async function sendRequest(request: SendMessageRequest) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRetryRequest(request);
    const stamp = generation.current;
    let completed = false;
    await track((async () => {
      try {
        const { client } = await getClientSession();
        const result = await client.sendMessage(request);
        if (stamp !== generation.current) return;
        setConversation(result.conversation);
        setResponseMode(result.mode);
        completed = result.status === 'completed';
        if (completed) setRetryRequest(null);
        else setError('Lượt này chưa hoàn tất. Bạn có thể thử kiểm tra lại bằng nút Thử lại; không tạo tin nhắn trùng.');
      } catch (cause) {
        if (stamp === generation.current) setError(readableError(cause));
      } finally {
        if (stamp === generation.current) { setBusy(false); busyRef.current = false; }
      }
    })());
    return completed;
  }

  async function send(text: string) {
    if (!conversation || retryRequest) return false;
    return sendRequest({ conversationId: conversation.conversationId, message: text, contextVersion: conversation.contextVersion, userMessageId: crypto.randomUUID(), attemptId: crypto.randomUUID() });
  }

  async function clear() {
    const current = conversationRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    generation.current += 1;
    const stamp = generation.current;
    try {
      const { client } = await getClientSession();
      await client.clearConversation({ conversationId: current.conversationId });
      if (stamp !== generation.current) return;
      notifyCleared(current.conversationId);
      setConversation(null);
      setResponseMode(null);
      setRetryRequest(null);
      setSession(POINTER, null);
      startRequest.current = null;
      navigate('/', { replace: true });
    } catch (cause) { if (stamp === generation.current) setError(readableError(cause)); }
    finally { if (stamp === generation.current) { busyRef.current = false; setBusy(false); } }
  }

  const quickExit = useCallback(() => {
    const current = conversationRef.current;
    const targetConversationId = current?.conversationId ?? readSession(POINTER);
    generation.current += 1;
    setSession(SUPPRESSED, '1');
    setSession(POINTER, null);
    setConversation(null);
    setResponseMode(null);
    setRetryRequest(null);
    setError('');
    setBusy(false);
    setRestoring(false);
    startRequest.current = null;
    setExiting(true);
    lateCleanupFailed.current = false;
    setSafeStatus('Nội dung trước đó đã được che. Đang hoàn tất việc đóng phiên…');
    navigate('/safe', { replace: true });
    void (async () => {
      let failed = false;
      let deletionConfirmed = false;
      try {
        if (targetConversationId) {
          const { client } = await getClientSession();
          await client.clearConversation({ conversationId: targetConversationId });
          deletionConfirmed = true;
          notifyCleared(targetConversationId);
        }
      } catch { failed = true; }
      await Promise.allSettled([...operations.current]);
      failed ||= lateCleanupFailed.current;
      try { await closeClientSession(); } catch { failed = true; }
      setSafeStatus(failed
        ? 'Nội dung đã được che trên thiết bị này. Chưa xác nhận xóa dữ liệu từ dịch vụ.'
        : deletionConfirmed && chatMode === 'mock'
          ? 'Phiên thử trong bộ nhớ đã được đóng. Bản mock không gửi nội dung lên cloud.'
          : deletionConfirmed
            ? 'Dịch vụ đã xác nhận xóa phiên. Thao tác này không xóa lịch sử trình duyệt hoặc nhật ký của nhà cung cấp.'
            : 'Nội dung đã được che. Không có phiên hội thoại đang mở để yêu cầu dịch vụ xóa.');
      setExiting(false);
      busyRef.current = false;
    })();
  }, [navigate, notifyCleared]);

  const props: SessionProps = {
    conversation, responseMode, busy, error, start, send,
    retry: async () => {
      const current = conversationRef.current;
      if (!retryRequest || !current) return;
      try {
        const { client } = await getClientSession();
        const refreshed = await client.getConversation({ conversationId: current.conversationId });
        setConversation(refreshed.conversation);
        setResponseMode(refreshed.mode);
        await sendRequest({
          ...retryRequest,
          attemptId: crypto.randomUUID(),
          contextVersion: refreshed.conversation.contextVersion,
        });
      } catch (cause) {
        setError(readableError(cause));
      }
    },
    retryText: retryRequest?.message ?? '', clear, restoring, language, setLanguage,
  };

  if (location.pathname === '/safe') return <Safe status={safeStatus} exiting={exiting} language={language} />;

  return <div className={`app-shell ${location.pathname === '/chat' ? 'is-chat' : ''}`}>
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Know Your Rights — Trang chủ"><span className="brand-symbol"><Leaf size={24} strokeWidth={1.8} /></span><span>know your rights<span className="brand-dot">.</span></span></Link>
      <nav aria-label={language === 'en' ? 'Main navigation' : 'Điều hướng chính'}><NavLink to="/" end>{language === 'en' ? 'Explore' : 'Khám phá'}</NavLink><NavLink to="/chat">{language === 'en' ? 'Chat' : 'Trò chuyện'}</NavLink><NavLink to="/help">{language === 'en' ? 'Help' : 'Trợ giúp'} <ArrowUpRight size={13} /></NavLink></nav>
      <button className="language-toggle" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={language === 'vi' ? 'Switch to English' : 'Chuyển sang tiếng Việt'}>{language === 'vi' ? 'EN' : 'VI'}</button>
      <button className="exit-button" onClick={quickExit}><DoorOpen size={17} /><span>{language === 'en' ? 'Quick exit' : 'Thoát nhanh'}</span></button>
    </header>
    <div className={`mode-strip ${chatMode !== 'mock' && responseMode === 'live' ? 'connected-mode' : ''}`} role="status"><span className="status-dot" /><strong>{chatMode === 'mock' ? 'MOCK / OFFLINE' : chatMode === 'emulator' ? 'EMULATOR / LOCAL' : 'FIREBASE CLOUD'}</strong><span>{chatMode === 'mock' ? (language === 'en' ? 'Labelled UI mock · no AI, web search or cloud data' : 'Bản thử giao diện · Không gọi AI, không tra web, không gửi dữ liệu lên cloud') : responseMode === 'mock' ? (language === 'en' ? 'Backend mock · not live AI' : 'Backend trả lời bằng mock · Không phải AI live') : responseMode === 'live' ? (language === 'en' ? 'Live AI demo · approved-domain web grounding · use fictional data only' : 'AI demo đang bật · tra web trong domain đã duyệt · chỉ dùng dữ liệu hư cấu') : (language === 'en' ? 'Firebase connected · start a session to check AI mode' : 'Đã kết nối Firebase · mở phiên để kiểm tra chế độ AI')}</span></div>
    <Routes>
      <Route path="/" element={<Home {...props} />} />
      <Route path="/chat" element={<Chat {...props} />} />
      <Route path="/help" element={<Help language={language} />} />
      <Route path="*" element={<main className="simple-page"><span className="eyebrow">404 · {language === 'en' ? 'PAGE NOT FOUND' : 'TRANG KHÔNG TỒN TẠI'}</span><h1>{language === 'en' ? 'Let’s go back.' : 'Mình quay lại nhé?'}</h1><p>{language === 'en' ? 'This route is not part of the demo.' : 'Đường dẫn này không có trong bản thử.'}</p><Link className="button button-primary" to="/">{language === 'en' ? 'Home' : 'Về trang chủ'} <ArrowRight size={17} /></Link></main>} />
    </Routes>
    {location.pathname !== '/chat' && <footer className="site-footer"><span className="footer-brand">know your rights.</span><p>{language === 'en' ? 'RMWC challenge hackathon project · Not an official RMWC service' : 'Đồ án hackathon theo đề tài RMWC · Không phải dịch vụ chính thức của RMWC'}</p><span>{language === 'en' ? 'v4 Firebase demo' : 'Bản thử nghiệm v4 / Firebase'}</span></footer>}
  </div>;
}

function Home({ start, busy, error, conversation, language }: SessionProps) {
  const [consent, setConsent] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const en = language === 'en';
  const submit = (event: FormEvent) => { event.preventDefault(); if (consent) void start(accessCode || undefined); };
  return <main className="home-page">
    <section className="hero-section">
      <div className="hero-content"><span className="eyebrow"><span /> {en ? 'A LITTLE MORE CLARITY. A LITTLE MORE CONFIDENCE.' : 'HIỂU THÊM MỘT CHÚT. AN TÂM HƠN MỘT CHÚT.'}</span><h1>{en ? 'Know your rights.' : 'Hiểu quyền của bạn.'}<br /><span>{en ? 'Choose your next step.' : 'Chọn bước tiếp theo.'}</span></h1><p className="hero-description">{en ? <>Workplace problems can be hard to explain.<br />Start in your own words, in English or Vietnamese.</> : <>Chuyện ở chỗ làm đôi khi thật khó nói.<br />Bạn có thể bắt đầu bằng tiếng Việt, theo cách của mình.</>}</p><div className="hero-detail"><ShieldCheck size={18} /><span>{en ? 'No real name or visa number needed' : 'Không cần nhập tên thật hay số visa'}</span></div>
        <form onSubmit={submit} className="start-form">
          {chatMode !== 'mock' && <div className="access-field"><label htmlFor="access-code">{en ? 'Demo access code' : 'Mã truy cập bản demo'}</label><input id="access-code" type="password" autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} maxLength={256} placeholder={en ? 'Enter the code supplied by the demo team' : 'Nhập mã do đội demo cung cấp'} /><small>{en ? 'Leave blank if this anonymous session already has a grant. Never enter an OpenAI key.' : 'Bỏ trống nếu phiên đăng nhập đã được cấp quyền. Không nhập OpenAI key.'}</small></div>}
          <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{chatMode === 'mock' ? (en ? 'I understand this is a labelled mock. Messages stay in page memory and disappear on refresh. I will use a fictional scenario.' : 'Tôi hiểu đây là bản mock. Tin nhắn chỉ ở bộ nhớ trang và mất khi tải lại. Tôi sẽ dùng tình huống hư cấu.') : (en ? 'I will use fictional data. The session is stored briefly in Firebase; when AI is enabled, questions go to an external AI service. Access expiry is not immediate physical deletion.' : 'Tôi đồng ý dùng dữ liệu hư cấu. Phiên được lưu tạm trên Firebase; khi bật AI, câu hỏi được gửi đến dịch vụ AI bên ngoài. Hết hạn truy cập không đồng nghĩa xóa ngay mọi dữ liệu.')}</span></label>
          <div className="hero-actions"><button type="submit" className="button button-primary" disabled={!consent || busy}>{busy ? (en ? 'Opening…' : 'Đang mở phiên…') : conversation ? (en ? 'Continue chat' : 'Tiếp tục trò chuyện') : (en ? 'Start chat' : 'Bắt đầu trò chuyện')}<ArrowRight size={19} /></button><Link className="text-link" to="/help">{en ? 'Find support' : 'Tìm nơi hỗ trợ'} <ArrowUpRight size={17} /></Link></div>
          {error && <ErrorNotice>{error}</ErrorNotice>}
        </form>
      </div>
      <div className="hero-visual" aria-label={en ? 'Illustrative chat interface' : 'Minh họa giao diện trò chuyện mẫu'}><div className="sun-decoration" /><div className="visual-ornament ornament-one" /><div className="visual-ornament ornament-two" /><div className="conversation-preview"><div className="preview-header"><span className="small-brand"><Leaf size={19} /></span><span>{en ? 'A place to begin' : 'Một nơi để bắt đầu'}<small>{en ? 'You do not need the perfect question' : 'Không cần biết phải hỏi thế nào'}</small></span><span className="preview-dots">•••</span></div><div className="preview-user">{en ? 'I’m not sure where to start…' : 'Mình chưa biết nên bắt đầu từ đâu…'}</div><div className="preview-assistant"><Sparkles size={18} /><p>{en ? <>Tell it in your own words.<br />One question at a time.</> : <>Cứ kể theo cách của bạn.<br />Mỗi lần một câu hỏi thôi.</>}</p></div><div className="preview-label"><Info size={13} /> {en ? 'Interface illustration · not an AI answer' : 'Minh họa giao diện · Không phải trả lời AI'}</div><div className="preview-composer"><span>{en ? 'What would you like to share?' : 'Bạn muốn chia sẻ điều gì?'}</span><ArrowRight size={16} /></div></div><div className="floating-note"><HeartHandshake size={23} /><div>{en ? 'You choose what to share.' : 'Bạn chọn điều muốn chia sẻ.'}<span>{en ? 'You choose the next step.' : 'Bạn quyết định bước tiếp theo.'}</span></div></div><span className="visual-caption">{en ? 'Designed to listen without judgement.' : 'Được thiết kế để lắng nghe, không phán xét.'}</span></div>
    </section>
    <section className="how-section"><div className="section-intro"><span className="eyebrow">{en ? 'FROM UNCERTAINTY TO CLARITY' : 'TỪ BỐI RỐI ĐẾN RÕ RÀNG'}</span><h2>{en ? 'One conversation.' : 'Một cuộc trò chuyện.'}<br />{en ? 'At your pace.' : 'Theo nhịp của bạn.'}</h2><p>{en ? 'The live demo searches only a small, relevant subset of a 29-source policy registry and shows the evidence it accepted.' : 'Bản live chỉ tìm trong một nhóm nhỏ phù hợp thuộc registry 29 nguồn và hiển thị bằng chứng đã vượt qua kiểm tra.'}</p></div><div className="how-cards"><Feature number="01" icon={<MessageCircle size={22} />} title={en ? 'Tell your story' : 'Kể điều bạn đang gặp'}>{en ? 'Start in your own words, without a long mandatory intake form.' : 'Bắt đầu bằng lời của mình. Không phải điền một hồ sơ dài trước khi được hỏi.'}</Feature><Feature number="02" icon={<BookOpen size={22} />} title={en ? 'Check grounded information' : 'Hiểu thông tin có nguồn'}>{en ? 'Legal and procedural claims are shown only after approved-source citation checks.' : 'Các nhận định pháp lý và thủ tục chỉ hiển thị sau khi kiểm tra trích dẫn từ nguồn đã duyệt.'}</Feature><Feature number="03" icon={<ArrowUpRight size={22} />} title={en ? 'Choose your next step' : 'Tự chọn bước tiếp theo'}>{en ? 'Open an official support page when you choose; the app never submits a case for you.' : 'Tìm trang của cơ quan hỗ trợ. Ứng dụng không tự gửi thông tin hay nộp hồ sơ thay bạn.'}</Feature></div></section>
    <div className="home-bottom-note"><LockKeyhole size={20} /><p><strong>{en ? 'General information, not individual legal advice.' : 'Thông tin để tham khảo, không thay thế tư vấn cá nhân.'}</strong><br />{en ? 'This demo is not a lawyer or emergency service.' : 'Đây là bản thử nghiệm, không phải luật sư hay dịch vụ khẩn cấp.'} <Link to="/help">{en ? 'Read safe-use guidance' : 'Đọc cách dùng an toàn'}</Link></p></div>
  </main>;
}

function Feature({ number, icon, title, children }: { number: string; icon: ReactNode; title: string; children: ReactNode }) {
  return <article className="feature-card"><div className="feature-top"><span>{icon}</span><span>{number}</span></div><h3>{title}</h3><p>{children}</p></article>;
}

const suggestions = {
  vi: ['Tôi muốn thử kể về tình huống ở chỗ làm.', 'Giúp tôi thử luồng hỏi tiếp một câu.', 'Tôi muốn tìm các trang hỗ trợ chính thức.'],
  en: ['I want to describe a fictional workplace problem.', 'Help me work out the next question.', 'I want to find official support pages.'],
} as const;

function Chat(props: SessionProps) {
  const { conversation, busy, error, send, retry, retryText, clear, restoring, responseMode, start, language } = props;
  const en = language === 'en';
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<'sources' | 'facts' | 'summary' | null>(null);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
    else setNewMessages(true);
  }, [conversation?.messages.length]);
  useEffect(() => {
    if (!conversation) return;
    const facts = conversation.userFacts.filter((fact) => fact.status === 'user_reported');
    setSummaryDraft(facts.length > 0
      ? facts.map((fact) => `${fact.key}: ${fact.value}`).join('\n')
      : (en ? 'No case details have been confirmed by the user.' : 'Chưa có thông tin tình huống nào được người dùng xác nhận.'));
  }, [conversation, en]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy || retryText) return;
    const currentDraft = draft;
    setDraft('');
    const sent = await send(currentDraft);
    if (!sent) {
      setDraft(currentDraft);
      composer.current?.focus();
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryDraft);
      setSummaryCopied(true);
      window.setTimeout(() => setSummaryCopied(false), 1_500);
    } catch {
      setSummaryCopied(false);
    }
  }

  if (restoring) return <main className="simple-page"><p role="status">{en ? 'Checking your session…' : 'Đang kiểm tra phiên…'}</p></main>;
  if (!conversation) return <main className="empty-chat-page"><span className="empty-chat-icon"><MessageCircle size={34} /></span><span className="eyebrow">{en ? 'A NEW CONVERSATION' : 'MỘT CUỘC TRÒ CHUYỆN MỚI'}</span><h1>{en ? 'Start again, in your own way.' : 'Bắt đầu lại, theo cách của bạn.'}</h1><p>{chatMode === 'mock' ? (en ? 'The mock does not survive a refresh. Start a new fictional scenario from Home.' : 'Bản mock không lưu nội dung qua lần tải lại trang. Bạn có thể mở một phiên mới với tình huống hư cấu.') : (en ? 'No session is open, or the previous session ended. Return Home to review the data notice and start deliberately.' : 'Chưa có phiên đang mở, hoặc phiên trước đã kết thúc. Hãy về trang chủ để xem thông báo dữ liệu và bắt đầu.')}</p>{error && <ErrorNotice>{error}</ErrorNotice>}<Link to="/" className="button button-primary">{en ? 'Start page' : 'Về trang bắt đầu'} <ArrowRight size={18} /></Link><Link to="/help" className="text-link">{en ? 'Find support' : 'Tìm nơi hỗ trợ'} <ArrowUpRight size={16} /></Link></main>;

  return <main className="chat-layout"><section className="chat-main" aria-label={en ? 'Conversation' : 'Cuộc trò chuyện'}><div className="chat-heading"><div><span className="eyebrow">{en ? 'YOUR SPACE' : 'KHÔNG GIAN CỦA BẠN'}</span><h1>{en ? 'New conversation' : 'Cuộc trò chuyện mới'} <span>{responseMode === 'mock' ? 'Mock' : 'Demo'}</span></h1></div><div><button className="subtle-button" onClick={() => setConfirmReplace(true)} disabled={busy}><RefreshCw size={16} /><span>{en ? 'New' : 'Phiên mới'}</span></button><button className="subtle-button" onClick={() => setConfirmClear(true)} disabled={busy}><Trash2 size={16} /><span>{en ? 'Clear' : 'Xóa chat'}</span></button></div></div><div className="chat-mobile-tools"><button onClick={() => setPanel('sources')}><BookOpen size={16} /> {en ? 'Sources' : 'Nguồn'}</button><button onClick={() => setPanel('facts')}><Info size={16} /> {en ? 'Facts' : 'Đã chia sẻ'}</button><button onClick={() => setPanel('summary')}><Clipboard size={16} /> {en ? 'Summary' : 'Tóm tắt'}</button></div>
      <div className="transcript" ref={transcript} onScroll={() => { const element = transcript.current; if (element) { atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; if (atBottom.current) setNewMessages(false); } }}>
        <div className="welcome-message"><span className="assistant-avatar"><Leaf size={21} /></span><div><span className="message-author">Know Your Rights <span>•</span> {responseMode === 'mock' ? (en ? 'Sample reply' : 'Trả lời mẫu') : (en ? 'Demo' : 'Bản demo')}</span><h2>{en ? 'Hi — start in your own words.' : 'Chào bạn, mình bắt đầu nhé.'}</h2><p>{responseMode === 'mock' ? (en ? 'This is an interface-only mock. Use a fictional situation; it provides no legal answer and does not search the web.' : 'Đây là phiên thử giao diện. Hãy dùng một tình huống hư cấu — bản mock chưa trả lời câu hỏi pháp lý và không tra cứu web.') : (en ? 'Do not enter a real name, address or visa number. This demo is not individual advice.' : 'Bạn có thể kể theo cách của mình. Không cần nhập tên thật, địa chỉ hay số visa. Đây là bản thử nghiệm, không thay thế tư vấn cá nhân.')}</p></div></div>
        {conversation.messages.length === 0 && <div className="suggestions"><span>{en ? 'YOU COULD TRY' : 'BẠN CÓ THỂ THỬ'}</span>{suggestions[language].map((suggestion) => <button key={suggestion} onClick={() => { setDraft(suggestion); composer.current?.focus(); }}>{suggestion}<ArrowUpRight size={16} /></button>)}<small>{en ? 'A suggestion only fills the composer; it is not sent automatically.' : 'Chọn gợi ý chỉ điền ô soạn thảo, chưa gửi tin nhắn.'}</small></div>}
        {conversation.messages.map((message) => <article key={message.id} className={`message message-${message.role}`}><span className={message.role === 'assistant' ? 'assistant-avatar' : 'user-avatar'}>{message.role === 'assistant' ? <Leaf size={20} /> : (en ? 'Y' : 'B')}</span><div className="message-content"><div className="message-author">{message.role === 'user' ? (en ? 'You' : 'Bạn') : 'Know Your Rights'}{message.provenance === 'mock' && <span className="inline-mock">MOCK</span>}</div><div className="message-body">{message.role === 'assistant' ? <MarkdownMessage text={message.text} allowedUrls={conversation.evidenceLedger.filter((source) => message.sourceIds.includes(source.id)).map((source) => source.url)} /> : <p>{message.text}</p>}</div>{message.sourceIds.length > 0 && <button className="source-chip" onClick={() => setPanel('sources')}><BookOpen size={13} /> {en ? 'View sources' : 'Xem nguồn'} ({message.sourceIds.length})</button>}</div></article>)}
        {retryText && !conversation.messages.some((message) => message.text === retryText && message.role === 'user') && <article className="pending-message"><span>{busy ? (en ? 'Sending' : 'Đang gửi') : (en ? 'Not completed' : 'Chưa hoàn tất')}</span><p>{retryText}</p></article>}
        {busy && <p role="status" className="processing-state"><span className="status-dot" />{responseMode === 'mock' ? (en ? 'Creating a labelled sample reply…' : 'Đang tạo phản hồi mẫu…') : (en ? 'Processing your request…' : 'Đang xử lý yêu cầu…')}</p>}
      </div>
      {newMessages && <button className="new-messages" onClick={() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); setNewMessages(false); }}>{en ? 'New message' : 'Tin nhắn mới'} <ArrowDown size={14} /></button>}
      <div className="composer-area">{error && <ErrorNotice>{error}{retryText && <button onClick={() => { void retry(); }} disabled={busy}><RefreshCw size={14} /> {en ? 'Retry safely' : 'Thử lại'}</button>}</ErrorNotice>}<form className="composer" onSubmit={(event) => { void submit(event); }}><label className="sr-only" htmlFor="message">{en ? 'Your message' : 'Tin nhắn của bạn'}</label><textarea id="message" ref={composer} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={en ? 'Continue your story or ask a question…' : 'Kể tiếp hoặc đặt câu hỏi của bạn…'} rows={2} maxLength={MAX_MESSAGE_LENGTH} disabled={busy || Boolean(retryText)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(event); } }} /><div className="composer-bottom"><span><LockKeyhole size={12} />{chatMode === 'mock' ? (en ? 'Page memory only' : 'Chỉ trong bộ nhớ trang') : (en ? 'Temporarily in Firebase' : 'Lưu tạm trên Firebase')}</span><span className="character-count">{draft.length}/{MAX_MESSAGE_LENGTH}</span><button type="submit" aria-label={en ? 'Send message' : 'Gửi tin nhắn'} disabled={busy || Boolean(retryText) || !draft.trim()}><Send size={18} /></button></div></form><p className="composer-caption">{responseMode === 'mock' ? (en ? 'Mock / offline — not AI or advice.' : 'Mock / offline — không phải tư vấn hay câu trả lời AI.') : (en ? 'Demo information — not individual legal advice.' : 'Bản thử nghiệm — không thay thế tư vấn cá nhân.')} <Link to="/help">{en ? 'Use safely' : 'Cách dùng an toàn'}</Link></p></div>
    </section>
    <aside className={`context-panel ${panel ? 'is-open' : ''}`} aria-label={en ? 'Supporting information' : 'Thông tin hỗ trợ'}>
      <div className="context-heading"><span>{en ? 'ALONGSIDE YOU' : 'ĐỒNG HÀNH CÙNG BẠN'}</span><button className="icon-button" aria-label={en ? 'Close information panel' : 'Đóng bảng thông tin'} onClick={() => setPanel(null)}><PanelRightClose size={17} /></button></div>
      <div className="context-tabs">
        <button className={panel === null || panel === 'sources' ? 'active' : ''} onClick={() => setPanel('sources')}><BookOpen size={15} /> {en ? 'Sources' : 'Nguồn'}</button>
        <button className={panel === 'facts' ? 'active' : ''} onClick={() => setPanel('facts')}><Info size={15} /> {en ? 'Facts' : 'Đã chia sẻ'}</button>
        <button className={panel === 'summary' ? 'active' : ''} onClick={() => setPanel('summary')}><Clipboard size={15} /> {en ? 'Summary' : 'Tóm tắt'}</button>
      </div>
      {panel === 'facts' ? <div className="panel-section"><span className="panel-symbol"><Info size={24} /></span><h2>{en ? 'What you shared' : 'Điều bạn đã chia sẻ'}</h2><p>{en ? 'These are user-reported facts, not verified records.' : 'Đây là lời người dùng cung cấp, không phải hồ sơ đã xác minh.'}</p>{conversation.userFacts.filter((fact) => fact.status === 'user_reported').length === 0 ? <div className="empty-panel-note">{en ? 'No user-confirmed facts yet.' : 'Chưa có thông tin nào được người dùng xác nhận.'}</div> : <ul className="fact-list">{conversation.userFacts.filter((fact) => fact.status === 'user_reported').map((fact) => <li key={fact.id}><strong>{fact.key}</strong><span>{fact.value}</span></li>)}</ul>}<button className="text-link" onClick={() => { setDraft(en ? 'I want to correct something I shared: ' : 'Tôi muốn sửa lại thông tin đã chia sẻ: '); composer.current?.focus(); setPanel(null); }}>{en ? 'Correct by chat' : 'Sửa bằng tin nhắn'} <ArrowRight size={14} /></button></div>
        : panel === 'summary' ? <div className="panel-section"><span className="panel-symbol"><Clipboard size={24} /></span><h2>{en ? 'Your editable summary' : 'Tóm tắt có thể chỉnh sửa'}</h2><p>{en ? 'Edit locally, then copy only when you choose. It is not automatically sent anywhere.' : 'Chỉnh sửa ngay trên thiết bị rồi chỉ sao chép khi bạn chủ động. Nội dung này không tự gửi đi.'}</p><label className="sr-only" htmlFor="case-summary">{en ? 'Editable case summary' : 'Tóm tắt tình huống có thể chỉnh sửa'}</label><textarea className="summary-editor" id="case-summary" value={summaryDraft} onChange={(event) => setSummaryDraft(event.target.value)} rows={9} maxLength={4_000} /><button className="summary-copy" onClick={() => { void copySummary(); }}><Clipboard size={15} /> {summaryCopied ? (en ? 'Copied' : 'Đã sao chép') : (en ? 'Copy summary' : 'Sao chép tóm tắt')}</button></div>
          : <div className="panel-section"><span className="panel-symbol"><BookOpen size={24} /></span><h2>{en ? 'Grounded information.' : 'Thông tin có điểm tựa.'}</h2><p>{en ? 'Sources used for an answer appear here so you can check them yourself.' : 'Nguồn được sử dụng trong câu trả lời sẽ xuất hiện ở đây để bạn tự kiểm tra.'}</p>{conversation.evidenceLedger.length === 0 ? <div className="empty-panel-note"><span className="empty-source-line" /><span className="empty-source-line short" /><p>{en ? <>No sources used yet.<br />The mock never invents citations.</> : <>Chưa có nguồn được tra cứu.<br />Không tạo trích dẫn giả trong bản mock.</>}</p></div> : <ul className="sources-list">{conversation.evidenceLedger.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={14} /></a><span>{new URL(source.url).hostname} · {source.jurisdiction}</span><small>{en ? 'Retrieved' : 'Tra cứu'}: {new Date(source.retrievedAt).toLocaleString(en ? 'en-AU' : 'vi-VN')}</small></li>)}</ul>}</div>}
      <div className="context-bottom"><HeartHandshake size={23} /><h3>{en ? 'You do not have to work it out alone.' : 'Không phải tự tìm hiểu một mình.'}</h3><p>{en ? 'Open official support pages when you feel ready.' : 'Xem các trang hỗ trợ chính thức, khi bạn thấy sẵn sàng.'}</p><Link to="/help">{en ? 'Find support' : 'Tìm nơi hỗ trợ'} <ArrowUpRight size={16} /></Link></div>
    </aside>
    {confirmClear && <div className="modal-backdrop"><section role="alertdialog" aria-modal="true" aria-labelledby="clear-title" aria-describedby="clear-description" className="confirm-dialog"><span className="dialog-icon"><Trash2 size={23} /></span><h2 id="clear-title">{en ? 'Clear this conversation?' : 'Xóa cuộc trò chuyện này?'}</h2><p id="clear-description">{chatMode === 'mock' ? (en ? 'The mock is removed from page memory; no content was sent to cloud services.' : 'Nội dung phiên mock sẽ bị xóa khỏi bộ nhớ trang. Không có nội dung được gửi lên cloud.') : (en ? 'The app will request deletion from Firebase. It cannot remove browser history or data already present in provider logs.' : 'Ứng dụng sẽ yêu cầu xóa phiên trên Firebase. Việc này không xóa lịch sử trình duyệt hoặc dữ liệu đã vào nhật ký nhà cung cấp.')}</p><div><button className="button button-secondary" autoFocus onClick={() => setConfirmClear(false)}>{en ? 'Keep it' : 'Giữ lại'}</button><button className="button button-danger" onClick={() => { setConfirmClear(false); void clear(); }}>{en ? 'Clear chat' : 'Xóa chat'}</button></div></section></div>}
    {confirmReplace && <div className="modal-backdrop"><section role="alertdialog" aria-modal="true" aria-labelledby="replace-title" aria-describedby="replace-description" className="confirm-dialog"><span className="dialog-icon"><RefreshCw size={23} /></span><h2 id="replace-title">{en ? 'Start a new conversation?' : 'Bắt đầu cuộc trò chuyện mới?'}</h2><p id="replace-description">{en ? 'The current payload is deleted before a new session is created. Usage counters are not reset.' : 'Phiên hiện tại và toàn bộ nội dung của phiên sẽ được xóa trước khi tạo phiên mới. Bộ đếm giới hạn sử dụng không được đặt lại.'}</p><div><button className="button button-secondary" autoFocus onClick={() => setConfirmReplace(false)}>{en ? 'Continue this chat' : 'Tiếp tục phiên này'}</button><button className="button button-danger" onClick={() => { const previousId = conversation.conversationId; setConfirmReplace(false); void start(undefined, previousId); }}>{en ? 'Delete old chat and start' : 'Xóa phiên cũ và bắt đầu mới'}</button></div></section></div>}
  </main>;
}

const helpLinks = [
  { name: 'Rights of Migrant Workers in Community', domain: 'migrants.org.au', url: 'https://migrants.org.au/legal-help/', category: 'Pháp lý', description: 'Hỗ trợ pháp lý cộng đồng dành cho lao động di cư tại NSW.' },
  { name: 'Fair Work Ombudsman', domain: 'fairwork.gov.au', url: 'https://www.fairwork.gov.au/', category: 'Lao động', description: 'Thông tin chính thức về lương, phiếu lương, nghỉ phép và quyền tại nơi làm việc.' },
  { name: 'Fair Work Commission', domain: 'fwc.gov.au', url: 'https://www.fwc.gov.au/apply-or-lodge/deadlines', category: 'Lao động', description: 'Thông tin thủ tục và thời hạn của Fair Work Commission.' },
  { name: 'Department of Home Affairs', domain: 'immi.homeaffairs.gov.au', url: 'https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/migrant-worker-protections', category: 'Visa', description: 'Thông tin chính thức về bảo vệ lao động di cư và thị thực.' },
  { name: 'Australian Taxation Office', domain: 'ato.gov.au', url: 'https://www.ato.gov.au/calculators-and-tools/super-report-unpaid-super-contributions-from-my-employer', category: 'Lao động', description: 'Trang ATO về superannuation chưa được đóng đúng.' },
  { name: 'Federal Register of Legislation', domain: 'legislation.gov.au', url: 'https://www.legislation.gov.au/C2009A00028/latest/text', category: 'Pháp lý', description: 'Văn bản pháp luật liên bang; nội dung chuyên sâu cần được đọc cùng ngoại lệ áp dụng.' },
  { name: 'SafeWork NSW', domain: 'safework.nsw.gov.au', url: 'https://www.safework.nsw.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn nơi làm việc tại New South Wales.' },
  { name: 'SIRA NSW', domain: 'sira.nsw.gov.au', url: 'https://www.sira.nsw.gov.au/workers-compensation/what-to-do-after-an-injury', category: 'An toàn', description: 'Thông tin NSW về bồi thường và việc cần làm sau chấn thương.' },
  { name: 'Independent Review Office NSW', domain: 'iro.nsw.gov.au', url: 'https://www.iro.nsw.gov.au/', category: 'Pháp lý', description: 'Thông tin hỗ trợ liên quan tranh chấp bồi thường lao động tại NSW.' },
  { name: 'Safe Work Australia', domain: 'safeworkaustralia.gov.au', url: 'https://www.safeworkaustralia.gov.au/law-and-regulation/whs-regulators-and-workers-compensation-authorities-contact-information', category: 'An toàn', description: 'Khung quốc gia và danh bạ cơ quan an toàn, bồi thường theo bang.' },
  { name: 'WorkSafe Victoria', domain: 'worksafe.vic.gov.au', url: 'https://www.worksafe.vic.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn và bồi thường lao động tại Victoria.' },
  { name: 'WorkSafe Queensland', domain: 'worksafe.qld.gov.au', url: 'https://www.worksafe.qld.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn và bồi thường lao động tại Queensland.' },
  { name: 'WorkSafe Western Australia', domain: 'worksafe.wa.gov.au', url: 'https://www.worksafe.wa.gov.au/workers-and-others-workplace', category: 'An toàn', description: 'Thông tin an toàn nơi làm việc tại Western Australia.' },
  { name: 'SafeWork South Australia', domain: 'safework.sa.gov.au', url: 'https://www.safework.sa.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn nơi làm việc tại South Australia.' },
  { name: 'WorkSafe Tasmania', domain: 'worksafe.tas.gov.au', url: 'https://worksafe.tas.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn nơi làm việc tại Tasmania.' },
  { name: 'WorkSafe ACT', domain: 'worksafe.act.gov.au', url: 'https://www.worksafe.act.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn nơi làm việc tại Australian Capital Territory.' },
  { name: 'NT WorkSafe', domain: 'worksafe.nt.gov.au', url: 'https://worksafe.nt.gov.au/', category: 'An toàn', description: 'Cơ quan an toàn nơi làm việc tại Northern Territory.' },
  { name: 'Anti-Discrimination NSW', domain: 'antidiscrimination.nsw.gov.au', url: 'https://antidiscrimination.nsw.gov.au/need-help/community-languages/vietnamese.html', category: 'Phân biệt', description: 'Thông tin NSW về phân biệt đối xử, gồm tài liệu tiếng Việt.' },
  { name: 'Australian Human Rights Commission', domain: 'humanrights.gov.au', url: 'https://humanrights.gov.au/complaints', category: 'Phân biệt', description: 'Thông tin liên bang về quyền con người và quy trình khiếu nại.' },
  { name: 'Legal Aid NSW', domain: 'legalaid.nsw.gov.au', url: 'https://www.legalaid.nsw.gov.au/my-problem-is-about/my-job', category: 'Pháp lý', description: 'Thông tin và phạm vi hỗ trợ pháp lý về việc làm tại NSW.' },
  { name: 'Immigration Advice and Rights Centre', domain: 'iarc.org.au', url: 'https://iarc.org.au/', category: 'Visa', description: 'Dịch vụ pháp lý cộng đồng về nhập cư; cần kiểm tra điều kiện từng chương trình.' },
  { name: 'Redfern Legal Centre', domain: 'rlc.org.au', url: 'https://rlc.org.au/', category: 'Pháp lý', description: 'Trung tâm pháp lý cộng đồng tại NSW; cần kiểm tra lĩnh vực và điều kiện hỗ trợ.' },
  { name: 'Migrant Workers Centre', domain: 'migrantworkers.org.au', url: 'https://www.migrantworkers.org.au/', category: 'Pháp lý', description: 'Tổ chức hỗ trợ lao động di cư tại Victoria.' },
  { name: "Tenants' Union of NSW", domain: 'tenants.org.au', url: 'https://www.tenants.org.au/', category: 'Nhà ở', description: 'Thông tin và dịch vụ hỗ trợ người thuê nhà tại NSW.' },
  { name: 'TIS National', domain: 'tisnational.gov.au', url: 'https://www.tisnational.gov.au/', category: 'Ngôn ngữ', description: 'Thông tin về dịch vụ phiên dịch quốc gia; kiểm tra chi phí và khả năng phục vụ trực tiếp.' },
  { name: 'NSW Anti-slavery Commissioner — help and support', domain: 'dcj.nsw.gov.au', url: 'https://dcj.nsw.gov.au/legal-and-justice/our-commissioners/anti-slavery-commissioner/reporting-help-and-support.html', category: 'Khẩn cấp', description: 'Liên kết hỗ trợ đã duyệt cho tình huống bóc lột hoặc nô lệ hiện đại tại NSW.' },
  { name: '1800RESPECT', domain: '1800respect.org.au', url: 'https://1800respect.org.au/', category: 'Khẩn cấp', description: 'Dịch vụ hỗ trợ về bạo lực gia đình, tình dục và lạm dụng; không phải cơ quan luật lao động.' },
  { name: 'Office of the Australian Information Commissioner', domain: 'oaic.gov.au', url: 'https://www.oaic.gov.au/privacy/your-privacy-rights', category: 'Riêng tư', description: 'Thông tin chính thức về quyền riêng tư và phạm vi pháp luật liên bang.' },
  { name: 'Triple Zero information', domain: 'infrastructure.gov.au', url: 'https://www.infrastructure.gov.au/media-communications/phone/triple-zero', category: 'Khẩn cấp', description: 'Thông tin chính thức về Triple Zero; trong nguy hiểm tức thời tại Australia hãy gọi 000.' },
];

function Help({ language }: { language: 'vi' | 'en' }) {
  const [filter, setFilter] = useState('Tất cả');
  const en = language === 'en';
  const filters = ['Tất cả', ...new Set(helpLinks.map((item) => item.category))];
  return <main className="help-page"><div className="help-hero"><span className="eyebrow">{en ? 'WHEN YOU WANT MORE SUPPORT' : 'KHI BẠN MUỐN TÌM HIỂU THÊM'}</span><h1>{en ? 'One small step.' : 'Một bước nhỏ.'}<br /><span>{en ? 'One more place to turn.' : 'Thêm một nơi hỗ trợ.'}</span></h1><p>{en ? <>You choose when and who to contact.<br />The app does not send your information to these services.</> : <>Bạn quyết định khi nào và với ai mình muốn nói chuyện.<br />Ứng dụng không gửi thông tin của bạn đến những nơi này.</>}</p></div><div className="directory-disclaimer"><Info size={19} /><p><strong>{en ? 'Static directory, not evidence cited in an answer.' : 'Danh bạ tĩnh, không phải nguồn đã tra cứu cho câu trả lời.'}</strong> {en ? 'Links open external websites. Check current scope, eligibility and hours directly with each service.' : 'Các liên kết sẽ mở trang bên ngoài. Hãy kiểm tra trực tiếp phạm vi, điều kiện và thời gian hỗ trợ trên website của từng nơi.'}</p></div><div className="help-filters" aria-label={en ? 'Filter directory' : 'Lọc danh bạ'}>{filters.map((item) => <button key={item} aria-pressed={item === filter} className={item === filter ? 'active' : ''} onClick={() => setFilter(item)}>{en && item === 'Tất cả' ? 'All' : item}</button>)}</div><section className="help-grid" aria-label={en ? 'Support websites' : 'Các trang hỗ trợ'}>{helpLinks.filter((item) => filter === 'Tất cả' || item.category === filter).map((item) => <a className="help-card" href={item.url} key={item.url} target="_blank" rel="noopener noreferrer"><div><span className="help-link-icon"><Globe2 size={22} /></span><span className="category-tag">{item.category}</span><ArrowUpRight size={21} /></div><h2>{item.name}</h2><p>{en ? 'External information or support page. Check its current scope and eligibility before relying on it.' : item.description}</p><span className="help-domain">{item.domain}<ExternalLink size={12} /></span></a>)}</section><section className="privacy-section"><span className="eyebrow">{en ? 'USE SAFELY' : 'CÁCH DÙNG AN TOÀN'}</span><h2>{en ? 'Know this before you begin.' : 'Bạn nên biết trước khi bắt đầu.'}</h2><div className="privacy-grid"><article><LockKeyhole size={22} /><h3>{en ? 'Share only what is needed' : 'Chỉ chia sẻ điều cần thiết'}</h3><p>{en ? 'Use fictional data in the demo. Do not enter real names, visa numbers, addresses, account details or identity documents.' : 'Dùng dữ liệu hư cấu khi thử demo. Không nhập tên thật, số visa, địa chỉ, thông tin tài khoản hoặc giấy tờ nhận dạng.'}</p></article><article><Trash2 size={22} /><h3>{en ? 'Understand deletion' : 'Hiểu đúng về việc xóa'}</h3><p>{chatMode === 'mock' ? (en ? 'The mock stays in page memory and disappears on refresh; no transcript is stored in browser storage.' : 'Bản mock giữ nội dung trong bộ nhớ trang, không gửi lên cloud. Tải lại sẽ mất chat. Không lưu transcript vào bộ nhớ trình duyệt.') : (en ? 'Chat is stored briefly in Firebase. Access expiry is not immediate deletion; TTL cleanup is asynchronous. Clear chat requests active deletion.' : 'Chat được lưu tạm trên Firebase. Hết hạn truy cập không có nghĩa xóa ngay. TTL là quá trình dọn bất đồng bộ; chủ động xóa chat yêu cầu dịch vụ xóa phiên.')}</p></article><article><DoorOpen size={22} /><h3>{en ? 'Quick Exit covers the page' : 'Thoát nhanh để che nội dung'}</h3><p>{en ? 'Quick Exit hides chat immediately and tries to close the session. It cannot erase browser history, screenshots or copies you made.' : 'Nút Thoát nhanh che chat ngay và đóng phiên khi có thể. Không xóa được lịch sử trình duyệt, ảnh chụp màn hình hoặc bản sao bạn đã tự tạo.'}</p></article><article><CircleHelp size={22} /><h3>{en ? 'Not individual advice' : 'Không thay thế hỗ trợ cá nhân'}</h3><p>{en ? 'This is not a lawyer, emergency service or official RMWC service. If you are in immediate danger in Australia, call 000.' : 'Đây không phải luật sư, dịch vụ khẩn cấp hay dịch vụ chính thức của RMWC. Nếu đang gặp nguy hiểm tức thời tại Australia, hãy gọi 000.'}</p></article></div></section></main>;
}

function Safe({ status, exiting, language }: { status: string; exiting: boolean; language: 'vi' | 'en' }) {
  const en = language === 'en';
  return <main className="safe-page"><div className="safe-circle"><Check size={29} strokeWidth={1.5} /></div><h1>{en ? 'Previous content is closed.' : 'Đã đóng nội dung trước đó.'}</h1><p role="status">{status}</p><small>{en ? 'This cannot erase browser history.' : 'Thao tác này không xóa lịch sử trình duyệt.'}</small>{!exiting && <Link to="/" replace>{en ? 'Start page' : 'Về trang bắt đầu'} <ChevronRight size={15} /></Link>}</main>;
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return <div className="error-notice" role="alert"><Info size={17} /><div>{children}</div></div>;
}

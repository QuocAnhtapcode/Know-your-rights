import { initializeApp, deleteApp, getApps } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, setPersistence, browserSessionPersistence, signInAnonymously, signOut, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { callableContracts, type ChatClient, type StartConversationRequest, type StartConversationResponse, type GetConversationRequest, type GetConversationResponse, type SendMessageRequest, type SendMessageResponse, type ClearConversationRequest, type ClearConversationResponse } from '../../shared/contracts';
import type { ChatMode, ClientSession } from './chat-client';

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`Thiếu cấu hình công khai ${name}. Chưa kết nối dịch vụ; không tự chuyển sang mock.`);
  return value.trim();
}

function endpoint(host: string | undefined, port: string | undefined, label: string) {
  const checkedHost = required(host, `${label}_HOST`);
  if (checkedHost !== '127.0.0.1' && checkedHost !== 'localhost') throw new Error(`${label} chỉ được trỏ đến loopback.`);
  const checkedPort = Number(required(port, `${label}_PORT`));
  if (!Number.isInteger(checkedPort) || checkedPort < 1 || checkedPort > 65_535) throw new Error(`${label}_PORT không hợp lệ.`);
  return { host: checkedHost, port: checkedPort };
}

/** Imported lazily only in explicit Firebase/emulator mode. Never imports server SDKs. */
export async function createFirebaseClient(mode: Exclude<ChatMode, 'mock'>): Promise<ClientSession> {
  const env = import.meta.env;
  const projectId = required(env.VITE_FIREBASE_PROJECT_ID, 'VITE_FIREBASE_PROJECT_ID');
  if (mode === 'emulator' && !projectId.startsWith('demo-')) throw new Error('Emulator chỉ chấp nhận project ID demo- để tránh truy cập project thật.');
  const authEndpoint = mode === 'emulator' ? endpoint(env.VITE_AUTH_EMULATOR_HOST, env.VITE_AUTH_EMULATOR_PORT, 'VITE_AUTH_EMULATOR') : undefined;
  const functionEndpoint = mode === 'emulator' ? endpoint(env.VITE_FUNCTIONS_EMULATOR_HOST, env.VITE_FUNCTIONS_EMULATOR_PORT, 'VITE_FUNCTIONS_EMULATOR') : undefined;
  const siteKey = mode === 'firebase' ? required(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY, 'VITE_RECAPTCHA_ENTERPRISE_SITE_KEY') : undefined;
  const appName = `kyr-web-${projectId}`;
  const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp({
    apiKey: required(env.VITE_FIREBASE_API_KEY, 'VITE_FIREBASE_API_KEY'),
    authDomain: required(env.VITE_FIREBASE_AUTH_DOMAIN, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId,
    appId: required(env.VITE_FIREBASE_APP_ID, 'VITE_FIREBASE_APP_ID'),
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  }, appName);
  try {
    if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    const auth = getAuth(app);
    if (authEndpoint) connectAuthEmulator(auth, `http://${authEndpoint.host}:${authEndpoint.port}`, { disableWarnings: false });
    await setPersistence(auth, browserSessionPersistence);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    const functions = getFunctions(app, required(env.VITE_FIREBASE_FUNCTIONS_REGION, 'VITE_FIREBASE_FUNCTIONS_REGION'));
    if (functionEndpoint) connectFunctionsEmulator(functions, functionEndpoint.host, functionEndpoint.port);
    const client: ChatClient = {
      async startConversation(input) {
        const contract = callableContracts.startConversation;
        const response = await httpsCallable<StartConversationRequest, StartConversationResponse>(functions, 'startConversation', { timeout: 130_000 })(contract.request.parse(input));
        return contract.response.parse(response.data);
      },
      async getConversation(input) {
        const contract = callableContracts.getConversation;
        const response = await httpsCallable<GetConversationRequest, GetConversationResponse>(functions, 'getConversation', { timeout: 130_000 })(contract.request.parse(input));
        return contract.response.parse(response.data);
      },
      async sendMessage(input) {
        const contract = callableContracts.sendMessage;
        const response = await httpsCallable<SendMessageRequest, SendMessageResponse>(functions, 'sendMessage', { timeout: 130_000 })(contract.request.parse(input));
        return contract.response.parse(response.data);
      },
      async clearConversation(input) {
        const contract = callableContracts.clearConversation;
        const response = await httpsCallable<ClearConversationRequest, ClearConversationResponse>(functions, 'clearConversation', { timeout: 130_000 })(contract.request.parse(input));
        return contract.response.parse(response.data);
      },
    };
    return { client, close: async () => { await signOut(auth); await deleteApp(app); } };
  } catch (error) {
    await deleteApp(app);
    throw error;
  }
}

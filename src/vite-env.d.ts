/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_MODE?: 'mock' | 'firebase' | 'emulator';
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_FUNCTIONS_REGION?: string;
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  readonly VITE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_AUTH_EMULATOR_PORT?: string;
  readonly VITE_FUNCTIONS_EMULATOR_HOST?: string;
  readonly VITE_FUNCTIONS_EMULATOR_PORT?: string;
}

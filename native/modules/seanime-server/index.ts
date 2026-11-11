import { NativeModule, requireNativeModule } from 'expo';

export type ServerState = 'idle' | 'starting' | 'retrying' | 'ready' | 'stopped' | 'error';

export type ServerStatus = {
  state: ServerState;
  message: string;
  port: number;
};

type SeanimeServerEvents = {
  onStatusChange: (status: ServerStatus) => void;
  onReady: (status: ServerStatus) => void;
};

declare class SeanimeServerModule extends NativeModule<SeanimeServerEvents> {
  /** 43212 in the test package, 43211 once the native app replaces com.seanime.app.local (E6). */
  readonly port: number;
  /** Starts the foreground service with the Go server; a running server is left alone. */
  start(): void;
  getStatus(): ServerStatus;
  /** Language of the service notification ('en' default). */
  setLanguage(language: 'en' | 'de'): void;
  /** Device facts for touch feedback (lib/feedback.ts): vibration motor, ringer on, other audio playing. */
  feedbackState(): FeedbackState;
  /** Settings Seanime Mobile 2.0.33 kept in SharedPreferences (only the keys that exist), see lib/legacy-preferences.ts. */
  legacyPreferences(): LegacyPreferences;
}

export type LegacyPreferences = {
  /** AppLanguage.kt "language": "en" | "de" */
  language?: string;
  /** Feedback.kt "feedback_haptics" / "feedback_sounds" */
  feedbackHaptics?: boolean;
  feedbackSounds?: boolean;
  /** notify/AiringNotifier.kt "enabled" and "announced" (JSON {mediaId: episode}) */
  airingEnabled?: boolean;
  airingAnnounced?: string;
};

export type FeedbackState = {
  hasVibrator: boolean;
  /** AudioManager.RINGER_MODE_*: 0 silent, 1 vibrate, 2 normal */
  ringerMode: number;
  musicActive: boolean;
};

const SeanimeServer = requireNativeModule<SeanimeServerModule>('SeanimeServer');

export default SeanimeServer;
export const SERVER_URL = `http://127.0.0.1:${SeanimeServer.port}`;

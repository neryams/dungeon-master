import type { DesktopApi } from '#desktop/contracts';
import type { SpeechInputApi } from '#desktop/contracts';
declare global {
  interface Window {
    table: DesktopApi;
    speechInput?: SpeechInputApi;
  }
}

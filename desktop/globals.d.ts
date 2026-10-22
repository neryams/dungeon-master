import type { DesktopApi } from '#desktop/contracts';
declare global {
  interface Window {
    table: DesktopApi;
  }
}

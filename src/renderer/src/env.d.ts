/// <reference types="vite/client" />
import type { AutoReelApi } from '../../shared/ipc';

declare global {
  interface Window {
    autoreel: AutoReelApi;
  }
}

export {};

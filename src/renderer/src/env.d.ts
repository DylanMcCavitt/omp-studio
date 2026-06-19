/// <reference types="vite/client" />
import type { OmpApi } from "@shared/ipc";

declare global {
  interface Window {
    omp: OmpApi;
  }
}

export {};

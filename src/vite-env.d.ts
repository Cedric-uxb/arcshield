/// <reference types="vite/client" />

import type { EIP1193Provider } from "viem";

declare global {
  interface Window {
    ethereum?: Pick<EIP1193Provider, "request">;
  }
}

export {};

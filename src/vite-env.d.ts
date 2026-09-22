/// <reference types="vite/client" />

import type { EIP1193Provider } from "viem";

interface InjectedProviderEventMap {
  chainChanged: (chainId: string) => void;
  accountsChanged: (accounts: string[]) => void;
}

declare global {
  interface Window {
    ethereum?: Pick<EIP1193Provider, "request"> & {
      on?<Event extends keyof InjectedProviderEventMap>(
        event: Event,
        listener: InjectedProviderEventMap[Event],
      ): void;
      removeListener?<Event extends keyof InjectedProviderEventMap>(
        event: Event,
        listener: InjectedProviderEventMap[Event],
      ): void;
    };
  }
}

export {};

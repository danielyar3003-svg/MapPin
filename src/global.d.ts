export {};

declare global {
  interface MappinBridge {
    pickGameFolder(): Promise<string | null>;
    exists(root: string, path: string): Promise<boolean>;
    readFile(root: string, path: string): Promise<Uint8Array>;
    readRange(root: string, path: string, offset: number, length: number): Promise<Uint8Array>;
    saveText(defaultName: string, text: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
    openText(filters: { name: string; extensions: string[] }[]): Promise<{ path: string; text: string } | null>;
    getSetting(key: string): Promise<unknown>;
    setSetting(key: string, value: unknown): Promise<void>;
  }
  interface Window { mappin?: MappinBridge }
}

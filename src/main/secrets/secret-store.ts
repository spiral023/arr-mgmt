export type SecretAdapter = {
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
  isEncryptionAvailable: () => boolean;
};

export type SecretStore = {
  encrypt: (plaintext: string) => string;
  decrypt: (encrypted: string) => string;
};

export function createSecretStore(adapter: SecretAdapter): SecretStore {
  return {
    encrypt(plaintext: string): string {
      if (!adapter.isEncryptionAvailable()) {
        throw new Error("Secure storage is not available");
      }
      return adapter.encryptString(plaintext).toString("base64");
    },

    decrypt(encrypted: string): string {
      if (!adapter.isEncryptionAvailable()) {
        throw new Error("Secure storage is not available");
      }
      return adapter.decryptString(Buffer.from(encrypted, "base64"));
    },
  };
}

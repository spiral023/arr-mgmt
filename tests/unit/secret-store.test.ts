import { describe, expect, it } from "vitest";
import { createSecretStore } from "../../src/main/secrets/secret-store";

describe("secret store", () => {
  it("encrypts and decrypts API keys through an injected adapter", () => {
    const store = createSecretStore({
      encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^enc:/, ""),
      isEncryptionAvailable: () => true,
    });

    const encrypted = store.encrypt("plain-api-key");

    expect(encrypted).not.toContain("plain-api-key");
    expect(store.decrypt(encrypted)).toBe("plain-api-key");
  });

  it("fails clearly when encryption is unavailable", () => {
    const store = createSecretStore({
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
      isEncryptionAvailable: () => false,
    });

    expect(() => store.encrypt("key")).toThrow("Secure storage is not available");
  });
});

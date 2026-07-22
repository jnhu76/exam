import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getMessageForLocale,
  isSupportedLocale,
  errorMessages,
  fallbackMessages,
  getErrorMessage,
  type SupportedLocale,
} from "../index.js";

describe("i18n locale catalog", () => {
  describe("SupportedLocale constants", () => {
    it("DEFAULT_LOCALE is 'zh-CN'", () => {
      expect(DEFAULT_LOCALE).toBe("zh-CN");
    });

    it("SUPPORTED_LOCALES includes DEFAULT_LOCALE", () => {
      expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
    });

    it("isSupportedLocale returns true for zh-CN", () => {
      expect(isSupportedLocale("zh-CN")).toBe(true);
    });

    it("isSupportedLocale returns false for unknown locale", () => {
      expect(isSupportedLocale("en")).toBe(false);
      expect(isSupportedLocale("fr")).toBe(false);
      expect(isSupportedLocale("")).toBe(false);
    });
  });

  describe("getMessageForLocale", () => {
    it("returns zh-CN message for default locale", () => {
      const msg = getMessageForLocale("AUTH_REQUIRED", "zh-CN");
      expect(msg).toBe("请先登录");
    });

    it("falls back to zh-CN when locale is not supported", () => {
      const msg = getMessageForLocale("AUTH_REQUIRED", "en" as SupportedLocale);
      expect(msg).toBe("请先登录");
    });

    it("uses DEFAULT_LOCALE when locale is omitted", () => {
      const msg = getMessageForLocale("AUTH_REQUIRED");
      expect(msg).toBe(errorMessages.AUTH_REQUIRED);
    });

    it("returns correct message for every error code in zh-CN", () => {
      const codes = Object.keys(errorMessages) as Array<
        keyof typeof errorMessages
      >;
      for (const code of codes) {
        expect(getMessageForLocale(code, "zh-CN"), `code=${code}`).toBe(
          errorMessages[code],
        );
      }
    });

    it("returns fallbackMessages.unknownError for unknown codes", () => {
      expect(getMessageForLocale("UNKNOWN_CODE", "zh-CN")).toBe(
        fallbackMessages.unknownError,
      );
    });
  });

  describe("getErrorMessage backward compatibility", () => {
    it("getErrorMessage still works unchanged", () => {
      expect(getErrorMessage("AUTH_REQUIRED")).toBe("请先登录");
      expect(getErrorMessage("INTERNAL_ERROR")).toBe("服务器内部错误");
    });

    it("getMessageForLocale with DEFAULT_LOCALE equals getErrorMessage", () => {
      const codes = Object.keys(errorMessages) as Array<
        keyof typeof errorMessages
      >;
      for (const code of codes) {
        expect(getMessageForLocale(code, DEFAULT_LOCALE), `code=${code}`).toBe(
          getErrorMessage(code),
        );
      }
    });
  });
});

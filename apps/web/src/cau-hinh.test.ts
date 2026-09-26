// ==============================================================================================
// [ADR-068] CẤU HÌNH CỦA `apps/web`: HAI CHẾ ĐỘ LOẠI TRỪ NHAU, VÀ BỘ CHUYỂN TIẾP KHÔNG CHẠY Ở PRODUCTION
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";

describe("[ADR-068] docCauHinh — chế độ", () => {
  it("chuyển tiếp (lát cắt demo): TRUSTPROCURE_API_ORIGIN ngoài production", () => {
    expect(docCauHinh({ TRUSTPROCURE_API_ORIGIN: "http://127.0.0.1:8080" }).apiOrigin).toBe("http://127.0.0.1:8080");
  });

  it("chỉ tĩnh: apiOrigin null, kể cả ở production", () => {
    const ch = docCauHinh({ TRUSTPROCURE_WEB_STATIC_ONLY: "1", NODE_ENV: "production", TRUSTPROCURE_WEB_HOST: "0.0.0.0" });
    expect(ch.apiOrigin).toBeNull();
    expect(ch.listenHost).toBe("0.0.0.0");
  });

  it("production mà không chỉ tĩnh là lỗi khởi động — kể cả khi có TRUSTPROCURE_API_ORIGIN", () => {
    expect(() => docCauHinh({ NODE_ENV: "production", TRUSTPROCURE_API_ORIGIN: "http://api:8080" })).toThrow(/TRUSTPROCURE_WEB_STATIC_ONLY/u);
    expect(() => docCauHinh({ NODE_ENV: "production" })).toThrow(CauHinhError);
  });

  it("hai chế độ cùng lúc là lỗi; cờ chỉ nhận 1", () => {
    expect(() => docCauHinh({ TRUSTPROCURE_WEB_STATIC_ONLY: "1", TRUSTPROCURE_API_ORIGIN: "http://127.0.0.1:8080" })).toThrow(/loại trừ nhau/u);
    expect(() => docCauHinh({ TRUSTPROCURE_WEB_STATIC_ONLY: "true" })).toThrow(/chỉ nhận 1/u);
  });

  it("không khai chế độ nào ngoài production vẫn đòi TRUSTPROCURE_API_ORIGIN như trước", () => {
    expect(() => docCauHinh({})).toThrow(/TRUSTPROCURE_API_ORIGIN/u);
  });
});

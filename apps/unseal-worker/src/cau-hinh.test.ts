// ==============================================================================================
// [S1.82 / khoản 116] CẤU HÌNH CỦA WORKER MỞ THẦU — FAIL-CLOSED TỪNG BIẾN MỘT
//
// `docCauHinh` là hàm THUẦN, nên mọi ca "thiếu biến", "sai hình dạng" đo được ở T1 mà không cần
// một tiến trình. Cùng khuôn `apps/api/src/cau-hinh.test.ts`.
//
// Vế NẶNG NHẤT của tệp này không phải một ca lỗi — nó là ca ⑼: tiến trình này KHÔNG đọc ba vòng
// bí mật kia. Đó là một lời hứa sản phẩm (ADR-006: một tiến trình vừa mở được phong bì vừa mở
// được bí mật TOTP là đúng thứ G1 dựng hai vòng khoá riêng để chặn), và một lời hứa không ai đo
// là một lời hứa sẽ trôi.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";

const KHOA_32 = Buffer.alloc(32, 7).toString("base64");

function envDu(): Record<string, string> {
  return {
    TRUSTPROCURE_DATABASE_URL: "postgres://app_unseal_login:mk@127.0.0.1:5432/trustprocure",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
    TRUSTPROCURE_ALERT_DIR: "/tmp/trustprocure-canh-bao-dev",
  };
}

describe("[S1.82 / khoản 116] cấu hình worker mở thầu", () => {
  it("đối chứng dương: một môi trường ĐỦ đọc được, và đọc ra đúng giá trị", () => {
    const ch = docCauHinh(envDu());
    expect(ch.keyAdapter).toBe("local-dev");
    expect(ch.alertAdapter).toBe("dev-file");
    if (ch.keyAdapter !== "local-dev") throw new Error("fixture khai local-dev");
    expect(ch.masterKeys.active).toBe("v1");
    expect(ch.masterKeys.keys["v1"]?.length).toBe(32);
    // Hai mặc định, và chúng là mặc định CÓ CHỦ Ý — không phải bí mật.
    expect(ch.dbPoolMax).toBe(10);
    expect(ch.pollIntervalMs).toBe(1000);
  });

  it.each([
    "TRUSTPROCURE_DATABASE_URL",
    "TRUSTPROCURE_KEY_ADAPTER",
    "TRUSTPROCURE_MASTER_KEYS",
    "TRUSTPROCURE_MASTER_KEY_ACTIVE",
    "TRUSTPROCURE_ALERT_ADAPTER",
    "TRUSTPROCURE_ALERT_DIR",
  ])("thiếu %s thì NÉM, và thông điệp nêu ĐÚNG TÊN biến", (ten) => {
    const env = envDu();
    delete env[ten];
    expect(() => docCauHinh(env)).toThrow(CauHinhError);
    expect(() => docCauHinh(env)).toThrow(ten);
  });

  it("URL đăng nhập bằng một role KHÁC app_unseal_login thì NÉM", () => {
    // Lớp theo TÊN. Hardening chỉ giữ cặp (app_unseal, app_unseal_login) trong `CAP_HOP_LE`; mọi
    // tên khác bị gỡ membership ở lần migrate() sau, nên một URL khác tên là một cấu hình sẽ chết
    // giữa hai lần deploy — hoặc là superuser.
    for (const vai of ["postgres", "app_api_login", "app_unseal"]) {
      const env = { ...envDu(), TRUSTPROCURE_DATABASE_URL: `postgres://${vai}:mk@127.0.0.1:5432/db` };
      expect(() => docCauHinh(env), vai).toThrow(/app_unseal_login/);
    }
  });

  it("adapter mang một tên CHƯA TỒN TẠI thì NÉM, không âm thầm rơi về bản dev", () => {
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_KEY_ADAPTER: "kms" })).toThrow(/CHƯA TỒN TẠI/);
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_ALERT_ADAPTER: "pagerduty" })).toThrow(
      /CHƯA TỒN TẠI/,
    );
  });

  it("thư mục cảnh báo TƯƠNG ĐỐI thì NÉM — nó sẽ nằm trong cây repo khi chạy `pnpm worker:dev`", () => {
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_ALERT_DIR: "./canh-bao" })).toThrow(
      /TUYỆT ĐỐI/,
    );
  });

  it("vòng khoá: phiên bản trùng, base64 sai, phiên bản đang dùng không có trong vòng — đều NÉM", () => {
    const tr = { ...envDu(), TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32},v1=${KHOA_32}` };
    expect(() => docCauHinh(tr)).toThrow(/khai hai lần/);
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEYS: "v1=khong-phai-base64!" })).toThrow(
      /base64/,
    );
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEY_ACTIVE: "v9" })).toThrow(
      /không có trong/,
    );
  });

  it("[S1.82] KHÔNG đọc ba vòng bí mật của `apps/api` — đây là một LỜI HỨA SẢN PHẨM, không phải một thiếu sót", () => {
    // ADR-006: tiến trình mở phong bì thầu không được giữ thêm bí mật nào khác. Phép đo: đặt cả
    // ba biến với giá trị RÁC — nếu `docCauHinh` đọc bất kỳ cái nào, nó sẽ ném; nó KHÔNG được ném.
    const ch = docCauHinh({
      ...envDu(),
      TRUSTPROCURE_TOTP_MASTER_KEYS: "rac-khong-phai-base64!",
      TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "khong-ton-tai",
      TRUSTPROCURE_OTP_PEPPERS: "rac!",
      TRUSTPROCURE_OTP_PEPPER_ACTIVE: "rac!",
      TRUSTPROCURE_RECEIPT_SIGNING_KEYS: "rac!",
      TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "rac!",
    });
    // Và cấu hình trả về KHÔNG mang một trường nào cho chúng.
    expect(Object.keys(ch).sort()).toEqual([
      "alertAdapter",
      "alertDir",
      "databaseUrl",
      "dbPoolMax",
      "keyAdapter",
      "masterKeys",
      "pollIntervalMs",
    ]);
  });
});

// ==============================================================================================
// [ADR-064] Worker dưới `aws-kms`: đúng MỘT CMK (tp-org-wrap), không vòng khoá nào trong tiến trình.
// ==============================================================================================
function envKms(): Record<string, string> {
  const env: Record<string, string> = {
    ...envDu(),
    TRUSTPROCURE_KEY_ADAPTER: "aws-kms",
    TRUSTPROCURE_AWS_REGION: "ap-southeast-1",
    TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp-org-wrap",
  };
  delete env["TRUSTPROCURE_MASTER_KEYS"];
  delete env["TRUSTPROCURE_MASTER_KEY_ACTIVE"];
  return env;
}

describe("[ADR-064] cấu hình worker với khoá aws-kms", () => {
  it("đọc vùng và CMK bọc khoá tổ chức; KHÔNG đọc CMK của TOTP hay khoá ký dù chúng có mặt", () => {
    const ch = docCauHinh({
      ...envKms(),
      TRUSTPROCURE_KMS_TOTP_KEY_ID: "alias/tp-totp",
      TRUSTPROCURE_KMS_RECEIPT_KEY_ID: "alias/tp-receipt-sign",
    });
    expect(ch.keyAdapter).toBe("aws-kms");
    if (ch.keyAdapter !== "aws-kms") throw new Error("không tới");
    expect(ch.kms).toEqual({ region: "ap-southeast-1", orgWrapKeyId: "alias/tp-org-wrap" });
    expect(Object.keys(ch).sort()).toEqual([
      "alertAdapter",
      "alertDir",
      "databaseUrl",
      "dbPoolMax",
      "keyAdapter",
      "kms",
      "pollIntervalMs",
    ]);
  });

  it.each(["TRUSTPROCURE_AWS_REGION", "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID"])("thiếu %s thì NÉM, nêu đúng tên", (ten) => {
    const env = envKms();
    delete env[ten];
    expect(() => docCauHinh(env)).toThrow(ten);
  });

  it("hai bộ biến khoá loại trừ nhau: aws-kms kèm vòng master key còn sót, hay local-dev kèm CMK ⇒ NÉM", () => {
    expect(() => docCauHinh({ ...envKms(), TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32}` })).toThrow(/TRUSTPROCURE_MASTER_KEYS.*ADR-064/u);
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp-org-wrap" })).toThrow(
      /TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID.*ADR-064/u,
    );
  });

  it("vùng hay định danh CMK sai hình dạng ⇒ NÉM", () => {
    expect(() => docCauHinh({ ...envKms(), TRUSTPROCURE_AWS_REGION: "singapore" })).toThrow(CauHinhError);
    expect(() => docCauHinh({ ...envKms(), TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID: "alias/tp org" })).toThrow(CauHinhError);
  });
});

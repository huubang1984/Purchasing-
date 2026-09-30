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
//
// [S1.9125 / khoản 172] Và phép đo cũ của ca ⑼ đo HẸP hơn lời hứa: *"không ném, và đúng các trường ấy ở tầng trên cùng"* xanh cả
// trong một thế giới mà `docCauHinh` VẪN đọc ba vòng ấy rồi vứt đi (đo: đột biến đọc-rồi-vứt ở biên bản §S1.9125 — ca cũ xanh). Nay
// vế ĐỌC của ca ⑼ đo bằng HÀNH VI ở khối cuối tệp: nguồn cấu hình là một Proxy GHI từng tên được đọc giá trị, và tập tên ấy không được
// giao với bí mật của `apps/api`. Cùng khối đo quy tắc ⑵ của `cau-hinh.ts` bằng hành vi: mọi biến mà `docCauHinh` đọc — tập lấy từ
// chính nguồn ghi lượt đọc, không từ một danh sách viết tay — mang một giá trị lạ thì bị từ chối nêu TÊN, và giá trị ấy không có trong
// thông điệp (`main.ts` in thẳng thông điệp ra log).
// ==============================================================================================

import { readFileSync } from "node:fs";
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
    // [khoản 196 / ADR-074] Ngưỡng lệch đồng hồ và nhịp canh — cùng mặc định với `apps/api`.
    expect(ch.lechDongHoToiDaMs).toBe(2000);
    expect(ch.chuKyCanhDongHoMs).toBe(60_000);
  });

  it("[khoản 196] ngưỡng lệch đồng hồ và nhịp canh đọc từ môi trường, ngoài miền thì NÉM nêu đúng tên", () => {
    const ch = docCauHinh({ ...envDu(), TRUSTPROCURE_CLOCK_SKEW_MAX_MS: "500", TRUSTPROCURE_CLOCK_SKEW_CHECK_MS: "1000" });
    expect(ch.lechDongHoToiDaMs).toBe(500);
    expect(ch.chuKyCanhDongHoMs).toBe(1000);
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_CLOCK_SKEW_MAX_MS: "0" })).toThrow("TRUSTPROCURE_CLOCK_SKEW_MAX_MS");
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_CLOCK_SKEW_CHECK_MS: "10" })).toThrow("TRUSTPROCURE_CLOCK_SKEW_CHECK_MS");
  });

  it("[ADR-083] nhịp dòng tồn đọng outbox: mặc định 5 phút, đọc từ môi trường, ngoài miền hay sai hình dạng thì NÉM nêu đúng tên", () => {
    expect(docCauHinh(envDu()).chuKyTonDongMs).toBe(300_000);
    expect(docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: "60000" }).chuKyTonDongMs).toBe(60_000);
    expect(docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: " " }).chuKyTonDongMs).toBe(300_000);
    expect(docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: "1000" }).chuKyTonDongMs).toBe(1000);
    expect(docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: "3600000" }).chuKyTonDongMs).toBe(3_600_000);
    for (const sai of ["999", "3600001", "0", "-1", "5m", "1e5", "300000.5"]) {
      expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: sai }), sai).toThrow(CauHinhError);
      expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_OUTBOX_TON_DONG_MS: sai }), sai).toThrow("TRUSTPROCURE_OUTBOX_TON_DONG_MS");
    }
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
    // ba biến với giá trị RÁC — ~~nếu `docCauHinh` đọc bất kỳ cái nào, nó sẽ ném; nó KHÔNG được ném.~~
    // [S1.9125 / khoản 172] nếu `docCauHinh` đọc VÀ PHÂN TÍCH bất kỳ cái nào, nó sẽ ném — đọc rồi vứt thì không ném, và ca này vẫn
    // xanh (đo bằng đột biến, §S1.9125). Ca này giữ vế ĐẦU RA (cấu hình không mang trường nào cho ba vòng); vế ĐỌC đo ở khối
    // `[S1.9125 / khoản 172]` cuối tệp, bằng nguồn ghi lượt đọc.
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
      "chuKyCanhDongHoMs",
      "chuKyTonDongMs",
      "databaseUrl",
      "dbPoolMax",
      "keyAdapter",
      "lechDongHoToiDaMs",
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
    // [S1.9125 / khoản 172] Ca này đo vế ĐẦU RA; vế ĐỌC ("KHÔNG đọc" ở tên ca) đo ở khối cuối tệp — hai CMK ấy nằm trong
    // `BIEN_BI_MAT_CUA_API`, và cảnh `aws-kms` là một trong ba cảnh của phép đo.
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
      "chuKyCanhDongHoMs",
      "chuKyTonDongMs",
      "databaseUrl",
      "dbPoolMax",
      "keyAdapter",
      "kms",
      "lechDongHoToiDaMs",
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

// ==============================================================================================
// [ADR-065] Cảnh báo `ses`: vùng, địa chỉ gửi, danh sách người nhận; loại trừ thư mục dev.
// ==============================================================================================
function envSes(): Record<string, string> {
  const env: Record<string, string> = {
    ...envDu(),
    TRUSTPROCURE_ALERT_ADAPTER: "ses",
    TRUSTPROCURE_SES_REGION: "ap-southeast-1",
    TRUSTPROCURE_SES_FROM: "canh-bao@thu.vidu.vn",
    TRUSTPROCURE_ALERT_EMAILS: "a@vidu.vn, b@vidu.vn",
  };
  delete env["TRUSTPROCURE_ALERT_DIR"];
  return env;
}

describe("[ADR-065] cấu hình cảnh báo worker qua SES", () => {
  it("đọc vùng, địa chỉ gửi, danh sách người nhận (cắt khoảng trắng); không còn alertDir", () => {
    const ch = docCauHinh(envSes());
    if (ch.alertAdapter !== "ses") throw new Error("fixture khai ses");
    expect(ch.ses).toEqual({
      region: "ap-southeast-1",
      tuDiaChi: "canh-bao@thu.vidu.vn",
      denDiaChi: ["a@vidu.vn", "b@vidu.vn"],
      configurationSet: undefined,
    });
    expect(Object.keys(ch)).not.toContain("alertDir");
  });

  it.each(["TRUSTPROCURE_SES_REGION", "TRUSTPROCURE_SES_FROM", "TRUSTPROCURE_ALERT_EMAILS"])("thiếu %s thì NÉM, nêu đúng tên", (ten) => {
    const env = envSes();
    delete env[ten];
    expect(() => docCauHinh(env)).toThrow(ten);
  });

  it("danh sách sai (mục không phải email, trùng, rỗng) và hai bộ biến lẫn nhau ⇒ NÉM", () => {
    expect(() => docCauHinh({ ...envSes(), TRUSTPROCURE_ALERT_EMAILS: "a@vidu.vn, khong-email" })).toThrow(CauHinhError);
    expect(() => docCauHinh({ ...envSes(), TRUSTPROCURE_ALERT_EMAILS: "a@vidu.vn,a@vidu.vn" })).toThrow(/trùng/u);
    expect(() => docCauHinh({ ...envSes(), TRUSTPROCURE_ALERT_EMAILS: " , " })).toThrow(CauHinhError);
    expect(() => docCauHinh({ ...envSes(), TRUSTPROCURE_ALERT_DIR: "/tmp/x" })).toThrow(/TRUSTPROCURE_ALERT_DIR.*ADR-065/u);
    expect(() => docCauHinh({ ...envDu(), TRUSTPROCURE_ALERT_EMAILS: "a@vidu.vn" })).toThrow(/TRUSTPROCURE_ALERT_EMAILS.*ADR-065/u);
  });
});

// ==============================================================================================
// [S1.9125 / khoản 172] ĐO BẰNG HÀNH VI — NGUỒN CẤU HÌNH GHI LƯỢT ĐỌC
//
// Hai lời khai của `cau-hinh.ts`, đo bằng thứ `docCauHinh` LÀM chứ không bằng thứ nó trả về:
//   ⑼ tiến trình mở phong bì KHÔNG đọc giá trị bí mật nào của `apps/api` — ba vòng (TOTP, pepper OTP, khoá ký biên nhận, cùng biến
//      `…_ACTIVE` của chúng) và hai CMK của `aws-kms` (ADR-064) — ở cả ba cảnh (local-dev + dev-file, aws-kms, ses), qua tham số lẫn
//      qua `process.env` đọc thẳng (trong lúc gọi, `process.env` cũng là một nguồn ghi lượt đọc);
//   ⑵ thông điệp lỗi chỉ nêu TÊN biến và điều kiện, không bao giờ nêu GIÁ TRỊ — `main.ts` in thẳng thông điệp của `CauHinhError` ra
//      log. Tập biến được đo là tập mà nguồn ghi lượt đọc THẤY `docCauHinh` đọc ở mỗi cảnh, nên một biến mới tự vào phép đo.
// Đo trước trên mã trước vòng này (§S1.9125 mục 3): ⑵ đỏ đúng ở hai biến adapter, ba cảnh (`docAdapter` in `${ten} = "${v}"`); ⑼ xanh
// trên mã thật và ĐỎ với đột biến đọc-rồi-vứt ba vòng — đột biến mà ca ⑼ cũ để xanh.
// ==============================================================================================

type MoiTruongDoc = Readonly<Record<string, string | undefined>>;

/**
 * Bí mật và lối vào bí mật của `apps/api` mà tiến trình này không được đọc. Tên đối chiếu với nguồn của `apps/api` ở một ca đối chứng
 * — một tên thiu (api đổi tên biến) làm phép đo rỗng ruột mà không ai kêu.
 */
const BIEN_BI_MAT_CUA_API: readonly string[] = [
  "TRUSTPROCURE_TOTP_MASTER_KEYS",
  "TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE",
  "TRUSTPROCURE_OTP_PEPPERS",
  "TRUSTPROCURE_OTP_PEPPER_ACTIVE",
  "TRUSTPROCURE_RECEIPT_SIGNING_KEYS",
  "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE",
  "TRUSTPROCURE_KMS_TOTP_KEY_ID",
  "TRUSTPROCURE_KMS_RECEIPT_KEY_ID",
];

/** Ba cảnh của `docCauHinh` — mỗi adapter khoá và mỗi adapter cảnh báo có mặt ở ít nhất một cảnh. */
const CANH: readonly (readonly [string, () => Record<string, string>])[] = [
  ["local-dev + dev-file", envDu],
  ["aws-kms + dev-file", envKms],
  ["local-dev + ses", envSes],
];

/**
 * Một giá trị LẠ: không phải adapter nào, số, URI, base64, email hay vùng; có khoảng trắng nên mọi phép kiểm hình dạng của tệp đều
 * từ chối nó. `DAU_VET` là phần phải KHÔNG có mặt trong thông điệp.
 */
const DAU_VET = "GIA-TRI-LA-5b1f9c";
const GIA_TRI_LA = `${DAU_VET} khong hop le`;

/**
 * Nguồn cấu hình GHI LƯỢT ĐỌC: một Proxy trên bản sao của bản đồ tên → chuỗi, ghi mọi tên được đọc GIÁ TRỊ — qua bẫy `get`
 * (`env[ten]`, `env.ten`, trải `{...env}`, `Object.entries`/`values`, `JSON.stringify`) và bẫy `getOwnPropertyDescriptor` (bộ mô tả
 * mang giá trị; `Object.keys` cũng đi qua bẫy này, nên liệt kê tên cũng bị tính — nghiêng về phía an toàn). KHÔNG ném: một bản cấu
 * hình bọc lượt đọc trong `try` nuốt được lỗi ném từ bẫy, còn tên đã ghi thì không nuốt được.
 */
function nguonGhiLuotDoc(env: Record<string, string | undefined>): { readonly nguon: MoiTruongDoc; readonly daDoc: ReadonlySet<string> } {
  const daDoc = new Set<string>();
  const nguon = new Proxy<Record<string, string | undefined>>(
    { ...env },
    {
      get(dich, ten, nhan): unknown {
        if (typeof ten === "string") daDoc.add(ten);
        return Reflect.get(dich, ten, nhan);
      },
      getOwnPropertyDescriptor(dich, ten) {
        if (typeof ten === "string") daDoc.add(ten);
        return Reflect.getOwnPropertyDescriptor(dich, ten);
      },
    },
  );
  return { nguon, daDoc };
}

/** Mọi bí mật của api CÓ MẶT với giá trị ĐÚNG hình dạng — một bản cấu hình đọc và dùng chúng cũng không ném. */
function coMatBiMatApi(env: Record<string, string>): Record<string, string> {
  return {
    ...env,
    TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${KHOA_32}`,
    TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "t1",
    TRUSTPROCURE_OTP_PEPPERS: `p1=${KHOA_32}`,
    TRUSTPROCURE_OTP_PEPPER_ACTIVE: "p1",
    TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `ky-2026=${KHOA_32}`,
    TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "ky-2026",
    TRUSTPROCURE_KMS_TOTP_KEY_ID: "alias/tp-totp",
    TRUSTPROCURE_KMS_RECEIPT_KEY_ID: "alias/tp-receipt-sign",
  };
}

function thongDiepLoi(viec: () => unknown): string {
  try {
    viec();
  } catch (loi) {
    expect(loi).toBeInstanceOf(CauHinhError);
    return (loi as CauHinhError).message;
  }
  throw new Error("docCauHinh lẽ ra phải NÉM");
}

/** ⑵ Mỗi cảnh × mỗi biến mà nguồn ghi lượt đọc thấy `docCauHinh` đọc trên môi trường nền của cảnh ấy. */
const CA_QUY_TAC_2 = CANH.flatMap(([canh, env]) => {
  const { nguon, daDoc } = nguonGhiLuotDoc(env());
  docCauHinh(nguon);
  return [...daDoc].sort().map((bien) => ({ canh, bien, env }));
});

describe("[S1.9125 / khoản 172] đo bằng hành vi — nguồn cấu hình ghi lượt đọc", () => {
  it("ĐỐI CHỨNG: nguồn ghi lượt đọc thấy mọi lối đọc giá trị — `env[ten]`, trải, `Object.entries`/`values`, `JSON.stringify`, bộ mô tả", () => {
    const loiDoc: readonly (readonly [string, (e: MoiTruongDoc) => unknown])[] = [
      ["env[ten]", (e) => e["TRUSTPROCURE_OTP_PEPPERS"]],
      ["trải {...env}", (e) => ({ ...e })],
      ["Object.entries", (e) => Object.entries(e)],
      ["Object.values", (e) => Object.values(e)],
      ["JSON.stringify", (e) => JSON.stringify(e)],
      ["getOwnPropertyDescriptor", (e) => Object.getOwnPropertyDescriptor(e, "TRUSTPROCURE_OTP_PEPPERS")?.value as unknown],
    ];
    for (const [nhan, doc] of loiDoc) {
      const { nguon, daDoc } = nguonGhiLuotDoc(coMatBiMatApi(envDu()));
      doc(nguon);
      expect(daDoc.has("TRUSTPROCURE_OTP_PEPPERS"), nhan).toBe(true);
    }
  });

  it("ĐỐI CHỨNG: tám tên bí mật vẫn là tên biến mà `apps/api/src/cau-hinh.ts` đọc — danh sách không thiu", () => {
    const nguonApi = readFileSync(new URL("../../api/src/cau-hinh.ts", import.meta.url), "utf8");
    for (const ten of BIEN_BI_MAT_CUA_API) expect(nguonApi, ten).toContain(`"${ten}"`);
  });

  it.each(CANH)("⑼ cảnh %s: `docCauHinh` KHÔNG đọc giá trị bí mật nào của `apps/api` — và CÓ đọc khoá của chính nó", (_canh, env) => {
    const { nguon, daDoc } = nguonGhiLuotDoc(coMatBiMatApi(env()));
    // Lối vòng qua tham số: một bản cấu hình đọc thẳng `process.env` thì bẫy trên `nguon` không thấy. Trong lúc gọi (đồng bộ),
    // `process.env` cũng là một nguồn ghi lượt đọc mang đủ bí mật của api; `finally` trả lại bản gốc.
    const { nguon: envTienTrinh, daDoc: daDocTienTrinh } = nguonGhiLuotDoc(coMatBiMatApi(env()));
    const envGoc = process.env;
    process.env = envTienTrinh;
    let ch: ReturnType<typeof docCauHinh>;
    try {
      ch = docCauHinh(nguon);
    } finally {
      process.env = envGoc;
    }
    expect([...daDoc].filter((ten) => BIEN_BI_MAT_CUA_API.includes(ten))).toEqual([]);
    expect([...daDocTienTrinh].filter((ten) => BIEN_BI_MAT_CUA_API.includes(ten)), "đọc thẳng process.env").toEqual([]);
    // Đối chứng dương trên CÙNG lượt: nguồn thấy lượt đọc của chính `docCauHinh` — khoá của chính tiến trình.
    expect(daDoc.has(ch.keyAdapter === "local-dev" ? "TRUSTPROCURE_MASTER_KEYS" : "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID")).toBe(true);
  });

  it("⑵ ĐỐI CHỨNG chống rỗng ruột: tập biến đo được phủ URL CSDL, hai adapter, vòng khoá, CMK, thư mục, SES — và cả biến VẮNG mặt", () => {
    const theoCanh = (canh: string): string[] => CA_QUY_TAC_2.filter((c) => c.canh === canh).map((c) => c.bien);
    for (const [canh] of CANH) {
      for (const bien of ["TRUSTPROCURE_DATABASE_URL", "TRUSTPROCURE_KEY_ADAPTER", "TRUSTPROCURE_ALERT_ADAPTER"]) {
        expect(theoCanh(canh), `${canh}: ${bien}`).toContain(bien);
      }
    }
    expect(theoCanh("local-dev + dev-file")).toEqual(expect.arrayContaining(["TRUSTPROCURE_MASTER_KEYS", "TRUSTPROCURE_ALERT_DIR"]));
    expect(theoCanh("aws-kms + dev-file")).toContain("TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID");
    expect(theoCanh("local-dev + ses")).toEqual(expect.arrayContaining(["TRUSTPROCURE_SES_FROM", "TRUSTPROCURE_ALERT_EMAILS"]));
    // Biến KHÔNG có trong môi trường nền mà `docCauHinh` vẫn hỏi — số có mặc định, biến của adapter kia (phép loại trừ). Bẫy thấy
    // chúng vì `docCauHinh` đọc thẳng từ nguồn; một bản cấu hình chép cả môi trường (`{...env}`) rồi đọc bản chép làm tập này co về
    // đúng các khoá có mặt, và vế ⑵ mù với mọi biến vắng — ca này đỏ khi đó (đột biến M6, §S1.9125), không chỉ ⑼.
    expect(theoCanh("local-dev + dev-file")).toEqual(
      expect.arrayContaining(["TRUSTPROCURE_DB_POOL_MAX", "TRUSTPROCURE_OUTBOX_TON_DONG_MS", "TRUSTPROCURE_KMS_ORG_WRAP_KEY_ID", "TRUSTPROCURE_SES_FROM"]),
    );
  });

  it.each(CA_QUY_TAC_2)("⑵ cảnh $canh: $bien mang một giá trị lạ ⇒ `CauHinhError` nêu TÊN biến, KHÔNG nêu giá trị", ({ bien, env }) => {
    const thongDiep = thongDiepLoi(() => docCauHinh({ ...env(), [bien]: GIA_TRI_LA }));
    expect(thongDiep).toContain(bien);
    expect(thongDiep).not.toContain(DAU_VET);
  });

  it("⑵ ranh giới ở vòng khoá: TÊN phiên bản (qua `TEN_PHIEN_BAN`) là một TÊN và được nêu; vật liệu khoá sau `=` KHÔNG BAO GIỜ", () => {
    const KHOA_KHAC = Buffer.alloc(32, 9).toString("base64");
    const trung = thongDiepLoi(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32},v1=${KHOA_KHAC}` }));
    expect(trung).toContain('"v1"');
    const rac = "c2VjcmV0LWtob25n!khong-phai-base64";
    const saiBase64 = thongDiepLoi(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEYS: `v1=${rac}` }));
    expect(saiBase64).toContain('"v1"');
    // Một khoá 32 byte dán thiếu tên phiên bản, hay dán ngược `<khoá>=v1`: 43 ký tự trước dấu `=` đệm không lọt `TEN_PHIEN_BAN`
    // (1–32 ký tự) ⇒ thông điệp không nêu tên nào — một khoá 32 byte ở bất kỳ mã hoá chuẩn nào (base64 44, hex 64) dài hơn trần tên.
    const thieuTen = thongDiepLoi(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEYS: KHOA_32 }));
    const nguoc = thongDiepLoi(() => docCauHinh({ ...envDu(), TRUSTPROCURE_MASTER_KEYS: `${KHOA_32}=v1` }));
    for (const [nhan, td] of [["trùng", trung], ["sai base64", saiBase64], ["thiếu tên", thieuTen], ["ngược", nguoc]] as const) {
      for (const vatLieu of [KHOA_32.slice(0, 12), KHOA_KHAC.slice(0, 12), rac]) expect(td, `${nhan} lộ vật liệu khoá`).not.toContain(vatLieu);
    }
  });
});

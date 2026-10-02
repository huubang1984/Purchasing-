// ==============================================================================================
// [2026-10-02 / khoản 336] HÌNH DẠNG CẢNH BÁO ⑴ CỦA STACK 60 — MỌI THAO TÁC GHI CỦA KeyAdmin RA THƯ
//
// Trước khoản 336, ⑴ chỉ bắt `PutKeyPolicy`, trong khi KeyAdmin tắt khoá, hẹn xoá khoá, đổi và xoá alias được mà không thư nào
// đi. Bốn mốc:
//   ⑴ mẫu: nguồn `aws.kms`, chỉ lời gọi API qua CloudTrail, `detail` chỉ có eventSource và eventName — không lọc người gọi,
//      không lọc errorCode (lần bị từ chối cũng ra thư).
//   ⑵ `local.su_kien_ghi_khoa` PHỦ mọi hành động không đọc mà KeyAdmin giữ — statement `KeyAdminQuanTriKhongDung` của
//      `modules/quan-tri-khoa` (key policy) cộng statement `QuanTriKhoa` của stack 20 (permission set) —, ký tự đại diện khai
//      triển theo DANH_MUC; mọi tên trong mẫu có trong danh mục (một tên gõ sai không bao giờ khớp sự kiện nào), không tên đọc,
//      không tên dùng khoá (Sign/Decrypt… — `api` gọi chúng mỗi lượt, thư sẽ ngập).
//   ⑶ rule audit và rule chuyển tiếp của prod cùng dùng mẫu ấy; prod chuyển sang default bus của audit.
//   ⑷ thư nêu thao tác, khoá, alias, khoá đích, số ngày chờ xoá và errorCode; mọi biến của mẫu thư đều được khai.
// Rủi ro còn lại, không mốc nào ở đây bắt: AWS thêm một thao tác mới khớp `Update*`/`Enable*`/`Disable*` của key policy —
// DANH_MUC chưa có nó thì khai triển bỏ sót. Đọc lại danh mục khi sửa tệp này.
// Đọc bằng regex như các test hình dạng khác — dự án không có phụ thuộc HCL.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF60 = doc("infra/terraform/60-canh-bao/main.tf");
const MODULE = doc("infra/terraform/modules/quan-tri-khoa/main.tf");
const TF20 = doc("infra/terraform/20-management/main.tf");

// Mọi thao tác của KMS theo tên quyền IAM — AWS KMS API Reference, trang "Actions", đọc 2026-10-02 (54 thao tác; `ReEncrypt`
// của API là hai quyền `ReEncryptFrom`/`ReEncryptTo`).
const DANH_MUC = [
  "CancelKeyDeletion", "ConnectCustomKeyStore", "CreateAlias", "CreateCustomKeyStore", "CreateGrant", "CreateKey", "Decrypt",
  "DeleteAlias", "DeleteCustomKeyStore", "DeleteImportedKeyMaterial", "DeriveSharedSecret", "DescribeCustomKeyStores",
  "DescribeKey", "DisableKey", "DisableKeyRotation", "DisconnectCustomKeyStore", "EnableKey", "EnableKeyRotation", "Encrypt",
  "GenerateDataKey", "GenerateDataKeyPair", "GenerateDataKeyPairWithoutPlaintext", "GenerateDataKeyWithoutPlaintext",
  "GenerateMac", "GenerateRandom", "GetKeyLastUsage", "GetKeyPolicy", "GetKeyRotationStatus", "GetParametersForImport",
  "GetPublicKey", "ImportKeyMaterial", "ListAliases", "ListGrants", "ListKeyPolicies", "ListKeyRotations", "ListKeys",
  "ListResourceTags", "ListRetirableGrants", "PutKeyPolicy", "ReEncryptFrom", "ReEncryptTo", "ReplicateKey", "RetireGrant",
  "RevokeGrant", "RotateKeyOnDemand", "ScheduleKeyDeletion", "Sign", "TagResource", "UntagResource", "UpdateAlias",
  "UpdateCustomKeyStore", "UpdateKeyDescription", "UpdatePrimaryRegion", "Verify", "VerifyMac",
];

const laDoc = (ten: string): boolean => /^(?:Describe|Get|List)/u.test(ten);
const laDungKhoa = (ten: string): boolean =>
  /^(?:Encrypt|Decrypt|ReEncrypt|Generate|Sign|Verify|DeriveSharedSecret)/u.test(ten);

/** Danh sách `actions` ngay sau `sid = "<sid>"`. */
function hanhDong(van: string, sid: string): string[] {
  const m = new RegExp(`\\bsid\\s*=\\s*"${sid}"\\n\\s*actions\\s*=\\s*\\[([\\s\\S]*?)\\]`, "u").exec(van);
  expect(m, `không đọc được actions của statement ${sid}`).not.toBeNull();
  const ten = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/gu)].map((x) => x[1] ?? "");
  expect(ten.length, `statement ${sid} rỗng`).toBeGreaterThan(0);
  return ten;
}

/** `kms:Update*` ⇒ mọi thao tác của danh mục bắt đầu bằng `Update`; tên trần phải có trong danh mục. */
function khaiTrien(quyen: string): string[] {
  expect(quyen, `quyền ngoài KMS: ${quyen}`).toMatch(/^kms:[A-Za-z*]+$/u);
  const ten = quyen.slice("kms:".length);
  if (ten.endsWith("*")) {
    const dau = ten.slice(0, -1);
    expect(dau, `ký tự đại diện chỉ được ở cuối: ${quyen}`).not.toContain("*");
    const khop = DANH_MUC.filter((x) => x.startsWith(dau));
    expect(khop.length, `${quyen} không khớp thao tác nào trong danh mục`).toBeGreaterThan(0);
    return khop;
  }
  expect(DANH_MUC, `${quyen} không có trong danh mục KMS`).toContain(ten);
  return [ten];
}

/** Thân `resource "<loai>" "<ten>" { … }` (tới dấu `}` đầu dòng). */
function khoi(loai: string, ten: string): string {
  const dau = TF60.indexOf(`\nresource "${loai}" "${ten}" {\n`);
  expect(dau, `không thấy ${loai}.${ten}`).toBeGreaterThan(-1);
  const sau = TF60.slice(dau + 1);
  return sau.slice(0, sau.indexOf("\n}\n") + 2);
}

function suKien(): string[] {
  const m = /\n {2}su_kien_ghi_khoa = \[\n([\s\S]*?)\n {2}\]\n/u.exec(TF60);
  expect(m, "không đọc được local.su_kien_ghi_khoa").not.toBeNull();
  const dong = (m?.[1] ?? "").split("\n");
  for (const d of dong) expect(d, "mỗi dòng của su_kien_ghi_khoa là đúng một tên trong ngoặc kép").toMatch(/^ {4}"[A-Za-z]+",$/u);
  return dong.map((d) => d.trim().slice(1, -2));
}

describe("[khoản 336] cảnh báo ⑴ của stack 60 bắt mọi thao tác ghi của KeyAdmin", () => {
  it("⑴ mẫu: aws.kms, lời gọi API qua CloudTrail, detail CHỈ có eventSource và eventName", () => {
    const m = /\n {2}mau_ghi_khoa = jsonencode\(\{\n([\s\S]*?)\n {2}\}\)\n/u.exec(TF60);
    expect(m, "không đọc được local.mau_ghi_khoa").not.toBeNull();
    expect(m?.[1]).toBe(
      [
        '    source      = ["aws.kms"]',
        '    detail-type = ["AWS API Call via CloudTrail"]',
        "    detail = {",
        '      eventSource = ["kms.amazonaws.com"]',
        "      eventName   = local.su_kien_ghi_khoa",
        "    }",
      ].join("\n"),
    );
    expect(TF60).not.toContain("mau_put_key_policy");
  });

  it("⑵ su_kien_ghi_khoa phủ mọi hành động không đọc của KeyAdmin (key policy + permission set), sau khai triển", () => {
    const keyAdmin = [...hanhDong(MODULE, "KeyAdminQuanTriKhongDung"), ...hanhDong(TF20, "QuanTriKhoa")];
    const ghi = [...new Set(keyAdmin.flatMap(khaiTrien))].filter((x) => !laDoc(x)).sort();
    const coTrongMau = suKien();
    expect(ghi.filter((x) => !coTrongMau.includes(x)), "hành động ghi của KeyAdmin mà ⑴ không bắt").toEqual([]);
    // Những tên nguy hiểm nhất của khoản 336 — ghim tường minh, để một lần sửa danh mục hay khai triển không làm rơi chúng.
    for (const x of ["PutKeyPolicy", "DisableKey", "ScheduleKeyDeletion", "UpdateAlias", "DeleteAlias", "DisableKeyRotation"]) {
      expect(coTrongMau).toContain(x);
    }
  });

  it("⑵ mọi tên trong mẫu là một thao tác KMS có thật, không đọc, không dùng khoá; xếp theo chữ cái, không trùng", () => {
    const coTrongMau = suKien();
    expect(coTrongMau.filter((x) => !DANH_MUC.includes(x)), "tên không có trong danh mục — không bao giờ khớp").toEqual([]);
    expect(coTrongMau.filter(laDoc), "tên đọc — CloudTrail không đưa lên EventBridge").toEqual([]);
    expect(coTrongMau.filter(laDungKhoa), "tên dùng khoá — api gọi mỗi lượt, thư ngập").toEqual([]);
    expect(coTrongMau).toEqual([...new Set(coTrongMau)].sort());
  });

  it("⑶ rule audit và rule chuyển tiếp của prod cùng dùng mẫu ấy; prod chuyển sang default bus của audit", () => {
    expect(khoi("aws_cloudwatch_event_rule", "put_key_policy_audit")).toMatch(/\n {2}provider {6}= aws\.audit\n/u);
    expect(khoi("aws_cloudwatch_event_rule", "put_key_policy_audit")).toContain("\n  event_pattern = local.mau_ghi_khoa\n");
    expect(khoi("aws_cloudwatch_event_rule", "put_key_policy_prod")).toMatch(/\n {2}provider {6}= aws\.prod\n/u);
    expect(khoi("aws_cloudwatch_event_rule", "put_key_policy_prod")).toContain("\n  event_pattern = local.mau_ghi_khoa\n");
    expect(TF60.match(/event_pattern = local\.mau_ghi_khoa\n/gu)).toHaveLength(2);
    const chuyen = khoi("aws_cloudwatch_event_target", "put_key_policy_prod");
    expect(chuyen).toContain("\n  rule     = aws_cloudwatch_event_rule.put_key_policy_prod.name\n");
    expect(chuyen).toContain("\n  arn      = local.bus_audit_arn\n");
    expect(khoi("aws_cloudwatch_event_target", "put_key_policy_audit")).toContain(
      "\n  arn      = aws_sns_topic.canh_bao_khoa.arn\n",
    );
  });

  it("⑷ thư nêu thao tác, khoá, alias, khoá đích, số ngày chờ xoá, errorCode; mọi biến của mẫu thư đều được khai", () => {
    const dich = khoi("aws_cloudwatch_event_target", "put_key_policy_audit");
    const duong = new Map([...dich.matchAll(/\n {6}([A-Za-z]+) += "(\$\.[^"]+)"/gu)].map((x) => [x[1] ?? "", x[2] ?? ""]));
    expect(Object.fromEntries(duong)).toMatchObject({
      lenh: "$.detail.eventName",
      ai: "$.detail.userIdentity.arn",
      khoa: "$.detail.requestParameters.keyId",
      alias: "$.detail.requestParameters.aliasName",
      khoaDich: "$.detail.requestParameters.targetKeyId",
      ngayCho: "$.detail.requestParameters.pendingWindowInDays",
      loi: "$.detail.errorCode",
    });
    const mau = /\n {4}input_template = "(.*)"\n/u.exec(dich)?.[1] ?? "";
    expect(mau, "không đọc được input_template").not.toBe("");
    const bien = [...new Set([...mau.matchAll(/<([A-Za-z]+)>/gu)].map((x) => x[1] ?? ""))].sort();
    expect(bien).toEqual([...duong.keys()].sort());
    expect(mau).toMatch(/^\\"\[TrustProcure\] <lenh> tren khoa KMS\./u);
  });
});

// ==============================================================================================
// [S1.9101] LỆNH CỦA LẦN APPLY ĐẦU STACK 90 — BA CHỖ HỎNG ĐO ĐƯỢC TRƯỚC KHI NGƯỜI VẬN HÀNH CHẠY THẬT
//
// Lượt rà `docs/APPLY-LAN-DAU.md` mục 6–8 tìm ba lệnh viết đúng cú pháp mà vẫn hỏng trên đường thật; mỗi cái hỏng KHÔNG ồn:
//   ⑴ 6.2: sau `apply -target aws_acm_certificate.api`, Terraform chỉ ghi output mà MỌI phụ thuộc nằm trong tập target —
//      `ban_ghi_dns` còn đọc ALB nên "Output not found" (đo trên 1.13.3), không có CNAME xác minh, 6.4 chờ ACM tới hết hạn.
//      Ghim: output `xac_minh_acm` chỉ đọc chứng chỉ, và CẢ HAI tài liệu đọc nó ngay sau lần apply có `-target`.
//   ⑵ 8.1: AWS CLI đọc `file://` ở chế độ văn bản (bỏ `\r`), `Get-FileHash` băm byte trên đĩa — tệp CRLF cho hai băm khác
//      nhau và task từ chối mãi. Ghim: khối lệnh kiểm CR TRƯỚC khi băm.
//   ⑶ README stack 85 bước 3: `Set-Content -Encoding utf8` của Windows PowerShell 5.1 ghi BOM vào secret Zalo. Ghim: khối
//      lệnh ghi tệp không BOM (`WriteAllText`) và không còn `Set-Content`/`Out-File`.
// Đọc bằng chuỗi như các test `hinh-dang-*` khác — cái giá (bám cách viết) là chủ đích.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const TF90 = doc("infra/terraform/90-ecs/main.tf");
const README = doc("infra/terraform/README.md");
const APPLY = doc("docs/APPLY-LAN-DAU.md");

/** Khối mã ``` đầu tiên sau `moc` mà chứa `can`. */
function khoiMa(van: string, moc: string, can: string): string {
  const batDau = van.indexOf(moc);
  expect(batDau, `không thấy mốc "${moc}"`).toBeGreaterThan(-1);
  const khoi = [...van.slice(batDau).matchAll(/```[a-z]*\n([\s\S]*?)```/gu)].map((m) => m[1] ?? "").find((k) => k.includes(can));
  expect(khoi, `không thấy khối mã chứa "${can}" sau "${moc}"`).toBeDefined();
  return khoi ?? "";
}

describe("[S1.9101] lệnh của lần apply đầu", () => {
  it("⑴ output xac_minh_acm chỉ đọc chứng chỉ; 6.2 và README bước 2 đọc nó ngay sau apply -target", () => {
    const batDau = TF90.indexOf('output "xac_minh_acm" {\n');
    expect(batDau).toBeGreaterThan(-1);
    const than = TF90.slice(batDau, TF90.indexOf("\n}\n", batDau));
    expect([...new Set(than.match(/\baws_[a-z0-9_]+\.[a-z0-9_]+/gu) ?? [])]).toEqual(["aws_acm_certificate.api"]);
    expect(than).not.toMatch(/\b(local|data|module)\./u);
    for (const [ten, khoi] of [
      ["APPLY-LAN-DAU 6.2", khoiMa(APPLY, "### 6.2", "-target aws_acm_certificate.api")],
      ["README bước 2", khoiMa(README, "**2. Apply hai bước**", "-target aws_acm_certificate.api")],
    ] as const) {
      const apply = khoi.indexOf("-target aws_acm_certificate.api");
      const doc_ = khoi.indexOf("terraform output xac_minh_acm");
      expect(doc_, `${ten} không đọc xac_minh_acm`).toBeGreaterThan(apply);
      expect(khoi, `${ten} còn đọc ban_ghi_dns sau -target`).not.toContain("terraform output ban_ghi_dns");
    }
  });

  it("⑵ 8.1 kiểm CR trước khi băm bản khai", () => {
    const khoi = khoiMa(APPLY, "## 8. Tổ chức đầu tiên", "Get-FileHash");
    const cr = khoi.indexOf('.Contains("`r")');
    expect(cr).toBeGreaterThan(-1);
    expect(cr).toBeLessThan(khoi.indexOf("Get-FileHash"));
  });

  it("⑶ README stack 85 bước 3 ghi secret Zalo không BOM", () => {
    const khoi = khoiMa(README, "3. Nạp secret", "tp/api/zalo-oa");
    expect(khoi).toContain("[IO.File]::WriteAllText(");
    expect(khoi).not.toMatch(/Set-Content|Out-File/u);
  });
});

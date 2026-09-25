// ==============================================================================================
// [ADR-061 ⒞] LỜI GỌI KMS TRẢ BÍ MẬT DẠNG RÕ CHỈ ĐƯỢC NẰM Ở PHÍA MỞ KHOÁ — VÀ "PHÍA MỞ KHOÁ" SUY TỪ
// CHÍNH `.dependency-cruiser.cjs`, KHÔNG TỪ MỘT DANH SÁCH TÊN VIẾT Ở ĐÂY
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO CẦN, KHI IAM ĐÃ CHẶN
// ----------------------------------------------------------------------------------------------
// ADR-061 đặt ranh giới ở key policy: `tp-api` chỉ có `GenerateDataKeyPairWithoutPlaintext`,
// `Decrypt` bị `Deny` tường minh cho mọi principal ngoài `tp-unseal-worker`. Lớp ấy chặn LÚC CHẠY,
// trên tài khoản thật — tức một lời gọi `DecryptCommand` lọt vào `apps/api` chỉ lộ ra khi chạy trên
// prod, và dự án không có staging (ADR-061, bối cảnh triển khai). Tệp này dời phát hiện ấy về lúc
// review: mã GỌI một lệnh trả bí mật dạng rõ mà nằm ngoài phía mở khoá thì đỏ trước khi merge.
//
// ----------------------------------------------------------------------------------------------
// "PHÍA MỞ KHOÁ" LÀ MỘT TÍNH CHẤT ĐÃ ĐƯỢC CƯỠNG CHẾ Ở CHỖ KHÁC — NÊN ĐỌC NÓ, ĐỪNG CHÉP NÓ
// ----------------------------------------------------------------------------------------------
// Một tệp được phép gọi lệnh giải mã khi và chỉ khi:
//   ⑴ nó nằm dưới `apps/unseal-worker/`, HOẶC
//   ⑵ nó là ĐÍCH (`to.path`, trừ `to.pathNot`) của một quy tắc depcruise họ `g1-khong-giai-ma-` hay
//     `g8-khong-mo-` — tức một quy tắc đã giới hạn ai import được nó về đúng `unseal-worker`.
// Vế ⑵ nghĩa là: một adapter `aws-kms` tương lai muốn đặt `DecryptCommand` vào
// `packages/crypto-keys/src/aws-kms-unwrapper.ts` thì PHẢI viết thêm một quy tắc `g1-khong-giai-ma-`
// cho tệp ấy trước — và `[INV-G1]` ở `boundaries.test.ts` canh tiếp chuỗi miễn trừ của quy tắc đó.
// Không ai phải nhớ sửa một danh sách ở đây.
//
// ----------------------------------------------------------------------------------------------
// ĐO CÁI GÌ, VÀ KHÔNG ĐO CÁI GÌ — nói đúng mức
// ----------------------------------------------------------------------------------------------
// Bốn lệnh KMS trả (hay dùng quyền mở ra) bí mật dạng rõ: `Decrypt`, `ReEncrypt`, `GenerateDataKey`,
// `GenerateDataKeyPair`. Ba hình dạng gọi: lớp lệnh SDK v3 (`DecryptCommand`), phương thức của client
// gộp (`new KMS().decrypt(` — chỉ tính khi tệp nhắc `@aws-sdk/client-kms`, vì `subtle().decrypt(` của
// WebCrypto là hợp lệ và đang có ở `sealed-envelope/src/unseal.ts`), và gọi HTTP trần
// (`TrentService.Decrypt`). Bản `...WithoutPlaintext` KHÔNG bị bắt — đó chính là quyền ADR-061 trao
// cho `api`.
// **Không bảo đảm:** tên lệnh ghép lúc chạy (`cmds["De" + "crypt"]`), hay một SDK khác bọc KMS. Đó
// là giới hạn của một phép đọc văn bản; lớp chặn thật vẫn là key policy.
// Tệp test (`*.test.*`, `tests/`) nằm ngoài phạm vi: phép đo ⒜ của ADR-061 CẦN gọi `Decrypt` dưới
// role `tp-api` để chứng minh nó bị từ chối.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const GOC = join(import.meta.dirname, "../..");

interface QuyTac {
  name?: string;
  to?: { path?: string | string[]; pathNot?: string | string[] };
}

const cauHinh = require("../../.dependency-cruiser.cjs") as { forbidden: QuyTac[] };
const { ciPrefix } = require("../../dependency-cruiser-ci.cjs") as {
  ciPrefix: (p: string) => string;
};

const HO_PHIA_MO_KHOA = /^(g1-khong-giai-ma-|g8-khong-mo-)/;
const UNSEAL_WORKER = new RegExp(ciPrefix("apps/unseal-worker/"));

const LENH = String.raw`(Decrypt|ReEncrypt|GenerateDataKey|GenerateDataKeyPair)`;
const RE_LOP_LENH = new RegExp(String.raw`\b${LENH}Command\b`);
const RE_HTTP_TRAN = new RegExp(String.raw`TrentService\.${LENH}\b`);
const RE_PHUONG_THUC = /\.(decrypt|reEncrypt|generateDataKey|generateDataKeyPair)\s*\(/;
const GOI_KMS = "@aws-sdk/client-kms";

const mang = (x: string | string[] | undefined): string[] => (x === undefined ? [] : [x].flat());

/** Dựng vị từ "tệp này thuộc phía mở khoá" từ các quy tắc depcruise đã cho. */
export function viTuPhiaMoKhoa(quyTac: readonly QuyTac[]): (duong: string) => boolean {
  const dich = quyTac
    .filter((q) => HO_PHIA_MO_KHOA.test(q.name ?? ""))
    .map((q) => ({
      co: mang(q.to?.path).map((p) => new RegExp(p)),
      tru: mang(q.to?.pathNot).map((p) => new RegExp(p)),
    }));
  return (duong) =>
    UNSEAL_WORKER.test(duong) ||
    dich.some((d) => d.co.some((r) => r.test(duong)) && !d.tru.some((r) => r.test(duong)));
}

/** Trả về các lời gọi giải mã tìm thấy trong một tệp, dạng `dòng:đoạn`. */
export function loiGoiGiaiMa(noiDung: string): string[] {
  const coSdk = noiDung.includes(GOI_KMS);
  const ra: string[] = [];
  noiDung.split("\n").forEach((dong, i) => {
    const m =
      RE_LOP_LENH.exec(dong) ?? RE_HTTP_TRAN.exec(dong) ?? (coSdk ? RE_PHUONG_THUC.exec(dong) : null);
    if (m) ra.push(`${i + 1}:${m[0]}`);
  });
  return ra;
}

export function viPhamGiaiMaKms(
  tep: ReadonlyArray<{ readonly duong: string; readonly noiDung: string }>,
  laPhiaMoKhoa: (duong: string) => boolean,
): string[] {
  return tep.flatMap((t) =>
    laPhiaMoKhoa(t.duong) ? [] : loiGoiGiaiMa(t.noiDung).map((g) => `${t.duong}:${g}`),
  );
}

const LA_TEP_MA = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const LA_TEP_TEST = /(^|\/)tests\/|\.test\.[cm]?[jt]sx?$/;

function tepMaKhongPhaiTest(): Array<{ duong: string; noiDung: string }> {
  return execFileSync("git", ["ls-files", "--deduplicate"], { cwd: GOC, encoding: "utf8" })
    .split("\n")
    .filter((d) => LA_TEP_MA.test(d) && !LA_TEP_TEST.test(d))
    .map((duong) => ({ duong, noiDung: readFileSync(join(GOC, duong), "utf8") }));
}

const laPhiaMoKhoa = viTuPhiaMoKhoa(cauHinh.forbidden);

describe("[ADR-061 ⒞] lời gọi KMS trả bí mật dạng rõ chỉ nằm ở phía mở khoá", () => {
  it("kho hiện tại: không tệp mã nào ngoài phía mở khoá gọi Decrypt/ReEncrypt/GenerateDataKey*", () => {
    const tep = tepMaKhongPhaiTest();
    expect(tep.length, "git ls-files không trả về tệp mã nào — phép đo rỗng ruột").toBeGreaterThan(50);
    expect(viPhamGiaiMaKms(tep, laPhiaMoKhoa)).toEqual([]);
  });

  it("vị từ phía mở khoá đọc được từ depcruise, không rỗng, và không nuốt mặt bọc", () => {
    // Đối chứng dương: ba cửa mở khoá đang có phải được nhận ra.
    for (const d of [
      "packages/crypto-keys/src/unwrap.ts",
      "packages/crypto-keys/src/local-dev-unwrapper.ts",
      "packages/sealed-envelope/src/unseal.ts",
      "apps/unseal-worker/src/main.ts",
    ]) {
      expect(laPhiaMoKhoa(d), d).toBe(true);
    }
    // Đối chứng âm: mặt bọc, api, và một tệp CHƯA có quy tắc đều KHÔNG phải phía mở khoá.
    for (const d of [
      "packages/crypto-keys/src/index.ts",
      "packages/crypto-keys/src/local-dev-wrapper.ts",
      "packages/crypto-keys/src/aws-kms-unwrapper.ts",
      "apps/api/src/composition.ts",
    ]) {
      expect(laPhiaMoKhoa(d), d).toBe(false);
    }
  });

  it("đột biến: xoá họ quy tắc g1-/g8- thì các cửa mở khoá rơi khỏi vị từ", () => {
    const khongHo = viTuPhiaMoKhoa(
      cauHinh.forbidden.filter((q) => !HO_PHIA_MO_KHOA.test(q.name ?? "")),
    );
    expect(khongHo("packages/crypto-keys/src/unwrap.ts")).toBe(false);
    expect(khongHo("apps/unseal-worker/src/main.ts")).toBe(true);
  });

  it("bắt đủ ba hình dạng gọi, và tha đúng quyền ADR-061 trao cho api", () => {
    const tep = [
      { duong: "apps/api/src/a.ts", noiDung: "await kms.send(new DecryptCommand({ CiphertextBlob }));" },
      { duong: "apps/api/src/b.ts", noiDung: 'import { KMS } from "@aws-sdk/client-kms";\nawait new KMS({}).generateDataKey({});' },
      { duong: "apps/api/src/c.ts", noiDung: 'headers["X-Amz-Target"] = "TrentService.ReEncrypt";' },
      { duong: "packages/crypto-keys/src/aws-kms-unwrapper.ts", noiDung: "new GenerateDataKeyPairCommand({})" },
      // Phải ĐƯỢC tha:
      { duong: "apps/api/src/d.ts", noiDung: "new GenerateDataKeyPairWithoutPlaintextCommand({ KeyPairSpec })" },
      { duong: "apps/api/src/e.ts", noiDung: "new GenerateDataKeyWithoutPlaintextCommand({})" },
      { duong: "packages/sealed-envelope/src/x.ts", noiDung: "await subtle().decrypt(alg, key, data);" },
      { duong: "apps/unseal-worker/src/k.ts", noiDung: "new DecryptCommand({})" },
      { duong: "packages/crypto-keys/src/unwrap.ts", noiDung: "new DecryptCommand({})" },
    ];
    expect(viPhamGiaiMaKms(tep, laPhiaMoKhoa)).toEqual([
      "apps/api/src/a.ts:1:DecryptCommand",
      "apps/api/src/b.ts:2:.generateDataKey(",
      "apps/api/src/c.ts:1:TrentService.ReEncrypt",
      "packages/crypto-keys/src/aws-kms-unwrapper.ts:1:GenerateDataKeyPairCommand",
    ]);
  });
});

// ==============================================================================================
// tools/pilot-gia-lap — HAI PHÉP KIỂM ĐỘC LẬP VỚI TIẾN TRÌNH `api`
//
// ⑴ Biên nhận: nhà cung cấp kiểm chữ ký bằng KHOÁ CÔNG KHAI MỘT MÌNH, lấy từ
//    `/.well-known/trustprocure-receipt-keys` của `apps/public-keys` — tiến trình không cầm khoá riêng
//    nào (ADR-070) — chứ không từ cấu hình của bộ giả lập. Đó là đường một nhà cung cấp thật đi.
// ⑵ Bộ bằng chứng: hai tệp tải qua HTTP được đưa cho `pnpm bang-chung kiem`, chạy ở một tiến trình
//    riêng KHÔNG có biến CSDL nào — cùng phép đo mà bước 12j của kịch bản 41 dùng.
// ==============================================================================================

import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyReceipt } from "@trustprocure/bidding";
import { GOC_KHO, moiTruongSach } from "./cum.js";
import { layChuoi, layMang } from "./http.js";

export async function layKhoaBienNhan(khoaGoc: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const r = await fetch(`${khoaGoc}/.well-known/trustprocure-receipt-keys`);
  if (r.status !== 200) throw new Error(`tài liệu khoá biên nhận trả ${r.status}`);
  const than: unknown = await r.json();
  const ra = new Map<string, Uint8Array>();
  for (const k of layMang(than, "keys")) ra.set(layChuoi(k, "kid"), new Uint8Array(Buffer.from(layChuoi(k, "spki"), "base64")));
  return ra;
}

/** Kiểm một biên nhận: chọn khoá theo dòng `kid=` của chính văn bản chính tắc. */
export async function kiemBienNhan(khoa: ReadonlyMap<string, Uint8Array>, canonicalText: string, signatureB64: string): Promise<boolean> {
  const kid = /^kid=(.+)$/mu.exec(canonicalText)?.[1];
  const k = kid === undefined ? undefined : khoa.get(kid);
  if (k === undefined) return false;
  return verifyReceipt({ canonicalText, signature: new Uint8Array(Buffer.from(signatureB64, "base64")), publicKey: k });
}

export interface KetQuaKiemBo {
  readonly ok: boolean;
  readonly maThoat: number | null;
  readonly dong: string;
}

/** `pnpm bang-chung kiem --bo <thư mục>` ở tiến trình riêng, môi trường không có CSDL. */
export function kiemBoBangChung(thuMucBo: string): Promise<KetQuaKiemBo> {
  return new Promise((xong) => {
    const con = spawn(
      process.execPath,
      [
        "--experimental-transform-types",
        "--import",
        pathToFileURL(join(GOC_KHO, "tools", "bo-xuat-danh-gia", "register-ts-resolve.mjs")).href,
        join(GOC_KHO, "tools", "bo-xuat-danh-gia", "src", "index.ts"),
        "kiem",
        "--bo",
        thuMucBo,
      ],
      { cwd: GOC_KHO, env: { ...moiTruongSach(process.env), NODE_ENV: "development" }, windowsHide: true },
    );
    let ra = "";
    con.stdout.on("data", (b: Buffer) => (ra += b.toString("utf8")));
    con.stderr.on("data", (b: Buffer) => (ra += b.toString("utf8")));
    con.on("error", () => xong({ ok: false, maThoat: null, dong: "không dựng được tiến trình kiểm" }));
    con.on("close", (ma) => {
      const dong = ra.trim().split(/\r?\n/u).filter((d) => d.includes("ok=")).at(-1) ?? ra.trim().split(/\r?\n/u).at(-1) ?? "";
      xong({ ok: ma === 0 && /\bok=true\b/u.test(ra), maThoat: ma, dong: dong.slice(0, 200) });
    });
  });
}

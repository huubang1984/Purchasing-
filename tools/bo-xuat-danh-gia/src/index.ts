// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] `pnpm bang-chung` — XUẤT VÀ KIỂM BỘ BẰNG CHỨNG ĐÁNH GIÁ
//
// Bước cuối của định nghĩa hoàn thành ở `docs/PRODUCT.md` §11: *"người mua chọn nhà cung cấp và
// xuất được bộ bằng chứng kiểm toán của trọn chuỗi ấy"*. Công cụ này là nửa *tính lại được* của
// bước ấy — nửa *sổ có bị sửa không* là `pnpm neo`, một artefact khác, ký bằng một khoá khác.
//
// ----------------------------------------------------------------------------------------------
// `kiem` KHÔNG ĐỌC `DATABASE_URL`, VÀ ĐÓ LÀ CẢ MỆNH ĐỀ
// ----------------------------------------------------------------------------------------------
// ADR-059 §*Đo bằng gì* ⒜: bundle phải tái lập được **mà không cần cơ sở dữ liệu**. Nếu khâu kiểm
// đòi cơ sở dữ liệu thì thứ gọi là *artefact độc lập* vẫn phải đi qua chính hệ thống bị kiểm —
// cùng lý do `pnpm neo trich` không mở pool (ADR-026 §5⑶).
//
// Nên `kiem` chỉ đọc một THƯ MỤC. Nó chạy được trên một máy chưa từng nghe tên dự án này, và
// `bo-xuat.int.test.ts` đo đúng điều đó bằng cách chạy nó với `DATABASE_URL` đã xoá khỏi môi
// trường.
// ==============================================================================================

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import { createPool } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { DANG_BUNDLE, PHIEN_BAN_BUNDLE, TEP_DAC_TA, TEP_DU_LIEU, docBo, type BoBangChung } from "./bo.js";
import { DAC_TA } from "./dac-ta.js";
import { docMoiLuotCham, docMoiTraoThau } from "./doc-tu-csdl.js";
import { kiemBo } from "./kiem.js";

const CACH_DUNG = `Cách dùng:
  pnpm bang-chung xuat --org <uuid> --rfq <uuid> --ra <thu-muc>
  pnpm bang-chung kiem --bo <thu-muc>

Biến môi trường:
  DATABASE_URL   bắt buộc cho "xuat"; "kiem" KHÔNG đọc nó và không mở kết nối nào.

"xuat" ghi hai tệp: ${TEP_DU_LIEU} (dữ liệu) và ${TEP_DAC_TA} (đặc tả phép tính, đủ để cài lại).
`;

type Lenh = "xuat" | "kiem";

function batBuoc(ten: string): string {
  const gt = env[ten];
  if (gt === undefined || gt.trim() === "") throw new Error(`Thiếu biến môi trường ${ten}.`);
  return gt.trim();
}

/**
 * Bộ phân tích tham số chặt: mỗi cờ nêu ĐÚNG một lần, không cờ lạ.
 *
 * Chặt chứ không dễ dãi, vì một lượt xuất im lặng bỏ qua `--rfq` viết sai sẽ ghi ra một bundle
 * RỖNG trông như một gói thầu chưa chấm lần nào. Cùng lý do bộ phân tích của `trich` chặt hơn
 * `docDanhSachToChuc` (review lượt 11 — H11-10).
 */
function docCo(thamSo: readonly string[], can: readonly string[]): ReadonlyMap<string, string> {
  const ra = new Map<string, string>();
  for (let i = 0; i < thamSo.length; i += 1) {
    const co = thamSo[i];
    if (co === undefined || !co.startsWith("--")) throw new Error(`Tham số lạ: "${String(co)}".`);
    const ten = co.slice(2);
    if (!can.includes(ten)) throw new Error(`Cờ lạ: "${co}". Cần: ${can.map((c) => `--${c}`).join(" ")}.`);
    if (ra.has(ten)) throw new Error(`--${ten} nêu nhiều lần.`);
    const gt = thamSo[i + 1];
    if (gt === undefined || gt.startsWith("--")) throw new Error(`--${ten} cần một giá trị.`);
    ra.set(ten, gt);
    i += 1;
  }
  for (const c of can) if (!ra.has(c)) throw new Error(`Thiếu --${c}.`);
  return ra;
}

function bam(vanBan: string): string {
  return createHash("sha256").update(Buffer.from(vanBan, "utf8")).digest("hex");
}

async function xuat(thamSo: readonly string[]): Promise<number> {
  const co = docCo(thamSo, ["org", "rfq", "ra"]);
  const orgId = co.get("org") ?? "";
  const rfqId = co.get("rfq") ?? "";
  const ra = co.get("ra") ?? "";

  const pool = createPool(batBuoc("DATABASE_URL"), 2, {
    role: "app_api",
    // Công cụ này đứng NGOÀI tầm cổng `pool-nghe-du-tin-hieu` (`TEP_APP` chỉ đọc `apps/`); lớp
    // `'error'` nằm trong `createPool`, dòng dưới chỉ thêm phần chẩn đoán. Cùng khuôn `pnpm neo`.
    onPoolError: (e) => console.error(`[bang-chung] pool loi ${e instanceof Error ? e.name : "loi la"}`),
  });
  try {
    const { luotCham, traoThau } = await withTenant(pool, orgId, async (client) => ({
      luotCham: await docMoiLuotCham(client, orgId, rfqId),
      traoThau: await docMoiTraoThau(client, orgId, rfqId),
    }));

    if (luotCham.length === 0) {
      // KHÔNG ghi một bundle rỗng. Một thư mục trông như một bộ bằng chứng mà không mang phép đo
      // nào là thứ tệ hơn không có thư mục nào — cùng luật với `kiemBo` từ chối một lượt kiểm
      // không đo được gì.
      stderr.write(`Gói thầu ${rfqId} chưa được chấm lần nào — không có gì để xuất.\n`);
      return 1;
    }

    const bo: BoBangChung = {
      dang: DANG_BUNDLE,
      phienBan: PHIEN_BAN_BUNDLE,
      dacTaPhienBan: 1,
      dacTaSha256: bam(DAC_TA),
      orgId,
      rfqId,
      xuatLuc: {
        giaTri: new Date().toISOString(),
        nguon: "đồng hồ của tiến trình xuất — KHÔNG được chứng thực; không đầu vào nào của phép tính",
      },
      luotCham,
      traoThau,
    };

    await mkdir(ra, { recursive: true });
    // `Buffer.from(…, "utf8")` chứ không đưa chuỗi thẳng cho `writeFile`: `dacTaSha256` là băm của
    // BYTE, và kho chạy `core.autocrlf=true` — một lần dịch xuống dòng là một lần băm lệch mà
    // không ai đổi một chữ nào. Cùng bài học với `trich`.
    await writeFile(join(ra, TEP_DU_LIEU), Buffer.from(`${JSON.stringify(bo, null, 2)}\n`, "utf8"));
    await writeFile(join(ra, TEP_DAC_TA), Buffer.from(DAC_TA, "utf8"));

    const soHang = luotCham.reduce((t, l) => t + l.hang.length, 0);
    stdout.write(
      `da xuat\t${ra}\tluot-cham=${String(luotCham.length)}\thang=${String(soHang)}\ttrao-thau=${String(traoThau.length)}\n`,
    );
    return 0;
  } finally {
    await pool.end();
  }
}

async function kiem(thamSo: readonly string[]): Promise<number> {
  const co = docCo(thamSo, ["bo"]);
  const thuMuc = co.get("bo") ?? "";
  const raw: unknown = JSON.parse(await readFile(join(thuMuc, TEP_DU_LIEU), "utf8"));
  const bo = docBo(raw);
  const dacTa = await readFile(join(thuMuc, TEP_DAC_TA), "utf8");

  const bamDiKem = bam(dacTa);
  if (bamDiKem !== bo.dacTaSha256) {
    stderr.write(
      `${TEP_DAC_TA} bam ra ${bamDiKem}, bundle khai ${bo.dacTaSha256} — dac ta di kem da bi doi.\n`,
    );
    return 1;
  }

  const kq = kiemBo(bo, dacTa);
  for (const d of kq.loiBo) stdout.write(`LOI\t${d}\n`);
  for (const h of kq.hang) {
    if (h.ketLuan === "DAT") continue;
    for (const d of h.noi) stdout.write(`${h.ketLuan}\t${h.bidVersionId}\t${d}\n`);
  }
  for (const t of kq.hangTraoThau) {
    stdout.write(`trao-thau\t${t.awardId}\thang=${t.rank === null ? "khong-co" : String(t.rank)}\n`);
  }
  stdout.write(
    `${kq.dat ? "ok=true" : "ok=false"}` +
      `\thang=${String(kq.soHang)}\tdat=${String(kq.soDat)}\tlech=${String(kq.soLech)}` +
      `\tkhong-tai-lap-duoc=${String(kq.soKhongTaiLapDuoc)}\n`,
  );
  return kq.dat ? 0 : 1;
}

function laLenh(gt: string | undefined): gt is Lenh {
  return gt === "xuat" || gt === "kiem";
}

async function main(): Promise<number> {
  const [lenh, ...thamSo] = argv.slice(2);
  if (!laLenh(lenh)) {
    stderr.write(CACH_DUNG);
    return 2;
  }
  return lenh === "xuat" ? xuat(thamSo) : kiem(thamSo);
}

main().then(
  (ma) => exit(ma),
  (loi: unknown) => {
    stderr.write(`${loi instanceof Error ? loi.message : String(loi)}\n`);
    // Mã 1, không phải 0: một lượt xuất hay kiểm KHÔNG chạy được không được đọc thành "bộ bằng
    // chứng lành lặn". Cùng luật với `pnpm neo`.
    exit(1);
  },
);

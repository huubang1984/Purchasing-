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
import { TenantError, ngheLoiKetNoiToiMuon, withTenant } from "@trustprocure/tenancy";
// [mảnh 1] Nửa XUẤT nay ở gói, để CLI và route `GET /rfqs/:rfqId/evidence-bundle` ghi ra CÙNG byte.
// Nửa KIỂM (`docBo`, `kiemBo`) ở lại đây — người kiểm không mượn định nghĩa của người bị kiểm.
import { dungBoBangChung } from "@trustprocure/danh-gia";
import { TEP_DAC_TA, TEP_DU_LIEU, docBo } from "./bo.js";
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

/**
 * [S1.227 / khoản 180] Hai tín hiệu mất-không-ai-biết của pool đi qua `withTenant` — ⑴ `release` mang `TenantError`
 * SESSION_STATE_LEFT (kết nối bị huỷ vì trạng thái phiên còn sót, không ném cho ai), ⑵ lỗi tới muộn sau trần
 * `maxConnectWaitMs` (ở đây không đặt trần; gắn để cổng `pool-nghe-du-tin-hieu`, nay quét cả `tools/`, đòi đủ hai). Cùng khuôn
 * `pnpm neo`. Chỉ TÊN lỗi và MÃ hằng, không `message` (A2); tool không import được `apps/api/src/mo-ta-loi.ts`.
 */
function moTaLoiKhongGiaTri(loi: unknown): string {
  if (!(loi instanceof Error)) return "loi la";
  const ma = (loi as { code?: unknown }).code;
  return typeof ma === "string" && /^[0-9A-Z_]{2,64}$/u.test(ma) ? `${loi.name} ${ma}` : loi.name;
}

async function xuat(thamSo: readonly string[]): Promise<number> {
  const co = docCo(thamSo, ["org", "rfq", "ra"]);
  const orgId = co.get("org") ?? "";
  const rfqId = co.get("rfq") ?? "";
  const ra = co.get("ra") ?? "";

  const pool = createPool(batBuoc("DATABASE_URL"), 2, {
    role: "app_api",
    // ~~Công cụ này đứng NGOÀI tầm cổng `pool-nghe-du-tin-hieu` (`TEP_APP` chỉ đọc `apps/`)~~ [S1.227 / khoản 180] cổng
    // ấy nay quét cả `tools/`; lớp `'error'` vẫn nằm trong `createPool` (hợp đồng của `pg`), dòng dưới chỉ thêm phần chẩn
    // đoán, hai tín hiệu riêng của kho gắn ngay dưới. Cùng khuôn `pnpm neo`.
    onPoolError: (e) => console.error(`[bang-chung] pool loi ${e instanceof Error ? e.name : "loi la"}`),
  });
  pool.on("release", (loi: unknown) => {
    if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") {
      console.error(`[bang-chung] ket noi huy pool ${moTaLoiKhongGiaTri(loi)}`);
    }
  });
  ngheLoiKetNoiToiMuon(pool, (loi: unknown) => {
    console.error(`[bang-chung] loi ket noi toi muon pool ${moTaLoiKhongGiaTri(loi)}`);
  });
  try {
    const daXuat = await withTenant(pool, orgId, (client) => dungBoBangChung(client, orgId, rfqId, new Date()));

    if (daXuat === null) {
      // KHÔNG ghi một bundle rỗng. Một thư mục trông như một bộ bằng chứng mà không mang phép đo
      // nào là thứ tệ hơn không có thư mục nào — cùng luật với `kiemBo` từ chối một lượt kiểm
      // không đo được gì.
      stderr.write(`Gói thầu ${rfqId} chưa được chấm lần nào — không có gì để xuất.\n`);
      return 1;
    }

    await mkdir(ra, { recursive: true });
    // `Buffer.from(…, "utf8")` chứ không đưa chuỗi thẳng cho `writeFile`: `dacTaSha256` là băm của
    // BYTE, và kho chạy `core.autocrlf=true` — một lần dịch xuống dòng là một lần băm lệch mà
    // không ai đổi một chữ nào. Cùng bài học với `trich`.
    await writeFile(join(ra, TEP_DU_LIEU), Buffer.from(daXuat.tep[TEP_DU_LIEU], "utf8"));
    await writeFile(join(ra, TEP_DAC_TA), Buffer.from(daXuat.tep[TEP_DAC_TA], "utf8"));

    stdout.write(
      `da xuat\t${ra}\tluot-cham=${String(daXuat.soLuotCham)}\thang=${String(daXuat.soHang)}\ttrao-thau=${String(daXuat.soTraoThau)}` +
        `\tdong-benchmark=${String(daXuat.soDongBenchmark)}\tquan-sat=${String(daXuat.soQuanSat)}\n`,
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
  // [S1.262 / S4.5c2] Lớp dữ liệu nền: mọi lời lệch, rồi một dòng tổng.
  if (kq.duLieuNen !== null) {
    for (const d of kq.duLieuNen.loi) stdout.write(`LOI-BENCHMARK\t${d}\n`);
    for (const d of kq.duLieuNen.dong) for (const n of d.noi) stdout.write(`LECH-BENCHMARK\t${d.bidVersionId}\t${n}\n`);
    stdout.write(
      `benchmark\tdong=${String(kq.duLieuNen.soDong)}\tdat=${String(kq.duLieuNen.soDat)}\tlech=${String(kq.duLieuNen.soLech)}\n`,
    );
  }
  // [S1.9101 / S4.7c2] Cam kết: mọi lời lệch, rồi một dòng tổng — kể cả số đề xuất không mang cam kết (BÁO, không đỏ).
  for (const d of kq.camKet.loi) stdout.write(`LECH-CAM-KET\t${d}\n`);
  stdout.write(
    `cam-ket\tso=${String(kq.camKet.soCamKet)}\tdat=${String(kq.camKet.soDat)}` +
      `\tde-xuat-khong-cam-ket=${String(kq.camKet.soDeXuatKhongCamKet)}\tquy-doi=${String(kq.soQuyDoi)}\n`,
  );
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

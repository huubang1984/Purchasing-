// ==============================================================================================
// tools/khoi-tao-to-chuc — ENTRY POINT CỦA TASK ECS `tp-khoi-tao` (ADR-111)
//
//   pnpm khoi-tao tao        --ban-khai-tep <đường dẫn>      (cục bộ: test, dev)
//   pnpm khoi-tao tao        --ban-khai-secret <tên bí mật>  (prod: Secrets Manager, tên dưới tp/khoi-tao/ban-khai/)
//   pnpm khoi-tao them-nguoi --ban-khai-tep … | --ban-khai-secret …
//   **[S1.183]** với `--ban-khai-secret` thì BẮT BUỘC thêm `--phien-ban <VersionId>` và ba KỲ VỌNG `--to-chuc <slug khi tao |
//   mã tổ chức khi them-nguoi> --so-nguoi <n> --so-vai <tổng cặp người–vai>`; với `--ban-khai-tep`, kỳ vọng tuỳ chọn (có thì
//   vẫn kiểm), `--phien-ban` bị từ chối.
//
// [S1.183] VÌ SAO LỆNH MANG PHIÊN BẢN VÀ KỲ VỌNG (khoản 251): người duyệt của environment `prod-khoi-tao` không đọc được bản
// khai — nó mang dữ liệu cá nhân — nên họ duyệt điều job `build` của workflow in ra: tên, `VersionId`, tổ chức, số người, số
// vai. Công cụ đọc ĐÚNG phiên bản ấy (một phiên bản của Secrets Manager không đổi nội dung được) và dừng TRƯỚC khi mở CSDL nếu
// bản khai ở phiên bản ấy không khớp ba kỳ vọng. Thêm người hay đổi tổ chức sau lúc duyệt thì phải tạo phiên bản mới — tức
// một lần chạy mới, một lần duyệt mới.
//
// Biến môi trường:
//   DATABASE_URL                    bắt buộc — đăng nhập bằng `app_khoi_tao_login`; công cụ `SET ROLE app_khoi_tao`
//   TRUSTPROCURE_KHOI_TAO_REGION    bắt buộc khi đọc bản khai từ Secrets Manager
//
// VÌ SAO BẢN KHAI ĐI QUA SECRETS MANAGER (chủ dự án chọn, ADR-111 mục 5): nó mang email và họ tên của nhân viên khách. Truyền
// nó trong `containerOverrides` là để nó nằm lại trong CloudTrail của tài khoản prod; ở đây lệnh chỉ mang TÊN bí mật, task
// role đọc giá trị, và bí mật bị xoá sau lần chạy. Tên phải nằm dưới `tp/khoi-tao/ban-khai/` — task role đọc được cả nhánh
// `tp/khoi-tao/*`, kể cả URL CSDL của chính nó, và công cụ không đọc bí mật nào ngoài bản khai.
//
// ĐẦU RA: một dòng — chế độ, mã tổ chức, số người, số vai (**[lượt soi]** của tiến trình `node` mà task chạy; `pnpm khoi-tao`
// in thêm hai dòng tiêu đề của pnpm — lặp lại dòng lệnh, tức đường dẫn hay TÊN bí mật — trừ khi gọi `pnpm --silent`, và
// không `--disable-warning` thì stderr có một ExperimentalWarning). Mã tổ chức không bí mật (ADR-107): người vận hành gửi
// `/login#<mã tổ chức>` cho từng người, và mỗi người tự xin link đăng nhập ở ô của trang `/login`. Email và họ tên KHÔNG đi ra
// stdout, stderr hay thông điệp lỗi nào. Thoát 0 khi giao dịch commit; 1 khi bất cứ điều gì hỏng (giao dịch đã rollback).
// ==============================================================================================

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, env, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createPool } from "@trustprocure/db";
import { TenantError, ngheLoiKetNoiToiMuon } from "@trustprocure/tenancy";
import { BanKhaiError, MA_VAI, SLUG, TRAN_SO_NGUOI, UUID_V4, docBanKhai, kiemKhop, type CheDo, type KyVong } from "./ban-khai.js";
import { KhoiTaoError, khoiTao } from "./khoi-tao.js";

export const TIEN_TO_BI_MAT = "tp/khoi-tao/ban-khai/";

export const CACH_DUNG = `Cách dùng:
  pnpm khoi-tao tao        --ban-khai-secret <${TIEN_TO_BI_MAT}slug> --phien-ban <VersionId> --bam <sha256> --ma-to-chuc <uuid> KỲ_VỌNG
  pnpm khoi-tao them-nguoi --ban-khai-secret <${TIEN_TO_BI_MAT}slug> --phien-ban <VersionId> --bam <sha256> KỲ_VỌNG
  pnpm khoi-tao tao|them-nguoi --ban-khai-tep <đường dẫn> [--bam <sha256>] [--ma-to-chuc <uuid>] [KỲ_VỌNG]   (cục bộ)

  KỲ_VỌNG = --to-chuc <slug khi tao | mã tổ chức khi them-nguoi> --so-nguoi <n> --vai <MA=n,MA=n…>
            (số người mang từng mã vai, theo thứ tự ${MA_VAI.join(", ")}; chỉ mã có người)

Biến môi trường:
  DATABASE_URL                    bắt buộc — đăng nhập bằng app_khoi_tao_login
  TRUSTPROCURE_KHOI_TAO_REGION    bắt buộc với --ban-khai-secret
`;

export class ThamSoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThamSoError";
  }
}

export type NguonBanKhai =
  | { readonly loai: "tep"; readonly duong: string }
  // [S1.183] Phiên bản đi cùng tên: công cụ đọc ĐÚNG phiên bản người duyệt đã duyệt, không đọc nhãn AWSCURRENT.
  | { readonly loai: "secret"; readonly ten: string; readonly phienBan: string };

export interface ThamSo {
  readonly lenh: CheDo;
  readonly nguon: NguonBanKhai;
  /** [S1.183] Điều người duyệt đã thấy — bắt buộc khi đọc từ Secrets Manager, tuỳ chọn với tệp; `null` = không kiểm. */
  readonly kyVong: KyVong | null;
  /**
   * [S1.183 / lượt soi] SHA-256 (hex chữ thường) của ĐÚNG byte bản khai — bắt buộc với bí mật. Cặp (tên, VersionId) không đủ:
   * xoá hẳn một bí mật rồi tạo lại cùng tên với `--client-request-token` bằng VersionId cũ thì ra cùng cặp, nội dung khác.
   */
  readonly bam: string | null;
  /** [S1.183] Mã tổ chức workflow chọn trước lúc duyệt — chỉ chế độ `tao`; bắt buộc khi `tao` đọc từ bí mật. */
  readonly maToChuc: string | null;
}

const CO = ["--ban-khai-tep", "--ban-khai-secret", "--phien-ban", "--bam", "--ma-to-chuc", "--to-chuc", "--so-nguoi", "--vai"] as const;
type Co = (typeof CO)[number];
const laCo = (x: string | undefined): x is Co => (CO as readonly (string | undefined)[]).includes(x);
// VersionId của Secrets Manager: UUID do SM sinh, hoặc `ClientRequestToken` 32–64 ký tự do người tạo phiên bản đặt. Ký tự
// đầu là chữ hay số: một giá trị mở đầu bằng `--` là CỜ với `docThamSo`, và `kiem_dau_vao` của script phải nói cùng một lời.
const PHIEN_BAN = /^[A-Za-z0-9][A-Za-z0-9-]{31,63}$/u;
const BAM = /^[0-9a-f]{64}$/u;
const SO = /^[1-9][0-9]{0,2}$/u;

/**
 * `--vai` ở dạng chuẩn: mã của `MA_VAI`, thứ tự TĂNG theo `MA_VAI`, mỗi mã một lần, số từ 1 tới số người, tổng ít nhất bằng
 * số người (ai cũng có ít nhất một vai). Trả thông điệp lỗi, hay `null` khi hợp lệ.
 */
function loiVai(vai: string, soNguoi: number): string | null {
  const phan = vai.split(",");
  let truoc = -1;
  let tong = 0;
  for (const p of phan) {
    const m = /^([A-Z_]+)=([1-9][0-9]{0,2})$/u.exec(p);
    const vi = m === null ? -1 : (MA_VAI as readonly string[]).indexOf(m[1] ?? "");
    if (m === null || vi === -1) return `--vai: "${p}" không phải MA=n với MA trong ${MA_VAI.join(", ")}`;
    if (vi <= truoc) return `--vai: mã phải theo thứ tự ${MA_VAI.join(", ")}, mỗi mã một lần`;
    const n = Number(m[2]);
    if (n > soNguoi) return "--vai: số người của một mã vai không vượt --so-nguoi";
    truoc = vi;
    tong += n;
  }
  return tong < soNguoi ? "--vai: tổng phải ít nhất bằng --so-nguoi — ai cũng có ít nhất một vai" : null;
}

/**
 * Đọc dòng lệnh — hàm thuần. Đúng MỘT nguồn bản khai; tên bí mật phải nằm dưới `TIEN_TO_BI_MAT`, mỗi cờ tối đa một lần.
 * **[S1.183]** Bí mật đi kèm `--phien-ban`, `--bam`, đủ ba kỳ vọng, và — chế độ `tao` — `--ma-to-chuc`; `deploy/trien-khai.sh`
 * (`kiem_dau_vao`) kiểm cùng các luật ấy trước lúc duyệt — `tests/deploy/khoi-tao-sh.test.ts` so hai phía.
 */
export function docThamSo(ds: readonly string[]): ThamSo {
  const [lenh, ...con] = ds;
  if (lenh !== "tao" && lenh !== "them-nguoi") throw new ThamSoError(`lệnh phải là "tao" hoặc "them-nguoi"\n\n${CACH_DUNG}`);
  const gt = new Map<Co, string>();
  for (let i = 0; i < con.length; i += 2) {
    const co = con[i];
    const v = con[i + 1];
    if (!laCo(co)) throw new ThamSoError(`tham số lạ "${String(co)}"\n\n${CACH_DUNG}`);
    if (v === undefined || v === "" || v.startsWith("--")) throw new ThamSoError(`${co} cần một giá trị`);
    if (gt.has(co)) throw new ThamSoError(`${co} khai hai lần`);
    gt.set(co, v);
  }
  const tep = gt.get("--ban-khai-tep");
  const ten = gt.get("--ban-khai-secret");
  if (tep !== undefined && ten !== undefined) throw new ThamSoError("chỉ nhận MỘT nguồn bản khai (--ban-khai-tep HOẶC --ban-khai-secret)");

  const toChuc = gt.get("--to-chuc");
  const soNguoi = gt.get("--so-nguoi");
  const vai = gt.get("--vai");
  let kyVong: KyVong | null = null;
  if (toChuc !== undefined || soNguoi !== undefined || vai !== undefined) {
    if (toChuc === undefined || soNguoi === undefined || vai === undefined) {
      throw new ThamSoError("kỳ vọng đi đủ ba: --to-chuc, --so-nguoi, --vai");
    }
    if (lenh === "tao" && !SLUG.test(toChuc)) {
      throw new ThamSoError("--to-chuc của lệnh tao là slug của tổ chức mới (a-z, 0-9, gạch nối ở giữa; 3–63 ký tự)");
    }
    if (lenh === "them-nguoi" && !UUID_V4.test(toChuc)) {
      throw new ThamSoError("--to-chuc của lệnh them-nguoi là mã của tổ chức đã có (UUIDv4 chữ thường)");
    }
    const n = SO.test(soNguoi) ? Number(soNguoi) : 0;
    if (n < 1 || n > TRAN_SO_NGUOI) throw new ThamSoError(`--so-nguoi phải là số nguyên từ 1 tới ${String(TRAN_SO_NGUOI)}`);
    const loi = loiVai(vai, n);
    if (loi !== null) throw new ThamSoError(loi);
    kyVong = { toChuc, soNguoi: n, vai };
  }

  const bam = gt.get("--bam") ?? null;
  if (bam !== null && !BAM.test(bam)) throw new ThamSoError("--bam phải là SHA-256 của bản khai: 64 ký tự hex chữ thường");
  const maToChuc = gt.get("--ma-to-chuc") ?? null;
  if (maToChuc !== null && lenh !== "tao") throw new ThamSoError("--ma-to-chuc chỉ đi với lệnh tao — thêm người thì mã ở --to-chuc");
  if (maToChuc !== null && !UUID_V4.test(maToChuc)) throw new ThamSoError("--ma-to-chuc phải là UUIDv4 chữ thường");

  const phienBan = gt.get("--phien-ban");
  if (ten !== undefined) {
    // [S1.183 / lượt soi] Tên dạng slug dưới tiền tố: tên bí mật đi vào CloudTrail và vào run CÔNG KHAI của workflow — một tên
    // mang `@` hay `.` (một email) là dữ liệu cá nhân lộ ra ngoài.
    if (!ten.startsWith(TIEN_TO_BI_MAT) || !SLUG.test(ten.slice(TIEN_TO_BI_MAT.length))) {
      throw new ThamSoError(`--ban-khai-secret phải là "${TIEN_TO_BI_MAT}<slug>" (a-z, 0-9, gạch nối ở giữa; 3–63 ký tự)`);
    }
    if (phienBan === undefined) throw new ThamSoError("--ban-khai-secret cần --phien-ban <VersionId> — phiên bản người duyệt đã duyệt");
    if (!PHIEN_BAN.test(phienBan)) {
      throw new ThamSoError("--phien-ban phải là một VersionId của Secrets Manager (32–64 ký tự: chữ, số, gạch nối; mở đầu bằng chữ hay số)");
    }
    if (bam === null) throw new ThamSoError("--ban-khai-secret cần --bam <sha256> — băm của bản khai người duyệt đã duyệt");
    if (kyVong === null) {
      throw new ThamSoError("--ban-khai-secret cần ba kỳ vọng --to-chuc, --so-nguoi, --vai — điều người duyệt đã thấy");
    }
    if (lenh === "tao" && maToChuc === null) throw new ThamSoError("tao với --ban-khai-secret cần --ma-to-chuc <uuid> — mã workflow đã chọn");
    return { lenh, nguon: { loai: "secret", ten, phienBan }, kyVong, bam, maToChuc };
  }
  if (tep === undefined) throw new ThamSoError(`thiếu nguồn bản khai\n\n${CACH_DUNG}`);
  if (phienBan !== undefined) throw new ThamSoError("--phien-ban chỉ đi với --ban-khai-secret");
  return { lenh, nguon: { loai: "tep", duong: tep }, kyVong, bam, maToChuc };
}

function batBuoc(ten: string): string {
  const gt = env[ten]?.trim();
  if (gt === undefined || gt === "") throw new ThamSoError(`thiếu biến môi trường ${ten}`);
  return gt;
}

/**
 * Nội dung bản khai, `VersionId` của đúng phiên bản đã đọc (khi đọc từ Secrets Manager, không bí mật), và SHA-256 của ĐÚNG byte
 * đã đọc — tệp: byte trên đĩa; bí mật: byte UTF-8 của SecretString.
 */
async function docNguon(nguon: NguonBanKhai): Promise<{ readonly noiDung: string; readonly phienBan: string | null; readonly bam: string }> {
  if (nguon.loai === "tep") {
    let byte: Buffer;
    try {
      byte = await readFile(nguon.duong);
    } catch {
      throw new ThamSoError("không đọc được tệp bản khai");
    }
    return { noiDung: byte.toString("utf8"), phienBan: null, bam: createHash("sha256").update(byte).digest("hex") };
  }
  const client = new SecretsManagerClient({ region: batBuoc("TRUSTPROCURE_KHOI_TAO_REGION") });
  try {
    // [S1.183] Hỏi ĐÚNG phiên bản đã duyệt. ~~một phiên bản đã có của Secrets Manager không đổi nội dung được~~ **[lượt soi]**
    // Trong MỘT bí mật thì đúng; xoá hẳn rồi tạo lại cùng tên thì một VersionId cũ mang được nội dung mới — nên còn so băm.
    const kq = await client.send(new GetSecretValueCommand({ SecretId: nguon.ten, VersionId: nguon.phienBan }));
    if (typeof kq.SecretString !== "string") throw new ThamSoError("bí mật bản khai không có SecretString");
    if (kq.VersionId !== nguon.phienBan) throw new ThamSoError("Secrets Manager trả một phiên bản khác phiên bản đã duyệt");
    const bam = createHash("sha256").update(Buffer.from(kq.SecretString, "utf8")).digest("hex");
    return { noiDung: kq.SecretString, phienBan: nguon.phienBan, bam };
  } catch (loi) {
    if (loi instanceof ThamSoError) throw loi;
    // Tên lỗi của SDK (ResourceNotFoundException, AccessDeniedException…) đủ để chẩn đoán; thông điệp có thể mang ARN.
    throw new ThamSoError(`không đọc được bí mật bản khai (${loi instanceof Error ? loi.name : "lỗi lạ"})`);
  } finally {
    client.destroy();
  }
}

/**
 * Phần `" (ma X)"` của dòng lỗi lạ — hay chuỗi rỗng. [lượt soi] SQLSTATE không mang dữ liệu — in kèm tên, để một lỗi lạ của pg
 * vẫn chẩn đoán được. **[S1.183]** Cả mã lỗi hệ thống của Node (`ECONNREFUSED`, `ENOTFOUND`, `SELF_SIGNED_CERT_IN_CHAIN`,
 * `ERR_TLS_CERT_ALTNAME_INVALID`…): đo image với bó CA sai, dòng lỗi chỉ còn "HONG: Error" — mà lần chạy đầu trên RDS hỏng thì
 * nhiều khả năng hỏng đúng ở mạng hay TLS. Mã là HẰNG SỐ viết hoa, không mang dữ liệu; mẫu không nhận chữ thường, khoảng
 * trắng, dấu chấm hay dấu hai chấm — một `code` mang đường dẫn hay giá trị thì không in.
 */
export function maLoi(loi: unknown): string {
  if (typeof loi !== "object" || loi === null || !("code" in loi) || typeof loi.code !== "string") return "";
  return /^[0-9A-Z][0-9A-Z_]{1,63}$/u.test(loi.code) ? ` (ma ${loi.code})` : "";
}

export async function chay(ds: readonly string[]): Promise<string> {
  const ts = docThamSo(ds);
  const url = batBuoc("DATABASE_URL");
  const nguon = await docNguon(ts.nguon);
  // [S1.183] Trước khi mở CSDL: đúng byte đã duyệt (băm), rồi bản khai khớp điều người duyệt thấy (kỳ vọng).
  if (ts.bam !== null && nguon.bam !== ts.bam) throw new BanKhaiError("bản khai không khớp băm SHA-256 đã duyệt");
  const bk = docBanKhai(nguon.noiDung, ts.lenh);
  if (ts.kyVong !== null) kiemKhop(bk, ts.kyVong);
  const pool = createPool(url, 1, {
    role: "app_khoi_tao",
    onPoolError: (e) => {
      stderr.write(`[khoi-tao] pool loi ${e instanceof Error ? e.name : "loi la"}\n`);
    },
  });
  // [S1.9171 / khoản 180] Pool đi qua `withTenant` ở `khoi-tao.ts` (`khoiTao`), nên hai tín hiệu mất-không-ai-biết của nó
  // gắn Ở ĐÂY — chỗ dựng pool, đúng ranh giới "cùng một tệp" của cổng `pool-nghe-du-tin-hieu` (nay quét cả `tools/`):
  // ⑴ `release` mang `TenantError` SESSION_STATE_LEFT — `withTenant` huỷ kết nối vì trạng thái phiên còn sót sau giao
  // dịch, không ném cho ai; ⑵ lỗi tới muộn sau trần `maxConnectWaitMs` (`khoiTao` không đặt trần; gắn để không phải nhớ).
  // Chỉ TÊN và MÃ lỗi (`maLoi`), không `message` — cùng luật với dòng HONG ở dưới.
  pool.on("release", (loi: unknown) => {
    if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") {
      stderr.write(`[khoi-tao] ket noi huy pool ${loi.name}${maLoi(loi)}\n`);
    }
  });
  ngheLoiKetNoiToiMuon(pool, (loi: unknown) => {
    stderr.write(`[khoi-tao] loi ket noi toi muon pool ${loi instanceof Error ? `${loi.name}${maLoi(loi)}` : "loi la"}\n`);
  });
  try {
    const kq = await khoiTao(pool, bk, ts.maToChuc === null ? {} : { maToChuc: ts.maToChuc });
    // [lượt soi] Phiên bản bí mật đã đọc đi vào dòng kết quả: ~~người duyệt duyệt một TÊN bí mật, còn nội dung của tên ấy đổi
    // được tới lúc chạy — dòng này cho đối chiếu SAU. Ghim phiên bản TRƯỚC (lệnh mang `VersionId` đã duyệt) là việc của vòng
    // hạ tầng (khoản 251).~~ **[S1.183]** lệnh nay mang `VersionId` và băm đã duyệt, công cụ đọc đúng phiên bản ấy và so băm
    // (`docNguon`, `chay`); dòng này ở lại trong log `/tp/khoi-tao` để đối chiếu với lần duyệt.
    return `[khoi-tao] ${kq.cheDo}: to chuc ${kq.orgId}, ${String(kq.soNguoi)} nguoi, ${String(kq.soVai)} vai` +
      (nguon.phienBan === null ? "" : `, ban khai phien ban ${nguon.phienBan}`);
  } finally {
    await pool.end();
  }
}

// Chỉ chạy khi là điểm vào — test nạp tệp này để đo `docThamSo` mà không mở CSDL nào.
if (argv[1] !== undefined && fileURLToPath(import.meta.url) === argv[1]) {
  try {
    stdout.write(`${await chay(argv.slice(2))}\n`);
  } catch (loi) {
    // Ba lớp lỗi CÓ TÊN mang thông điệp đã được viết để in ra (vị trí và mã, không giá trị); mọi lỗi khác chỉ in TÊN — thông
    // điệp gốc của Postgres có thể trích dòng dữ liệu vi phạm, tức email của người trong bản khai.
    const coTen = loi instanceof ThamSoError || loi instanceof BanKhaiError || loi instanceof KhoiTaoError;
    stderr.write(`[khoi-tao] HONG: ${coTen ? loi.message : loi instanceof Error ? `${loi.name}${maLoi(loi)}` : "loi la"}\n`);
    exit(1);
  }
}

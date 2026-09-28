// ==============================================================================================
// tools/khoi-tao-to-chuc — ENTRY POINT CỦA TASK ECS `tp-khoi-tao` (ADR-111)
//
//   pnpm khoi-tao tao        --ban-khai-tep <đường dẫn>      (cục bộ: test, dev)
//   pnpm khoi-tao tao        --ban-khai-secret <tên bí mật>  (prod: Secrets Manager, tên dưới tp/khoi-tao/ban-khai/)
//   pnpm khoi-tao them-nguoi --ban-khai-tep … | --ban-khai-secret …
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

import { readFile } from "node:fs/promises";
import { argv, env, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createPool } from "@trustprocure/db";
import { BanKhaiError, docBanKhai, type CheDo } from "./ban-khai.js";
import { KhoiTaoError, khoiTao } from "./khoi-tao.js";

export const TIEN_TO_BI_MAT = "tp/khoi-tao/ban-khai/";

export const CACH_DUNG = `Cách dùng:
  pnpm khoi-tao tao        --ban-khai-tep <đường dẫn> | --ban-khai-secret <${TIEN_TO_BI_MAT}…>
  pnpm khoi-tao them-nguoi --ban-khai-tep <đường dẫn> | --ban-khai-secret <${TIEN_TO_BI_MAT}…>

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

export type NguonBanKhai = { readonly loai: "tep"; readonly duong: string } | { readonly loai: "secret"; readonly ten: string };

export interface ThamSo {
  readonly lenh: CheDo;
  readonly nguon: NguonBanKhai;
}

/** Đọc dòng lệnh — hàm thuần. Đúng MỘT nguồn bản khai; tên bí mật phải nằm dưới `TIEN_TO_BI_MAT`. */
export function docThamSo(ds: readonly string[]): ThamSo {
  const [lenh, ...con] = ds;
  if (lenh !== "tao" && lenh !== "them-nguoi") throw new ThamSoError(`lệnh phải là "tao" hoặc "them-nguoi"\n\n${CACH_DUNG}`);
  let nguon: NguonBanKhai | undefined;
  for (let i = 0; i < con.length; i += 1) {
    const co = con[i];
    const gt = con[i + 1];
    if (co !== "--ban-khai-tep" && co !== "--ban-khai-secret") throw new ThamSoError(`tham số lạ "${String(co)}"\n\n${CACH_DUNG}`);
    if (gt === undefined || gt === "" || gt.startsWith("--")) throw new ThamSoError(`${co} cần một giá trị`);
    if (nguon !== undefined) throw new ThamSoError("chỉ nhận MỘT nguồn bản khai (--ban-khai-tep HOẶC --ban-khai-secret)");
    if (co === "--ban-khai-secret") {
      if (!gt.startsWith(TIEN_TO_BI_MAT) || gt.length === TIEN_TO_BI_MAT.length || !/^[A-Za-z0-9/_+=.@-]+$/u.test(gt)) {
        throw new ThamSoError(`--ban-khai-secret phải là một tên bí mật dưới "${TIEN_TO_BI_MAT}"`);
      }
      nguon = { loai: "secret", ten: gt };
    } else {
      nguon = { loai: "tep", duong: gt };
    }
    i += 1;
  }
  if (nguon === undefined) throw new ThamSoError(`thiếu nguồn bản khai\n\n${CACH_DUNG}`);
  return { lenh, nguon };
}

function batBuoc(ten: string): string {
  const gt = env[ten]?.trim();
  if (gt === undefined || gt === "") throw new ThamSoError(`thiếu biến môi trường ${ten}`);
  return gt;
}

/** Nội dung bản khai, và — khi đọc từ Secrets Manager — `VersionId` của đúng phiên bản đã đọc (không bí mật). */
async function docNguon(nguon: NguonBanKhai): Promise<{ readonly noiDung: string; readonly phienBan: string | null }> {
  if (nguon.loai === "tep") {
    try {
      return { noiDung: await readFile(nguon.duong, "utf8"), phienBan: null };
    } catch {
      throw new ThamSoError("không đọc được tệp bản khai");
    }
  }
  const client = new SecretsManagerClient({ region: batBuoc("TRUSTPROCURE_KHOI_TAO_REGION") });
  try {
    const kq = await client.send(new GetSecretValueCommand({ SecretId: nguon.ten }));
    if (typeof kq.SecretString !== "string") throw new ThamSoError("bí mật bản khai không có SecretString");
    return { noiDung: kq.SecretString, phienBan: typeof kq.VersionId === "string" ? kq.VersionId : null };
  } catch (loi) {
    if (loi instanceof ThamSoError) throw loi;
    // Tên lỗi của SDK (ResourceNotFoundException, AccessDeniedException…) đủ để chẩn đoán; thông điệp có thể mang ARN.
    throw new ThamSoError(`không đọc được bí mật bản khai (${loi instanceof Error ? loi.name : "lỗi lạ"})`);
  } finally {
    client.destroy();
  }
}

export async function chay(ds: readonly string[]): Promise<string> {
  const ts = docThamSo(ds);
  const url = batBuoc("DATABASE_URL");
  const nguon = await docNguon(ts.nguon);
  const bk = docBanKhai(nguon.noiDung, ts.lenh);
  const pool = createPool(url, 1, {
    role: "app_khoi_tao",
    onPoolError: (e) => {
      stderr.write(`[khoi-tao] pool loi ${e instanceof Error ? e.name : "loi la"}\n`);
    },
  });
  try {
    const kq = await khoiTao(pool, bk);
    // [lượt soi] Phiên bản bí mật đã đọc đi vào dòng kết quả: người duyệt duyệt một TÊN bí mật, còn nội dung của tên ấy đổi
    // được tới lúc chạy — dòng này cho đối chiếu SAU. Ghim phiên bản TRƯỚC (lệnh mang `VersionId` đã duyệt) là việc của vòng
    // hạ tầng (khoản 251).
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
    // [lượt soi] SQLSTATE không mang dữ liệu — in kèm tên, để một lỗi lạ của pg vẫn chẩn đoán được.
    const ma = typeof loi === "object" && loi !== null && "code" in loi && typeof loi.code === "string" && /^[0-9A-Z]{5}$/u.test(loi.code) ? ` (ma ${loi.code})` : "";
    stderr.write(`[khoi-tao] HONG: ${coTen ? loi.message : loi instanceof Error ? `${loi.name}${ma}` : "loi la"}\n`);
    exit(1);
  }
}

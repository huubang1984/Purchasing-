// ==============================================================================================
// tools/kiem-truoc-apply/src/nguon.ts — HAI NGUỒN: `terraform console` (biến) và AWS CLI (tài khoản prod, chỉ đọc)
//
// Vì sao đọc biến qua `terraform console` chứ không tự phân tích HCL: Terraform là bộ đọc DUY NHẤT mà plan sẽ dùng — nó
// áp mặc định, chạy validation của biến, và đọc đúng cú pháp HCL mà một bộ đọc tự viết sẽ lệch ở ca biên. Cái giá: thư
// mục stack phải đã `terraform init` (APPLY-LAN-DAU 6.2 đã làm) và profile của backend phải còn phiên.
// Vì sao AWS CLI chứ không SDK: người vận hành đã có CLI và profile SSO (APPLY-LAN-DAU 0.1); tool không thêm phụ thuộc.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { TEN_ANH, type BienStack90, type CongAws, type HangSo, type MoTaSecret, type TenAnh } from "./luat.js";

/** Biểu thức đưa vào `terraform console`: một chuỗi JSON gồm biến cần kiểm và hằng số của `module.chung`. */
export const BIEU_THUC_CONSOLE =
  "jsonencode({ bien = { ten_mien = var.ten_mien, anh = var.anh, so_ban_api = var.so_ban_api, so_ban_worker = var.so_ban_worker, " +
  "ses = var.ses, sms = var.sms, zalo = var.zalo, che_do_dns = var.che_do_dns, ses_endpoint_service = var.ses_endpoint_service }, " +
  "prod = module.chung.account.prod, region = module.chung.region })";

export class DocBienError extends Error {}

const laObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function chuoi(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== "string") throw new DocBienError(`${k} khong phai chuoi`);
  return v;
}

function so(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== "number") throw new DocBienError(`${k} khong phai so`);
  return v;
}

function doiTuong(o: Record<string, unknown>, k: string): Record<string, unknown> {
  const v = o[k];
  if (!laObj(v)) throw new DocBienError(`${k} khong phai doi tuong`);
  return v;
}

/**
 * Giải mã stdout của `terraform console`: một chuỗi HCL bọc JSON. Chuỗi HCL in ra với escape tương thích JSON cho mọi
 * giá trị ở đây (email, domain, URI) — trừ `${`/`%{`, mà console in thành `$${`/`%%{`; gặp chúng thì từ chối.
 */
export function giaiMaConsole(stdout: string): { bien: BienStack90; hang: HangSo } {
  const dong = stdout.trim();
  if (dong.includes("$${") || dong.includes("%%{")) throw new DocBienError("gia tri chua ${ hoac %{ - khong ho tro");
  let ngoai: unknown;
  let trong: unknown;
  try {
    ngoai = JSON.parse(dong);
    trong = typeof ngoai === "string" ? JSON.parse(ngoai) : undefined;
  } catch {
    throw new DocBienError("stdout cua terraform console khong phai chuoi JSON");
  }
  if (!laObj(trong)) throw new DocBienError("stdout cua terraform console khong phai chuoi JSON");

  const b = doiTuong(trong, "bien");
  const anhGoc = doiTuong(b, "anh");
  const anh = Object.fromEntries(TEN_ANH.map((t) => [t, chuoi(anhGoc, t)])) as Record<TenAnh, string>;
  const ses = doiTuong(b, "ses");
  const nhan = ses["nhan_canh_bao"];
  if (!Array.isArray(nhan) || !nhan.every((x) => typeof x === "string")) throw new DocBienError("ses.nhan_canh_bao khong phai danh sach chuoi");
  const smsGoc = b["sms"];
  const zaloGoc = b["zalo"];

  return {
    bien: {
      ten_mien: chuoi(b, "ten_mien"),
      anh,
      so_ban_api: so(b, "so_ban_api"),
      so_ban_worker: so(b, "so_ban_worker"),
      ses: { tu_api: chuoi(ses, "tu_api"), tu_canh_bao: chuoi(ses, "tu_canh_bao"), nhan_canh_bao: nhan, configuration_set: chuoi(ses, "configuration_set") },
      sms: laObj(smsGoc)
        ? { danh_tinh_gui: chuoi(smsGoc, "danh_tinh_gui"), configuration_set: typeof smsGoc["configuration_set"] === "string" ? smsGoc["configuration_set"] : null }
        : null,
      zalo: laObj(zaloGoc)
        ? {
            template_otp: chuoi(zaloGoc, "template_otp"),
            template_invitation: chuoi(zaloGoc, "template_invitation"),
            template_deadline: chuoi(zaloGoc, "template_deadline"),
          }
        : null,
      che_do_dns: chuoi(b, "che_do_dns"),
      ses_endpoint_service: chuoi(b, "ses_endpoint_service"),
    },
    hang: { prod: chuoi(trong, "prod"), region: chuoi(trong, "region") },
  };
}

/** Lỗi của một tiến trình con, kèm stderr đã cắt — không bao giờ kèm giá trị secret (tool không đọc giá trị nào). */
export class TienTrinhError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

function chay(lenh: string, thamSo: readonly string[], vao?: string): string {
  try {
    return execFileSync(lenh, thamSo, { encoding: "utf8", input: vao, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const stderr = laObj(e) && typeof e["stderr"] === "string" ? e["stderr"] : "";
    throw new TienTrinhError(`${lenh} ${thamSo.slice(0, 2).join(" ")} that bai`, stderr.trim().slice(0, 2000));
  }
}

export function docBienTerraform(terraform: string, thuMucStack: string, varFile: string): { bien: BienStack90; hang: HangSo } {
  return giaiMaConsole(chay(terraform, [`-chdir=${thuMucStack}`, "console", "-no-color", `-var-file=${varFile}`], `${BIEU_THUC_CONSOLE}\n`));
}

/** Tên lỗi AWS trong stderr của CLI: `An error occurred (ResourceNotFoundException) when calling …`. */
export function maLoiAws(stderr: string): string | null {
  return /An error occurred \(([A-Za-z]+)\)/u.exec(stderr)?.[1] ?? null;
}

/** `lenh`: chương trình và các tham số đứng trước lệnh con — mặc định `aws`; test đưa `[node, aws-gia.mjs]`. */
export function congAwsCli(profile: string, region: string, lenh: readonly [string, ...string[]] = ["aws"]): CongAws {
  const [chuongTrinh, ...truoc] = lenh;
  const goi = (thamSo: readonly string[]): Record<string, unknown> => {
    const stdout = chay(chuongTrinh, [...truoc, ...thamSo, "--profile", profile, "--region", region, "--output", "json"]);
    let ra: unknown;
    try {
      ra = JSON.parse(stdout);
    } catch {
      throw new TienTrinhError(`aws ${thamSo.slice(0, 2).join(" ")}: dau ra khong phai JSON`, "");
    }
    if (!laObj(ra)) throw new TienTrinhError(`aws ${thamSo.slice(0, 2).join(" ")}: dau ra khong phai doi tuong`, "");
    return ra;
  };
  /** Gọi; lỗi mang một trong `khongCo` ⇒ `null`, lỗi khác ⇒ ném. */
  const goiHoacKhong = (thamSo: readonly string[], khongCo: readonly string[]): Record<string, unknown> | null => {
    try {
      return goi(thamSo);
    } catch (e) {
      if (e instanceof TienTrinhError && khongCo.includes(maLoiAws(e.stderr) ?? "")) return null;
      throw e;
    }
  };

  return {
    taiKhoan: () => Promise.resolve(String(goi(["sts", "get-caller-identity"])["Account"])),
    moTaSecret: (ten) => {
      const ra = goiHoacKhong(["secretsmanager", "describe-secret", "--secret-id", ten], ["ResourceNotFoundException"]);
      if (ra === null) return Promise.resolve(null);
      const nhan = laObj(ra["VersionIdsToStages"]) ? Object.values(ra["VersionIdsToStages"]) : [];
      const mt: MoTaSecret = {
        coBanHienHanh: nhan.some((n) => Array.isArray(n) && n.includes("AWSCURRENT")),
        daXoa: ra["DeletedDate"] !== undefined,
      };
      return Promise.resolve(mt);
    },
    coImage: (kho, digest) =>
      Promise.resolve(
        goiHoacKhong(["ecr", "describe-images", "--repository-name", kho, "--image-ids", `imageDigest=${digest}`], [
          "ImageNotFoundException",
          "RepositoryNotFoundException",
        ]) !== null,
      ),
    danhTinhSes: (mien) => {
      const ra = goiHoacKhong(["sesv2", "get-email-identity", "--email-identity", mien], ["NotFoundException"]);
      return Promise.resolve(ra === null ? null : { daXacMinh: ra["VerifiedForSendingStatus"] === true });
    },
    sesDaRaSandbox: () => Promise.resolve(goi(["sesv2", "get-account"])["ProductionAccessEnabled"] === true),
  };
}

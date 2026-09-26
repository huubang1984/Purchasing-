// ==============================================================================================
// tools/kiem-truoc-apply/src/luat.ts — CÁC LUẬT KIỂM TRƯỚC `terraform plan/apply` CỦA STACK 90
//
// Hai lớp, cùng một bảng kết quả:
//   ① biến (offline): giá trị HIỆU LỰC của stack 90 — đọc qua `terraform console`, nên gồm cả mặc định — không còn giá
//      trị giữ chỗ của `docs/APPLY-LAN-DAU.md` (`<...>`, digest toàn số 0), image ghim đúng kho ECR của prod;
//   ② tài khoản prod (chỉ ĐỌC, qua `CongAws`): đúng tài khoản, secret tồn tại VÀ có phiên bản hiện hành (không đọc giá
//      trị), image có trong ECR, domain gửi thư đã xác minh ở SES.
// Mức: DO chặn (thoát 1); VANG là trạng thái hợp lệ của MỘT bước dựng cụ thể (api 0 task, DNS ALERT) — in ra để người
// vận hành xác nhận đó là bước họ đang ở, không chặn.
// Chữ in ra không dấu: PowerShell cũ với code page OEM làm vỡ tiếng Việt có dấu.
// ==============================================================================================

export type MucDo = "DO" | "VANG" | "XANH";

export interface KetQua {
  readonly muc: MucDo;
  readonly ma: string;
  readonly noiDung: string;
}

export const TEN_ANH = ["api", "worker", "migrate", "web", "public_keys", "neo"] as const;
export type TenAnh = (typeof TEN_ANH)[number];

/** Khoá của `var.anh` ⇒ kho ECR (`aws_ecr_repository.tp` của stack 90). `hinh-dang-kiem-truoc-apply.test.ts` so hai phía. */
export const KHO_ECR: Readonly<Record<TenAnh, string>> = {
  api: "tp-api",
  worker: "tp-unseal-worker",
  migrate: "tp-migrate",
  web: "tp-web",
  public_keys: "tp-public-keys",
  neo: "tp-neo",
};

/** Secret stack 90 đọc bằng `data "aws_secretsmanager_secret"` — thiếu một cái thì plan đỏ, có mà rỗng thì task chết lúc chạy. */
export const SECRET_LUON_CAN = ["tp/api/database-url", "tp/api/otp-peppers", "tp/worker/database-url", "tp/neo/database-url"] as const;
/** Secret token Zalo OA (stack 85) — chỉ cần khi `zalo != null`. */
export const SECRET_ZALO = "tp/api/zalo-oa";

export interface BienStack90 {
  readonly ten_mien: string;
  readonly anh: Readonly<Record<TenAnh, string>>;
  readonly so_ban_api: number;
  readonly so_ban_worker: number;
  readonly ses: { readonly tu_api: string; readonly tu_canh_bao: string; readonly nhan_canh_bao: readonly string[]; readonly configuration_set: string };
  readonly sms: { readonly danh_tinh_gui: string; readonly configuration_set: string | null } | null;
  readonly zalo: { readonly template_otp: string; readonly template_invitation: string; readonly template_deadline: string } | null;
  readonly che_do_dns: string;
  readonly ses_endpoint_service: string;
}

export interface HangSo {
  readonly prod: string;
  readonly region: string;
}

export interface MoTaSecret {
  /** Có phiên bản mang nhãn AWSCURRENT — tức đã `put-secret-value` ít nhất một lần. */
  readonly coBanHienHanh: boolean;
  /** Đang chờ xoá (`DeletedDate`). */
  readonly daXoa: boolean;
}

/** Mọi lời gọi đều CHỈ ĐỌC. `null` = không tồn tại; lỗi khác (hết phiên SSO, thiếu quyền) thì ném. */
export interface CongAws {
  taiKhoan(): Promise<string>;
  moTaSecret(ten: string): Promise<MoTaSecret | null>;
  coImage(kho: string, digest: string): Promise<boolean>;
  danhTinhSes(mien: string): Promise<{ readonly daXacMinh: boolean } | null>;
  sesDaRaSandbox(): Promise<boolean>;
}

const DIGEST_KHONG = /^0{64}$/u;
const EMAIL = /^[^\s@<>]+@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/u;

/** Dấu hiệu giá trị giữ chỗ của hướng dẫn apply: `<...>`, dấu ba chấm, domain ví dụ của RFC 2606. */
export function laGiuCho(giaTri: string): boolean {
  return /[<>]|\.\.\.|…/u.test(giaTri) || /(^|[.@])example\.(com|net|org)$/iu.test(giaTri);
}

const do_ = (ma: string, noiDung: string): KetQua => ({ muc: "DO", ma, noiDung });
const vang = (ma: string, noiDung: string): KetQua => ({ muc: "VANG", ma, noiDung });
const xanh = (ma: string, noiDung: string): KetQua => ({ muc: "XANH", ma, noiDung });

/** Digest của `anh.<ten>` nếu URI đúng dạng `<prod>.dkr.ecr.<region>.amazonaws.com/<kho>@sha256:<64 hex>` và không toàn số 0. */
export function digestHopLe(bien: BienStack90, hang: HangSo, ten: TenAnh): string | null {
  const dau = `${hang.prod}.dkr.ecr.${hang.region}.amazonaws.com/${KHO_ECR[ten]}@sha256:`;
  const uri = bien.anh[ten];
  if (!uri.startsWith(dau)) return null;
  const digest = uri.slice(dau.length);
  return /^[0-9a-f]{64}$/u.test(digest) && !DIGEST_KHONG.test(digest) ? digest : null;
}

export function kiemBien(bien: BienStack90, hang: HangSo): KetQua[] {
  const kq: KetQua[] = [];

  for (const ten of TEN_ANH) {
    const ma = `anh.${ten}`;
    if (digestHopLe(bien, hang, ten) !== null) kq.push(xanh(ma, "ghim digest trong kho ECR cua prod"));
    else
      kq.push(
        do_(ma, `phai la ${hang.prod}.dkr.ecr.${hang.region}.amazonaws.com/${KHO_ECR[ten]}@sha256:<digest that> (APPLY-LAN-DAU 6.3)`),
      );
  }

  kq.push(laGiuCho(bien.ten_mien) ? do_("ten_mien", "con gia tri giu cho") : xanh("ten_mien", bien.ten_mien));

  for (const [ma, dc] of [
    ["ses.tu_api", bien.ses.tu_api],
    ["ses.tu_canh_bao", bien.ses.tu_canh_bao],
  ] as const) {
    kq.push(laGiuCho(dc) || !EMAIL.test(dc) ? do_(ma, "khong phai mot dia chi thu that") : xanh(ma, dc));
  }
  if (bien.ses.nhan_canh_bao.length === 0) kq.push(do_("ses.nhan_canh_bao", "rong: canh bao break-glass khong toi ai"));
  else if (bien.ses.nhan_canh_bao.some((d) => laGiuCho(d) || !EMAIL.test(d)))
    kq.push(do_("ses.nhan_canh_bao", "co dia chi giu cho hoac sai dang"));
  else kq.push(xanh("ses.nhan_canh_bao", `${String(bien.ses.nhan_canh_bao.length)} nguoi nhan`));

  if (bien.sms !== null && laGiuCho(bien.sms.danh_tinh_gui)) kq.push(do_("sms.danh_tinh_gui", "con gia tri giu cho"));
  if (bien.zalo !== null) {
    const giuCho = Object.entries(bien.zalo).filter(([, v]) => laGiuCho(v) || v.trim() === "");
    kq.push(
      giuCho.length > 0
        ? do_("zalo", `template con gia tri giu cho: ${giuCho.map(([k]) => k).join(", ")}`)
        : xanh("zalo", "ba template"),
    );
  }

  if (bien.so_ban_api === 0) kq.push(vang("so_ban_api", "= 0: api khong chay - chi dung o lan apply dau (APPLY-LAN-DAU 6.4)"));
  if (bien.so_ban_worker === 0) kq.push(vang("so_ban_worker", "= 0: worker khong chay - dung toi khi co to chuc dau tien (buoc 8.2)"));
  if (bien.che_do_dns !== "BLOCK") kq.push(vang("che_do_dns", `= ${bien.che_do_dns}: ten mien la chi ghi log, khong chan (buoc 6.8)`));
  if (bien.ses_endpoint_service === "") kq.push(vang("ses_endpoint_service", "rong: task khong gui duoc thu"));

  return kq;
}

/** Miền của một địa chỉ thư — danh tính SES của stack 80 là MIỀN, không phải địa chỉ. */
const mienCua = (diaChi: string): string => diaChi.slice(diaChi.lastIndexOf("@") + 1);

export async function kiemAws(bien: BienStack90, hang: HangSo, aws: CongAws): Promise<KetQua[]> {
  const kq: KetQua[] = [];
  const taiKhoan = await aws.taiKhoan();
  if (taiKhoan !== hang.prod) return [do_("aws.tai_khoan", `profile dang tro toi ${taiKhoan}, khong phai prod ${hang.prod}`)];
  kq.push(xanh("aws.tai_khoan", taiKhoan));

  for (const ten of [...SECRET_LUON_CAN, ...(bien.zalo !== null ? [SECRET_ZALO] : [])]) {
    const ma = `secret ${ten}`;
    const mt = await aws.moTaSecret(ten);
    if (mt === null) kq.push(do_(ma, "khong ton tai (README stack 90, buoc 1)"));
    else if (mt.daXoa) kq.push(do_(ma, "dang cho xoa"));
    else if (!mt.coBanHienHanh) kq.push(do_(ma, "chua co gia tri (chua put-secret-value)"));
    else kq.push(xanh(ma, "co ban hien hanh"));
  }

  for (const ten of TEN_ANH) {
    const digest = digestHopLe(bien, hang, ten);
    if (digest === null) continue; // đã DO ở lớp biến
    const ma = `ecr ${KHO_ECR[ten]}`;
    kq.push((await aws.coImage(KHO_ECR[ten], `sha256:${digest}`)) ? xanh(ma, `co sha256:${digest.slice(0, 12)}`) : do_(ma, `khong co image sha256:${digest}`));
  }

  for (const mien of [...new Set([bien.ses.tu_api, bien.ses.tu_canh_bao].filter((d) => EMAIL.test(d)).map(mienCua))]) {
    const ma = `ses ${mien}`;
    const dt = await aws.danhTinhSes(mien);
    if (dt === null) kq.push(do_(ma, "khong co danh tinh SES (stack 80)"));
    else if (!dt.daXacMinh) kq.push(do_(ma, "chua xac minh - thieu ban ghi DNS (APPLY-LAN-DAU 5.1, 5.2)"));
    else kq.push(xanh(ma, "da xac minh"));
  }
  if (!(await aws.sesDaRaSandbox())) kq.push(vang("ses.sandbox", "tai khoan con trong sandbox SES: chi gui duoc toi dia chi da xac minh"));

  return kq;
}

export function inKetQua(kq: readonly KetQua[]): { dong: string[]; soDo: number; soVang: number } {
  const soDo = kq.filter((k) => k.muc === "DO").length;
  const soVang = kq.filter((k) => k.muc === "VANG").length;
  return {
    dong: [...kq.map((k) => `[${k.muc}]${" ".repeat(5 - k.muc.length)}${k.ma}: ${k.noiDung}`), `kiem-truoc-apply: ${String(soDo)} do, ${String(soVang)} vang`],
    soDo,
    soVang,
  };
}

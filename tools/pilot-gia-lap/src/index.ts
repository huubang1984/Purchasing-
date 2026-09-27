// ==============================================================================================
// tools/pilot-gia-lap — PILOT GIẢ LẬP: hai doanh nghiệp bịa, danh mục kịch bản đi qua API THẬT
//
//   pnpm pilot:gia-lap            (xem `tham-so.ts` cho mọi lệnh)
//
// [ADR-101] Vì sao có công cụ này: không đơn vị nào nhận pilot một sản phẩm chưa hoàn thiện, nên dự
// án cần một cách (a) cho mọi tính năng của kịch bản `docs/PRODUCT.md` §11 chạy trọn trên một cụm có
// đủ bốn tiến trình, bằng nhiều gói thầu, nhiều vai, nhiều nhánh, và (b) để lại một bộ dữ liệu demo
// mà một người trình diễn đi tiếp được trên màn hình. `tools/gieo-demo` gieo MỘT gói ở OPEN bằng SQL
// thô — gói ấy không có hàng sổ cho các bước tạo/duyệt/mở, và tổ chức của nó không đi tới trao thầu.
//
// CÔNG CỤ NÀY KHÔNG PHẢI PILOT VÀ KHÔNG THAY PILOT. Báo cáo của nó mở đầu bằng đúng câu ấy
// (`bao-cao.ts`). Ranh giới an toàn, và mỗi điều có một chỗ cưỡng chế:
//   ⑴ chỉ nhận CSDL cục bộ (`csdl.ts` → `kiemUrlCucBo`), từ chối `NODE_ENV=production`;
//   ⑵ biến môi trường RIÊNG (`TRUSTPROCURE_SEED_DATABASE_URL`), không mượn biến của `apps/api`;
//   ⑶ token và bí mật TOTP chỉ nằm trong thư mục trạng thái 0700 trên POSIX (`cum.json`, `trang-thai.json`) và
//      trên màn hình khi người trình diễn gọi `dang-nhap`/`otp`/`lien-ket` — không trong báo cáo;
//   ⑷ mọi bước nghiệp vụ đi qua HTTP của `apps/api`; kết nối đặc quyền chỉ làm năm việc (`csdl.ts`).
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { dungBaoCaoJson, dungBaoCaoMarkdown, type KiemCoLap, type ToChucBaoCao } from "./bao-cao.js";
import { chayKichBan, type BoiCanhChay, type DongBoCham, type KetQuaKichBan, type NhaCungCapChay, type ToChucChay } from "./chay-kich-ban.js";
import { CsdlDacQuyen, kiemUrlCucBo, urlVaiDangNhap } from "./csdl.js";
import { CONG_MAC_DINH, GOC_KHO, docBiMat, khoiDongCum, kiemThuMucTrangThai, taoBiMat, type Cum } from "./cum.js";
import { NguoiMua, maTotpHienTai } from "./dien-vien.js";
import { emailLienHe, emailNguoi, hoSo, type HoSoToChuc, type MaToChuc } from "./ho-so.js";
import { HopThu, tokenTuLink } from "./hop-thu.js";
import { diaChiGiaLap, layChuoi, PhienHttp } from "./http.js";
import { DANH_MUC, kiemDanhMuc, type KichBan } from "./kich-ban.js";
import { layKhoaBienNhan } from "./kiem-doc-lap.js";
import { TRO_GIUP, docThamSo, type ThamSo } from "./tham-so.js";
import { docTrangThai, docTrangThaiNeuCo, ghiTrangThai, gopTrangThai, luotMoiNhat, type TrangThai, type ToChucTrangThai } from "./trang-thai.js";

class PilotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotError";
  }
}

const viet = (s: string): void => {
  stdout.write(`${s}\n`);
};
const bao = (s: string): void => {
  stderr.write(`[pilot-gia-lap] ${s}\n`);
};

/**
 * Bản Node chạy được cụm, đo bằng một lượt chạy thật trên từng bản:
 * - 22.6: không biết `--experimental-transform-types`; 26.0: đã bỏ cờ ấy. Cả hai làm Node dừng trước khi vào tệp này;
 * - 22.7–22.12 và 23.0–23.1: `api` lên, nhưng `web` chết lúc khởi động vì `module.stripTypeScriptTypes`
 *   (`apps/web/src/phuc-vu.ts`) có ở 23.2 và được đưa về 22.13;
 * - 22.13, 22.22, 23.2, 24.21, 25.9: 10/10.
 * Không có phép kiểm này thì người trình diễn chỉ thấy "tiến trình web dừng lúc khởi động" kèm một `SyntaxError` trong log.
 */
export function kiemPhienBanNode(phienBan: string = process.versions.node): void {
  const [lon = Number.NaN, nho = Number.NaN] = phienBan.split(".").map((s) => Number.parseInt(s, 10));
  const duoc = Number.isInteger(lon) && Number.isInteger(nho) && ((lon === 22 && nho >= 13) || (lon === 23 && nho >= 2) || (lon >= 24 && lon <= 25));
  if (!duoc) {
    throw new PilotError(`cần Node 22 từ 22.13, 23 từ 23.2, hoặc 24–25 — máy này đang chạy Node ${phienBan}`);
  }
}

/**
 * Mã mà lượt chạy đứng trên. Cây làm việc có thay đổi chưa commit thì nói ra — một lần soi ở vòng này:
 * bản đầu đóng dấu băm HEAD sạch lên cả những lượt chạy trên mã sản phẩm đã bị đột biến.
 */
function phienBanMa(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: GOC_KHO, encoding: "utf8" }).trim();
    const doi = execFileSync("git", ["status", "--porcelain"], { cwd: GOC_KHO, encoding: "utf8" }).split("\n").filter((d) => d.trim() !== "").length;
    return doi === 0 ? head : `${head} + ${doi} tệp chưa commit`;
  } catch {
    return "không rõ";
  }
}

// ----------------------------------------------------------------------------------------------
// Chuẩn bị một tổ chức: phần đặc quyền là gieo hàng nền; mọi thứ còn lại đi qua HTTP
// ----------------------------------------------------------------------------------------------

interface BuocChuanBi {
  readonly viec: string;
  readonly dat: boolean;
  readonly thucTe: string;
}

async function dungToChuc(
  db: CsdlDacQuyen,
  hs: HoSoToChuc,
  bc: BoiCanhChay,
  soDienThoai: () => string,
): Promise<{ readonly tc: ToChucChay; readonly chuanBi: readonly BuocChuanBi[] }> {
  const chuanBi: BuocChuanBi[] = [];
  const buoc = (viec: string, dat: boolean, thucTe: string): void => {
    chuanBi.push({ viec, dat, thucTe });
    if (!dat) throw new PilotError(`${hs.ma} — ${viec}: ${thucTe}`);
  };
  const orgId = await db.taoToChuc(hs.ten, `${hs.slugGoc}-${randomBytes(3).toString("hex")}`);
  buoc("gieo tổ chức (kết nối đặc quyền — không có đường ứng dụng)", true, orgId);
  const nguoi = new Map<string, NguoiMua>();
  for (const n of hs.nguoi) {
    const email = emailNguoi(hs, n);
    const userId = await db.taoNguoiDung(orgId, email, n.hoTen, n.vai);
    nguoi.set(n.ma, new NguoiMua(n, email, orgId, userId, bc.apiGoc, bc.diaChiMoi()));
  }
  buoc(`gieo ${hs.nguoi.length} người dùng và vai (kết nối đặc quyền — không vai nào giữ role.grant)`, true, "đạt");
  for (const nm of nguoi.values()) {
    const ms = await nm.dangNhap(bc.hopThu);
    buoc(`${nm.nhan}: link đăng nhập → ghi danh TOTP → phiên`, true, `${ms} ms`);
  }
  const tp = nguoi.get("tp");
  const ktt = nguoi.get("ktt");
  if (tp === undefined || ktt === undefined) throw new PilotError(`${hs.ma}: hồ sơ thiếu trưởng phòng hay kế toán trưởng`);
  const chinhSach = {
    version: 1,
    dualApprovalThreshold: hs.nguongKep,
    currency: "VND",
    evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }],
    bafoTopN: hs.bafoTopN,
  };
  const thu = await tp.http.goi("POST", "/policy", chinhSach);
  buoc("trưởng phòng mua hàng tự khai chính sách mua sắm ⇒ bị từ chối (chỉ FINANCE giữ policy.manage)", thu.status === 403, String(thu.status));
  const cs = await ktt.http.goi("POST", "/policy", chinhSach);
  buoc(`kế toán trưởng khai chính sách v1 — ngưỡng kép ${hs.nguongKep} VND, chấm theo tổng giá, BAFO top-${hs.bafoTopN}`, cs.status === 201, `${cs.status}`);
  const ncc = new Map<string, NhaCungCapChay>();
  for (const n of hs.nhaCungCap) {
    const s = await tp.http.goi("POST", "/suppliers", { legalName: n.tenPhapLy, taxCode: n.mst });
    buoc(`đăng ký nhà cung cấp ${n.tenPhapLy}`, s.status === 201, `${s.status}`);
    const supplierId = layChuoi(s.body, "supplier", "id");
    const lienHe = new Map<string, { contactId: string; email: string; soDienThoai: string; hoTen: string }>();
    for (const lh of n.lienHe) {
      const email = emailLienHe(n, lh);
      const phone = soDienThoai();
      const c = await tp.http.goi("POST", `/suppliers/${supplierId}/contacts`, { fullName: lh.hoTen, email, phone });
      buoc(`thêm người liên hệ ${lh.hoTen} (${lh.boPhan})`, c.status === 201, `${c.status}`);
      lienHe.set(lh.ma, { contactId: layChuoi(c.body, "contact", "id"), email, soDienThoai: phone, hoTen: lh.hoTen });
    }
    ncc.set(n.ma, { supplierId, tenPhapLy: n.tenPhapLy, lienHe });
  }
  return { tc: { hs, orgId, nguoi, ncc }, chuanBi };
}

// ----------------------------------------------------------------------------------------------
// Lệnh `chay`
// ----------------------------------------------------------------------------------------------

export function chonKichBan(ts: Pick<ThamSo, "chi" | "cham">): { readonly chon: readonly KichBan[]; readonly boQua: readonly string[] } {
  const khongCo = ts.chi.filter((m) => !DANH_MUC.some((k) => k.ma === m));
  if (khongCo.length > 0) throw new PilotError(`--chi: không có kịch bản ${khongCo.join(", ")}`);
  // Gọi tên một kịch bản chậm mà thiếu `--cham` là một lời gọi sai, không phải một lượt rỗng ĐẠT: bản
  // đầu lặng lẽ bỏ nó, chạy 0 kịch bản, rồi báo "MỌI kịch bản ĐẠT" với mã thoát 0.
  const chamThieuCo = ts.cham ? [] : ts.chi.filter((m) => DANH_MUC.some((k) => k.ma === m && k.cham === true));
  if (chamThieuCo.length > 0) throw new PilotError(`--chi ${chamThieuCo.join(", ")}: kịch bản chậm (đợi hạn nộp thật) chỉ chạy khi có --cham`);
  const chon: KichBan[] = [];
  const boQua: string[] = [];
  for (const kb of DANH_MUC) {
    const trongChi = ts.chi.length === 0 || ts.chi.includes(kb.ma);
    if (trongChi && (kb.cham !== true || ts.cham)) chon.push(kb);
    else boQua.push(kb.ma);
  }
  if (chon.length === 0) throw new PilotError("không có kịch bản nào để chạy");
  return { chon, boQua };
}

/**
 * Dừng cụm khi nhận SIGINT/SIGTERM ở BẤT KỲ lúc nào từ khi tiến trình con đầu tiên ra đời — giữa lúc
 * khởi động, giữa một kịch bản hay trong lúc đợi hạn nộp thật. Hai lần đo ở vòng này: bản đầu chỉ nghe
 * tín hiệu ở pha giữ cụm cho trình diễn, bản sau chỉ từ khi cụm đã lên; cả hai để lại tiến trình con mồ
 * côi vẫn giữ cổng khi một `kill` tới sớm hơn. (Ctrl+C ở terminal gửi tín hiệu cho cả nhóm tiến trình
 * nên không lộ ra điều ấy.)
 */
function dungKhiCoTinHieu(dung: () => Promise<void>): void {
  let dangDung = false;
  const xuLy = (tinHieu: NodeJS.Signals): void => {
    if (dangDung) return;
    dangDung = true;
    bao(`nhận ${tinHieu} — đang dừng cụm...`);
    void dung().finally(() => process.exit(tinHieu === "SIGINT" ? 130 : 143));
  };
  process.on("SIGINT", xuLy);
  process.on("SIGTERM", xuLy);
}

/** Giữ tiến trình sống cho buổi trình diễn; `dungKhiCoTinHieu` là đường ra duy nhất. */
async function giuChoToiKhiDung(): Promise<void> {
  await new Promise<void>(() => {
    setInterval(() => undefined, 60_000);
  });
}

async function chuanBiCum(ts: ThamSo, thuMuc: string): Promise<{ readonly cum: Cum; readonly db: CsdlDacQuyen }> {
  const seed = process.env.TRUSTPROCURE_SEED_DATABASE_URL?.trim() ?? "";
  if (seed === "") throw new PilotError("thiếu TRUSTPROCURE_SEED_DATABASE_URL — superuser của một Postgres 16 CỤC BỘ, CSDL riêng cho pilot giả lập");
  kiemUrlCucBo(seed);
  const db = CsdlDacQuyen.mo(seed);
  try {
    const soMigration = await db.apMigration();
    bao(`migrate: áp ${soMigration} migration mới`);
    let biMat = await docBiMat(thuMuc);
    if (biMat === null) {
      if (await db.coDauKiemVongKhoa()) {
        throw new PilotError(
          `CSDL này đã được khởi tạo bằng MỘT vòng khoá khác (có dấu kiểm ở public.master_key_check_values), còn ${thuMuc} ` +
            "chưa có cum.json — `api` sẽ từ chối khởi động (khoản 165). Dùng lại thư mục trạng thái cũ (--thu-muc), hay một CSDL mới.",
        );
      }
      biMat = await taoBiMat(thuMuc);
      bao(`sinh bí mật cụm mới ở ${join(thuMuc, "cum.json")}`);
    } else {
      bao(`dùng lại bí mật cụm ở ${join(thuMuc, "cum.json")}`);
    }
    await db.damBaoVaiDangNhap("app_api_login", biMat.matKhauApi);
    await db.damBaoVaiDangNhap("app_unseal_login", biMat.matKhauWorker);
    const cum = await khoiDongCum(
      {
        thuMuc,
        cong: ts.cong,
        biMat,
        urlApi: urlVaiDangNhap(seed, "app_api_login", biMat.matKhauApi),
        urlWorker: urlVaiDangNhap(seed, "app_unseal_login", biMat.matKhauWorker),
      },
      dungKhiCoTinHieu,
    );
    bao(`cụm đã sẵn sàng — web ${cum.webGoc}, api ${cum.apiGoc}, khoá công khai ${cum.khoaGoc}; log ở ${cum.logDir}`);
    return { cum, db };
  } catch (e) {
    await db.dong();
    throw e;
  }
}

async function chay(ts: ThamSo, thuMuc: string): Promise<number> {
  const loiDanhMuc = kiemDanhMuc();
  if (loiDanhMuc.length > 0) throw new PilotError(`danh mục kịch bản không chạy được:\n  ${loiDanhMuc.join("\n  ")}`);
  const { chon, boQua } = chonKichBan(ts);
  // Đọc trạng thái cũ TRƯỚC khi dựng cụm: một tệp hỏng phải dừng lượt chạy ngay, không phải sau một giờ.
  const trangThaiCu = await docTrangThaiNeuCo(thuMuc);
  const batDau = new Date().toISOString();
  // Dấu mã lấy LÚC BẮT ĐẦU, khi mã của công cụ và của bốn tiến trình được nạp. Một lần đo ở vòng này:
  // lượt chậm đầu lấy dấu lúc ghi báo cáo, một giờ sau, và đóng dấu một commit tạo ra GIỮA lượt chạy.
  const maLuc = phienBanMa();
  const { cum, db } = await chuanBiCum(ts, thuMuc);
  let maThoat = 1;
  try {
    const hopThu = await HopThu.mo(cum.hopThuDir);
    const khoaBienNhan = await layKhoaBienNhan(cum.khoaGoc);
    const maLuot = randomInt(0, 0x10000);
    let demDiaChi = 0;
    let demSo = 0;
    const bc: BoiCanhChay = {
      apiGoc: cum.apiGoc,
      webGoc: cum.webGoc,
      hopThu,
      maLuot,
      khoaBienNhan,
      thuMucBangChung: join(thuMuc, "bang-chung", batDau.replace(/[:.]/gu, "-")),
      diaChiMoi: () => {
        demDiaChi += 1;
        return diaChiGiaLap(maLuot, demDiaChi);
      },
      bao,
      demSoKiemToan: (orgId) => db.demTongSoKiemToan(orgId),
      demSoKiemToanTheoHanhDong: (orgId) => db.demSoKiemToan(orgId),
    };
    // Số điện thoại: 10 chữ số, đầu 09, bốn số của lượt chạy rồi bốn số thứ tự — đúng CHECK của `008`.
    const soDienThoai = (): string => {
      demSo += 1;
      return `09${String(maLuot % 10000).padStart(4, "0")}${String(demSo).padStart(4, "0")}`;
    };

    const maToChuc = [...new Set(chon.map((k) => k.toChuc))];
    const toChuc = new Map<MaToChuc, { readonly tc: ToChucChay; readonly chuanBi: readonly BuocChuanBi[] }>();
    for (const ma of maToChuc) {
      bao(`chuẩn bị tổ chức ${ma}...`);
      toChuc.set(ma, await dungToChuc(db, hoSo(ma), bc, soDienThoai));
    }
    await cum.batWorker();
    bao("worker mở thầu đã chạy");
    const tcCua = (kb: KichBan): ToChucChay => {
      const t = toChuc.get(kb.toChuc);
      if (t === undefined) throw new PilotError(`tổ chức ${kb.toChuc} chưa được dựng`);
      return t.tc;
    };

    // Kịch bản CHẬM dựng gói, mời, nhận báo giá MỘT MÌNH; các kịch bản nhanh chạy trong lúc nó ĐỢI hạn
    // thật; và nó chỉ đi tiếp sau hạn khi các kịch bản nhanh đã xong. Một lần soi ở vòng này: bản đầu để
    // hai phần ấy chồng lên nhau trong cùng tổ chức SX — hai phiên OTP cùng số điện thoại của S2/S4 có
    // thể lấy nhầm mã của nhau (tin OTP không mang lời mời), và hàng sổ của kịch bản chậm lọt được vào
    // cửa sổ đo "vào sổ" của một bước CHAN kịch bản nhanh.
    const cham = chon.filter((k) => k.cham === true);
    const nhanh = chon.filter((k) => k.cham !== true);
    let nhanhXong = (): void => undefined;
    const choNhanhXong = new Promise<void>((kq) => {
      nhanhXong = kq;
    });
    const hua: Promise<KetQuaKichBan>[] = [];
    try {
      for (const kb of cham) {
        bao(`[${kb.ma}] bắt đầu (chế độ chậm)...`);
        let dangDoi = (): void => undefined;
        const daVaoDoi = new Promise<void>((kq) => {
          dangDoi = kq;
        });
        const dongBo: DongBoCham = { baoDangDoi: () => dangDoi(), choDiTiep: choNhanhXong };
        const p = chayKichBan(kb, tcCua(kb), bc, true, dongBo);
        hua.push(p);
        await Promise.race([daVaoDoi, p.then(() => undefined)]);
      }
    } catch (e) {
      nhanhXong();
      throw e;
    }
    const ketQua: KetQuaKichBan[] = [];
    try {
      for (const kb of nhanh) {
        bao(`[${kb.ma}] ${kb.ten}...`);
        const kq = await chayKichBan(kb, tcCua(kb), bc, false);
        bao(`[${kb.ma}] ${kq.dat ? "ĐẠT" : `KHÔNG ĐẠT — ${kq.loi ?? ""}`} (${Math.round(kq.soLieu.thoiGianMs / 1000)} giây)`);
        ketQua.push(kq);
      }
    } finally {
      nhanhXong();
    }
    for (const kq of await Promise.all(hua)) {
      bao(`[${kq.ma}] ${kq.dat ? "ĐẠT" : `KHÔNG ĐẠT — ${kq.loi ?? ""}`}`);
      ketQua.push(kq);
    }
    ketQua.sort((a, b) => DANH_MUC.findIndex((k) => k.ma === a.ma) - DANH_MUC.findIndex((k) => k.ma === b.ma));

    // Cô lập giữa hai tổ chức: người của tổ chức này hỏi thẳng id của tổ chức kia — mỗi lần đọc chéo đi
    // sau một ĐỐI CHỨNG DƯƠNG (người của chính tổ chức đọc cùng id ⇒ 200), để 404 không thể đến từ một
    // đường đọc hỏng cho mọi người.
    const coLap: KiemCoLap[] = [];
    const sx = toChuc.get("SX");
    const xd = toChuc.get("XD");
    if (sx !== undefined && xd !== undefined) {
      const goiXd = ketQua.find((k) => k.toChuc === xd.tc.hs.ten && k.rfqId !== null)?.rfqId;
      const tpSx = sx.tc.nguoi.get("tp");
      const tpXd = xd.tc.nguoi.get("tp");
      const nccSx = sx.tc.ncc.get("S1")?.supplierId;
      if (goiXd != null && tpSx !== undefined && tpXd !== undefined) {
        const dc = await tpXd.http.goi("GET", `/rfqs/${goiXd}`);
        coLap.push({ viec: `${tpXd.nhan} (XD) đọc gói thầu của chính XD`, mongDoi: "200", thucTe: String(dc.status), dat: dc.status === 200, doiChung: true });
        const r = await tpSx.http.goi("GET", `/rfqs/${goiXd}`);
        coLap.push({ viec: `${tpSx.nhan} (SX) đọc thẳng id gói thầu của XD`, mongDoi: "404", thucTe: String(r.status), dat: r.status === 404 });
      }
      if (nccSx !== undefined && tpXd !== undefined && tpSx !== undefined) {
        const dc = await tpSx.http.goi("GET", `/suppliers/${nccSx}`);
        coLap.push({ viec: `${tpSx.nhan} (SX) đọc nhà cung cấp của chính SX`, mongDoi: "200", thucTe: String(dc.status), dat: dc.status === 200, doiChung: true });
        const r = await tpXd.http.goi("GET", `/suppliers/${nccSx}`);
        coLap.push({ viec: `${tpXd.nhan} (XD) đọc thẳng id nhà cung cấp của SX`, mongDoi: "404", thucTe: String(r.status), dat: r.status === 404 });
      }
    }

    const baoCaoToChuc: ToChucBaoCao[] = [];
    for (const [ma, t] of toChuc) {
      baoCaoToChuc.push({
        ma,
        ten: t.tc.hs.ten,
        nganh: t.tc.hs.nganh,
        orgId: t.tc.orgId,
        soNguoi: t.tc.hs.nguoi.length,
        soNhaCungCap: t.tc.hs.nhaCungCap.length,
        nguongKep: t.tc.hs.nguongKep,
        soKiemToan: await db.demSoKiemToan(t.tc.orgId),
        chuanBi: t.chuanBi,
      });
    }
    const ketThuc = new Date().toISOString();
    const kq = { batDau, ketThuc, cheDo: ts.cham ? "cham" : "nhanh", phienBanMa: maLuc, toChuc: baoCaoToChuc, kichBan: ketQua, coLap, boQua } as const;
    const thuMucBaoCao = join(thuMuc, "bao-cao", batDau.replace(/[:.]/gu, "-"));
    await mkdir(thuMucBaoCao, { recursive: true, mode: 0o700 });
    const md = dungBaoCaoMarkdown(kq);
    await writeFile(join(thuMucBaoCao, "bao-cao.md"), md, { mode: 0o600 });
    await writeFile(join(thuMucBaoCao, "bao-cao.json"), dungBaoCaoJson(kq), { mode: 0o600 });
    await writeFile(join(thuMuc, "bao-cao-moi-nhat.md"), md, { mode: 0o600 });

    const tt: ToChucTrangThai[] = [...toChuc.entries()].map(([ma, t]) => ({
      ma,
      ten: t.tc.hs.ten,
      orgId: t.tc.orgId,
      luot: batDau,
      nguoi: [...t.tc.nguoi.values()].map((n) => ({ ma: n.hoSo.ma, hoTen: n.hoSo.hoTen, chucDanh: n.hoSo.chucDanh, vai: n.hoSo.vai, email: n.email, totpBase32: n.biMatTotp })),
      loiMoiConLai: ketQua
        .filter((k) => k.toChuc === t.tc.hs.ten && k.demo !== null)
        .flatMap((k) => (k.demo?.loiMoiConLai ?? []).map((l) => ({ kichBan: k.ma, nhaCungCap: l.tenNcc, lienHe: l.lienHe, soDienThoai: l.soDienThoai, token: l.token }))),
      goiDeLai: ketQua
        .filter((k) => k.toChuc === t.tc.hs.ten && k.demo !== null && k.rfqId !== null)
        .map((k) => ({ kichBan: k.ma, rfqId: k.rfqId ?? "", buocTiep: k.demo?.buocTiep ?? [] })),
    }));
    await ghiTrangThai(thuMuc, gopTrangThai(trangThaiCu, tt, ketThuc));

    const soDat = ketQua.filter((k) => k.dat).length;
    const tatCa = ketQua.length > 0 && soDat === ketQua.length && coLap.every((c) => c.dat);
    viet("");
    const coLapChan = coLap.filter((c) => c.doiChung !== true);
    viet(
      `=== PILOT GIẢ LẬP — ${soDat}/${ketQua.length} kịch bản ĐẠT, ` +
        (coLapChan.length > 0
          ? `cô lập ${coLapChan.filter((c) => c.dat).length}/${coLapChan.length} (đối chứng ${coLap.filter((c) => c.doiChung === true && c.dat).length}/${coLap.length - coLapChan.length}) ===`
          : "cô lập KHÔNG chạy (lượt chỉ dựng một tổ chức) ==="),
    );
    viet(`Báo cáo: ${join(thuMucBaoCao, "bao-cao.md")}`);
    for (const k of ketQua) viet(`  ${k.dat ? "ĐẠT      " : "KHÔNG ĐẠT"} ${k.ma}  ${k.ten}${k.dat ? "" : ` — ${k.loi ?? ""}`}`);
    maThoat = tatCa ? 0 : 1;
    if (ts.dungSau) return maThoat;

    viet("");
    viet(`Cụm vẫn chạy cho buổi trình diễn — web: ${cum.webGoc}/mo-thau · ${cum.webGoc}/tao-thau · ${cum.webGoc}/nop-thau`);
    viet("Gói để lại cho trình diễn:");
    for (const k of ketQua.filter((x) => x.demo !== null)) {
      viet(`  ${k.ma}  ${k.ten}  (gói ${k.rfqId ?? "—"})`);
      for (const b of k.demo?.buocTiep ?? []) viet(`      - ${b}`);
    }
    viet("Lệnh hỗ trợ (ở cửa sổ khác): pnpm pilot:gia-lap dang-nhap <email> · otp <số điện thoại> · lien-ket");
    viet("Ctrl+C để dừng cụm.");
    await giuChoToiKhiDung();
    return maThoat;
  } finally {
    await cum.dung();
    await db.dong();
  }
}

// ----------------------------------------------------------------------------------------------
// Lệnh hỗ trợ trình diễn
// ----------------------------------------------------------------------------------------------

async function dangNhap(ts: ThamSo, thuMuc: string): Promise<number> {
  const email = (ts.doiSo[0] ?? "").toLowerCase();
  const chonOrg = ts.doiSo[1];
  const tt = await docTrangThai(thuMuc);
  // Mỗi lượt `chay` dựng tổ chức MỚI với cùng các email, và trạng thái giữ mọi lượt (mới nhất trước):
  // mặc định là tổ chức mới nhất có email ấy, orgId sau email chọn một tổ chức cũ hơn.
  const khop = tt.toChuc.filter((t) => t.nguoi.some((x) => x.email === email) && (chonOrg === undefined || t.orgId === chonOrg));
  const tc = khop[0];
  const n = tc?.nguoi.find((x) => x.email === email);
  if (tc === undefined || n === undefined) {
    throw new PilotError(
      `không có người mua giả lập ${email}${chonOrg === undefined ? "" : ` ở tổ chức ${chonOrg}`} — có: ` +
        [...new Set(tt.toChuc.flatMap((t) => t.nguoi.map((x) => x.email)))].join(", "),
    );
  }
  const hopThu = await HopThu.mo(join(thuMuc, "hop-thu"));
  const http = new PhienHttp(`http://127.0.0.1:${ts.cong.api}`, "127.0.0.1");
  const r = await http.goi("POST", "/auth/link", { orgId: tc.orgId, email });
  if (r.status !== 200) throw new PilotError(`/auth/link trả ${r.status} — cụm có đang chạy không?`);
  const tin = await hopThu.cho(`link đăng nhập của ${email}`, (t) => t.loai === "LOGIN_LINK" && t.orgId === tc.orgId && t.den === email);
  if (tin.loai !== "LOGIN_LINK") throw new PilotError("tin sai loại");
  const token = tokenTuLink(tin.duongLink, tin.orgId);
  const web = `http://127.0.0.1:${ts.cong.web}`;
  viet(`${n.hoTen} — ${n.chucDanh} (${n.vai}) · ${tc.ten} · tổ chức ${tc.orgId}`);
  if (khop.length > 1) {
    viet(`  (email này có ở ${khop.length} tổ chức giả lập của các lượt chạy — đang dùng lượt MỚI NHẤT; lượt cũ hơn: ${khop.slice(1).map((t) => t.orgId).join(", ")} — thêm orgId sau email để chọn)`);
  }
  // [S1.9102] MỘT link: bản trước in hai link /mo-thau# và /tao-thau# cùng một mã dùng một lần, nên link thứ hai
  // luôn chết sau khi dùng link thứ nhất. Trang sau đó hỏi lại phiên còn hạn — mở nó KHÔNG kèm `#`.
  viet(`  link đăng nhập      : ${web}/mo-thau#${tc.orgId}:${token}`);
  viet("  (link dùng MỘT lần, hết hạn sau 15 phút)");
  viet(`  sau khi vào         : mở ${web}/tao-thau hay ${web}/chinh-sach KHÔNG kèm # rồi bấm "Tiếp tục với phiên này"`);
  viet("                        (phiên sống tới 8 giờ; điều phối giải mã vẫn đòi mã sáu số trong 15 phút gần nhất)");
  if (n.totpBase32 !== null) {
    const m = maTotpHienTai(n.totpBase32);
    viet(`  mã TOTP hiện tại    : ${m.ma}  (còn ${m.conGiay} giây)`);
    viet(`  thêm vào ứng dụng   : otpauth://totp/TrustProcure:${encodeURIComponent(email)}?secret=${n.totpBase32}&issuer=TrustProcure`);
  }
  return 0;
}

async function otp(ts: ThamSo, thuMuc: string): Promise<number> {
  const den = ts.doiSo[0] ?? "";
  const hopThu = await HopThu.mo(join(thuMuc, "hop-thu"));
  const m = await hopThu.otpMoiNhat(den);
  if (m === null) {
    viet(`chưa có mã OTP nào gửi tới ${den}`);
    return 1;
  }
  viet(`OTP mới nhất tới ${den}: ${m.ma}  (tệp ${m.ten}; mã sống 5 phút)`);
  return 0;
}

/**
 * Gói mà lượt MỚI NHẤT để lại, kèm mã gói — thứ người trình diễn phải dán ở bước 2 của /tao-thau và
 * /mo-thau. Lượt soi tài liệu của vòng này: sau `cum`, không lệnh nào in lại mã gói, và hạn nộp của gói
 * để lại tính từ LƯỢT CHẠY (SX-04: ba ngày), không từ lúc dựng lại cụm.
 */
function inGoiDeLai(tt: TrangThai): void {
  const moi = luotMoiNhat(tt);
  const luot = moi[0]?.luot;
  viet(`Gói lượt mới nhất để lại${luot === undefined ? "" : ` (lượt bắt đầu ${luot})`}:`);
  for (const tc of moi) {
    for (const g of tc.goiDeLai) {
      viet(`  ${g.kichBan}  gói ${g.rfqId}  · ${tc.ten}`);
      for (const b of g.buocTiep) viet(`      - ${b}`);
    }
  }
  const tuoiMs = luot === undefined ? Number.NaN : Date.now() - Date.parse(luot);
  if (Number.isFinite(tuoiMs) && tuoiMs > 2 * 24 * 60 * 60_000) {
    viet(`  CẢNH BÁO: lượt này đã ${Math.floor(tuoiMs / (24 * 60 * 60_000))} ngày — hạn nộp của gói đang mở (SX-04: 3 ngày) tính từ lượt chạy. Trước buổi trình diễn, chạy lại \`pnpm pilot:gia-lap\`.`);
  }
}

async function lienKet(ts: ThamSo, thuMuc: string): Promise<number> {
  const tt = await docTrangThai(thuMuc);
  const web = `http://127.0.0.1:${ts.cong.web}`;
  const moi = new Set(luotMoiNhat(tt).map((t) => t.orgId));
  let n = 0;
  for (const tc of tt.toChuc) {
    if (tc.loiMoiConLai.length > 0) viet(`— ${tc.ten} · tổ chức ${tc.orgId} · ${moi.has(tc.orgId) ? "LƯỢT MỚI NHẤT" : `lượt cũ${tc.luot === undefined ? "" : ` (${tc.luot})`}`}`);
    for (const l of tc.loiMoiConLai) {
      n += 1;
      viet(`${l.kichBan}  ${l.nhaCungCap} — ${l.lienHe} (OTP tới ${l.soDienThoai})`);
      viet(`    ${web}/nop-thau#${tc.orgId}:${l.token}`);
    }
  }
  if (n === 0) viet("không còn lời mời nào chờ nộp");
  return 0;
}

async function giuCum(ts: ThamSo, thuMuc: string): Promise<number> {
  const { cum, db } = await chuanBiCum(ts, thuMuc);
  await db.dong();
  try {
    await cum.batWorker();
  } catch (e) {
    await cum.dung();
    throw e;
  }
  viet(`Cụm chạy — web: ${cum.webGoc}/mo-thau · ${cum.webGoc}/tao-thau · ${cum.webGoc}/nop-thau. Ctrl+C để dừng.`);
  // Cụm đã lên: một trang-thai.json hỏng chỉ đáng một dòng báo, không đáng bỏ cụm chạy mà không ai dừng.
  try {
    const tt = await docTrangThaiNeuCo(thuMuc);
    if (tt !== null) inGoiDeLai(tt);
  } catch (e) {
    bao(`không đọc được trang-thai.json — ${e instanceof Error ? e.message : String(e)}`);
  }
  await giuChoToiKhiDung();
  return 0;
}

async function chinh(argv: readonly string[]): Promise<number> {
  const ts = docThamSo(argv, CONG_MAC_DINH);
  if (ts.lenh === "tro-giup") {
    stdout.write(TRO_GIUP);
    return 0;
  }
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "prod") {
    throw new PilotError("từ chối chạy khi NODE_ENV=production — đây là công cụ DEV");
  }
  kiemPhienBanNode();
  const thuMuc = resolve(ts.thuMuc ?? join(GOC_KHO, ".pilot-gia-lap"));
  kiemThuMucTrangThai(GOC_KHO, thuMuc);
  switch (ts.lenh) {
    case "chay":
      return chay(ts, thuMuc);
    case "cum":
      return giuCum(ts, thuMuc);
    case "dang-nhap":
      return dangNhap(ts, thuMuc);
    case "otp":
      return otp(ts, thuMuc);
    case "lien-ket":
      return lienKet(ts, thuMuc);
  }
}

// Chỉ tự chạy khi là điểm vào — để test import được các hàm thuần mà không dựng cụm.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(GOC_KHO, "tools", "pilot-gia-lap", "src", "index.ts")) {
  chinh(process.argv.slice(2)).then(
    (ma) => {
      process.exitCode = ma;
    },
    (e: unknown) => {
      bao(e instanceof Error ? `${e.name}: ${e.message}` : "lỗi không rõ");
      process.exitCode = 1;
    },
  );
}


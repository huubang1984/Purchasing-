// ==============================================================================================
// tools/pilot-gia-lap — PILOT GIẢ LẬP: hai doanh nghiệp bịa, danh mục kịch bản đi qua API THẬT
//
//   pnpm pilot:gia-lap            (xem `tham-so.ts` cho mọi lệnh)
//
// [ADR-9201] Vì sao có công cụ này: không đơn vị nào nhận pilot một sản phẩm chưa hoàn thiện, nên dự
// án cần một cách (a) cho mọi tính năng của kịch bản `docs/PRODUCT.md` §11 chạy trọn trên một cụm có
// đủ bốn tiến trình, bằng nhiều gói thầu, nhiều vai, nhiều nhánh, và (b) để lại một bộ dữ liệu demo
// mà một người trình diễn đi tiếp được trên màn hình. `tools/gieo-demo` gieo MỘT gói ở OPEN bằng SQL
// thô — gói ấy không có hàng sổ cho các bước tạo/duyệt/mở, và tổ chức của nó không đi tới trao thầu.
//
// CÔNG CỤ NÀY KHÔNG PHẢI PILOT VÀ KHÔNG THAY PILOT. Báo cáo của nó mở đầu bằng đúng câu ấy
// (`bao-cao.ts`). Ranh giới an toàn, và mỗi điều có một chỗ cưỡng chế:
//   ⑴ chỉ nhận CSDL cục bộ (`csdl.ts` → `kiemUrlCucBo`), từ chối `NODE_ENV=production`;
//   ⑵ biến môi trường RIÊNG (`TRUSTPROCURE_SEED_DATABASE_URL`), không mượn biến của `apps/api`;
//   ⑶ token và bí mật TOTP chỉ nằm trong thư mục trạng thái 0700 (`cum.json`, `trang-thai.json`) và
//      trên màn hình khi người trình diễn gọi `dang-nhap`/`otp`/`lien-ket` — không trong báo cáo;
//   ⑷ mọi bước nghiệp vụ đi qua HTTP của `apps/api`; kết nối đặc quyền chỉ làm năm việc (`csdl.ts`).
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { dungBaoCaoJson, dungBaoCaoMarkdown, type KiemCoLap, type ToChucBaoCao } from "./bao-cao.js";
import { chayKichBan, type BoiCanhChay, type KetQuaKichBan, type NhaCungCapChay, type ToChucChay } from "./chay-kich-ban.js";
import { CsdlDacQuyen, kiemUrlCucBo, urlVaiDangNhap } from "./csdl.js";
import { CONG_MAC_DINH, GOC_KHO, docBiMat, khoiDongCum, taoBiMat, type Cum } from "./cum.js";
import { NguoiMua, maTotpHienTai } from "./dien-vien.js";
import { emailLienHe, emailNguoi, hoSo, type HoSoToChuc, type MaToChuc } from "./ho-so.js";
import { HopThu, tokenTuLink } from "./hop-thu.js";
import { diaChiGiaLap, layChuoi, PhienHttp } from "./http.js";
import { DANH_MUC, kiemDanhMuc, type KichBan } from "./kich-ban.js";
import { layKhoaBienNhan } from "./kiem-doc-lap.js";
import { TRO_GIUP, docThamSo, type ThamSo } from "./tham-so.js";
import { docTrangThai, ghiTrangThai, type ToChucTrangThai } from "./trang-thai.js";

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

function phienBanMa(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: GOC_KHO, encoding: "utf8" }).trim();
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

function chonKichBan(ts: ThamSo): { readonly chon: readonly KichBan[]; readonly boQua: readonly string[] } {
  const khongCo = ts.chi.filter((m) => !DANH_MUC.some((k) => k.ma === m));
  if (khongCo.length > 0) throw new PilotError(`--chi: không có kịch bản ${khongCo.join(", ")}`);
  const chon: KichBan[] = [];
  const boQua: string[] = [];
  for (const kb of DANH_MUC) {
    const trongChi = ts.chi.length === 0 || ts.chi.includes(kb.ma);
    if (trongChi && (kb.cham !== true || ts.cham)) chon.push(kb);
    else boQua.push(kb.ma);
  }
  return { chon, boQua };
}

/**
 * Dừng cụm khi nhận SIGINT/SIGTERM ở BẤT KỲ lúc nào sau khi cụm lên — kể cả giữa một kịch bản hay
 * trong lúc đợi hạn nộp thật. Một lần đo ở vòng này: bản đầu chỉ nghe tín hiệu ở pha giữ cụm cho trình
 * diễn, nên một `kill` gửi tới tiến trình công cụ trong lúc chạy để lại bốn tiến trình con mồ côi vẫn
 * giữ cổng. (Ctrl+C ở terminal gửi tín hiệu cho cả nhóm tiến trình nên không lộ ra điều ấy.)
 */
function dungKhiCoTinHieu(cum: Cum): void {
  let dangDung = false;
  const xuLy = (tinHieu: NodeJS.Signals): void => {
    if (dangDung) return;
    dangDung = true;
    bao(`nhận ${tinHieu} — đang dừng cụm...`);
    void cum.dung().finally(() => process.exit(tinHieu === "SIGINT" ? 130 : 143));
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
    const cum = await khoiDongCum({
      thuMuc,
      cong: ts.cong,
      biMat,
      urlApi: urlVaiDangNhap(seed, "app_api_login", biMat.matKhauApi),
      urlWorker: urlVaiDangNhap(seed, "app_unseal_login", biMat.matKhauWorker),
    });
    dungKhiCoTinHieu(cum);
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
  const batDau = new Date().toISOString();
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

    // Kịch bản CHẬM chạy song song: nó dựng gói, nhận báo giá, rồi ĐỢI hạn thật — trong lúc ấy các
    // kịch bản nhanh chạy. Chỉ phần đợi chồng lên nhau; hai phần có ghi sổ thì cách nhau gần một giờ.
    const cham = chon.filter((k) => k.cham === true);
    const nhanh = chon.filter((k) => k.cham !== true);
    const hua: Promise<KetQuaKichBan>[] = [];
    for (const kb of cham) {
      bao(`[${kb.ma}] bắt đầu (chế độ chậm)...`);
      hua.push(chayKichBan(kb, tcCua(kb), bc, true));
    }
    const ketQua: KetQuaKichBan[] = [];
    for (const kb of nhanh) {
      bao(`[${kb.ma}] ${kb.ten}...`);
      const kq = await chayKichBan(kb, tcCua(kb), bc, false);
      bao(`[${kb.ma}] ${kq.dat ? "ĐẠT" : `KHÔNG ĐẠT — ${kq.loi ?? ""}`} (${Math.round(kq.soLieu.thoiGianMs / 1000)} giây)`);
      ketQua.push(kq);
    }
    for (const kq of await Promise.all(hua)) {
      bao(`[${kq.ma}] ${kq.dat ? "ĐẠT" : `KHÔNG ĐẠT — ${kq.loi ?? ""}`}`);
      ketQua.push(kq);
    }
    ketQua.sort((a, b) => DANH_MUC.findIndex((k) => k.ma === a.ma) - DANH_MUC.findIndex((k) => k.ma === b.ma));

    // Cô lập giữa hai tổ chức: người của tổ chức này hỏi thẳng id của tổ chức kia.
    const coLap: KiemCoLap[] = [];
    const sx = toChuc.get("SX");
    const xd = toChuc.get("XD");
    if (sx !== undefined && xd !== undefined) {
      const goiXd = ketQua.find((k) => k.toChuc === xd.tc.hs.ten && k.rfqId !== null)?.rfqId;
      const tpSx = sx.tc.nguoi.get("tp");
      const tpXd = xd.tc.nguoi.get("tp");
      const nccSx = sx.tc.ncc.get("S1")?.supplierId;
      if (goiXd != null && tpSx !== undefined) {
        const r = await tpSx.http.goi("GET", `/rfqs/${goiXd}`);
        coLap.push({ viec: `${tpSx.nhan} (SX) đọc thẳng id gói thầu của XD`, mongDoi: "404", thucTe: String(r.status), dat: r.status === 404 });
      }
      if (nccSx !== undefined && tpXd !== undefined) {
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
    const kq = { batDau, ketThuc, cheDo: ts.cham ? "cham" : "nhanh", phienBanMa: phienBanMa(), toChuc: baoCaoToChuc, kichBan: ketQua, coLap, boQua } as const;
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
      nguoi: [...t.tc.nguoi.values()].map((n) => ({ ma: n.hoSo.ma, hoTen: n.hoSo.hoTen, chucDanh: n.hoSo.chucDanh, vai: n.hoSo.vai, email: n.email, totpBase32: n.biMatTotp })),
      loiMoiConLai: ketQua
        .filter((k) => k.toChuc === t.tc.hs.ten && k.demo !== null)
        .flatMap((k) => (k.demo?.loiMoiConLai ?? []).map((l) => ({ kichBan: k.ma, nhaCungCap: l.tenNcc, lienHe: l.lienHe, soDienThoai: l.soDienThoai, token: l.token }))),
      goiDeLai: ketQua
        .filter((k) => k.toChuc === t.tc.hs.ten && k.demo !== null && k.rfqId !== null)
        .map((k) => ({ kichBan: k.ma, rfqId: k.rfqId ?? "", buocTiep: k.demo?.buocTiep ?? [] })),
    }));
    await ghiTrangThai(thuMuc, { phienBan: 1, taoLuc: ketThuc, toChuc: tt });

    const soDat = ketQua.filter((k) => k.dat).length;
    const tatCa = soDat === ketQua.length && coLap.every((c) => c.dat);
    viet("");
    viet(`=== PILOT GIẢ LẬP — ${soDat}/${ketQua.length} kịch bản ĐẠT${coLap.length > 0 ? `, cô lập ${coLap.filter((c) => c.dat).length}/${coLap.length}` : ""} ===`);
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
  const tt = await docTrangThai(thuMuc);
  const tc = tt.toChuc.find((t) => t.nguoi.some((n) => n.email === email));
  const n = tc?.nguoi.find((x) => x.email === email);
  if (tc === undefined || n === undefined) {
    throw new PilotError(`không có người mua giả lập ${email} — có: ${tt.toChuc.flatMap((t) => t.nguoi.map((x) => x.email)).join(", ")}`);
  }
  const hopThu = await HopThu.mo(join(thuMuc, "hop-thu"));
  const http = new PhienHttp(`http://127.0.0.1:${ts.cong.api}`, "127.0.0.1");
  const r = await http.goi("POST", "/auth/link", { orgId: tc.orgId, email });
  if (r.status !== 200) throw new PilotError(`/auth/link trả ${r.status} — cụm có đang chạy không?`);
  const tin = await hopThu.cho(`link đăng nhập của ${email}`, (t) => t.loai === "LOGIN_LINK" && t.orgId === tc.orgId && t.den === email);
  if (tin.loai !== "LOGIN_LINK") throw new PilotError("tin sai loại");
  const token = tokenTuLink(tin.duongLink);
  const web = `http://127.0.0.1:${ts.cong.web}`;
  viet(`${n.hoTen} — ${n.chucDanh} (${n.vai}) · ${tc.ten}`);
  viet(`  mở thầu / trao thầu : ${web}/mo-thau#${tc.orgId}:${token}`);
  viet(`  tạo gói / mời       : ${web}/tao-thau#${tc.orgId}:${token}`);
  viet("  (link dùng MỘT lần, hết hạn sau 15 phút)");
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

async function lienKet(ts: ThamSo, thuMuc: string): Promise<number> {
  const tt = await docTrangThai(thuMuc);
  const web = `http://127.0.0.1:${ts.cong.web}`;
  let n = 0;
  for (const tc of tt.toChuc) {
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
  viet(`Cụm chạy — web: ${cum.webGoc}/mo-thau. Ctrl+C để dừng.`);
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
  const thuMuc = resolve(ts.thuMuc ?? join(GOC_KHO, ".pilot-gia-lap"));
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


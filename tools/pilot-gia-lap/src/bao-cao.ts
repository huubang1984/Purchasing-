// ==============================================================================================
// tools/pilot-gia-lap — BÁO CÁO PILOT GIẢ LẬP (hàm thuần: kết quả → Markdown + JSON)
//
// BA LUẬT CỦA BÁO CÁO, và cả ba có test:
//   ⑴ dòng ĐẦU TIÊN nói nó là giả lập, và khối "Điều báo cáo này KHÔNG chứng minh" luôn có mặt —
//      `docs/TIEN-DE-CHUA-DO.md` gọi pilot giả lập coi như pilot thật là lớp khiếm khuyết "xanh giả";
//   ⑵ không một token, mã OTP hay bí mật TOTP nào: báo cáo là thứ đem đi cho người khác đọc, còn
//      token nằm ở `trang-thai.json` 0600;
//   ⑶ con số tiền là số của DỮ LIỆU GIẢ LẬP; câu nào nhắc tới North Star phải nói rằng nó không
//      phải một phép đo North Star.
// ==============================================================================================

import type { KetQuaKichBan } from "./chay-kich-ban.js";
import type { DemHanhDong } from "./csdl.js";
import { congTien, dinhDangVnd, phanTram, soSanhTien } from "./tien.js";

export interface KiemCoLap {
  readonly viec: string;
  readonly mongDoi: string;
  readonly thucTe: string;
  readonly dat: boolean;
}

export interface ToChucBaoCao {
  readonly ma: string;
  readonly ten: string;
  readonly nganh: string;
  readonly orgId: string;
  readonly soNguoi: number;
  readonly soNhaCungCap: number;
  readonly nguongKep: string;
  readonly soKiemToan: readonly DemHanhDong[];
  readonly chuanBi: readonly { readonly viec: string; readonly dat: boolean; readonly thucTe: string }[];
}

export interface KetQuaChay {
  readonly batDau: string;
  readonly ketThuc: string;
  readonly cheDo: "nhanh" | "cham";
  readonly phienBanMa: string;
  readonly toChuc: readonly ToChucBaoCao[];
  readonly kichBan: readonly KetQuaKichBan[];
  readonly coLap: readonly KiemCoLap[];
  readonly boQua: readonly string[];
}

export const BANNER =
  "> **⚠ DỮ LIỆU GIẢ LẬP — KHÔNG PHẢI PILOT.** Mọi tổ chức, người, nhà cung cấp và mức giá dưới đây là bịa, " +
  "do `tools/pilot-gia-lap` sinh ra trên một cụm cục bộ. Báo cáo này KHÔNG đóng mảnh 4 (*khách hàng pilot*) của " +
  "`docs/PRODUCT.md` §11 và KHÔNG xác nhận dòng nào của `docs/TIEN-DE-CHUA-DO.md`.";

const TU_CHOI = new Set([
  "PERMISSION_DENIED",
  "UNSEAL_APPROVAL_DENIED",
  "UNSEAL_DENIED",
  "COMPARISON_DENIED",
  "BID_DEADLINE_DENIED",
  "RFQ_STATE_DENIED",
  "UNSEAL_CANCEL_DENIED",
  "MFA_LOCKED",
]);

function thoiLuong(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const giay = Math.round(ms / 1000);
  return giay < 120 ? `${giay} giây` : `${Math.floor(giay / 60)} phút ${giay % 60} giây`;
}

/** Ô bảng Markdown: một dòng, không `|`. */
function o(s: string): string {
  return s.replace(/\r?\n/gu, " ").replace(/\|/gu, "\\|");
}

const TEN_DUNG: Record<KetQuaKichBan["dungO"], string> = {
  PENDING_APPROVAL: "để lại: chờ chữ ký duyệt gói thứ hai",
  OPEN: "để lại: đang mở nhận báo giá",
  UNSEAL_PENDING: "để lại: chờ chữ ký mở thầu thứ hai",
  AWARD_PROPOSED: "để lại: trao thầu chờ duyệt",
  CANCELLED: "chạy trọn: gói bị huỷ",
  AWARD_APPROVED: "chạy trọn: trao thầu đã duyệt + bộ bằng chứng",
};

export function tongHop(kq: KetQuaChay): {
  readonly soDat: number;
  readonly soKichBan: number;
  readonly soBuoc: number;
  readonly soChanDat: number;
  readonly soChan: number;
  readonly soChanVaoSo: number;
  readonly soPhienBanNop: number;
  readonly soBienNhanHopLe: number;
  readonly soBienNhanDaKiem: number;
  readonly soBoBangChungOk: number;
  readonly soBoBangChungCan: number;
  readonly giaTriTraoThau: string;
  readonly nganSachTraoThau: string;
} {
  const daDuyet = kq.kichBan.filter((k) => k.dat && k.trangThaiTraoThau === "APPROVED" && k.soLieu.giaTrungThau !== null);
  const buoc = kq.kichBan.flatMap((k) => k.buoc);
  return {
    soDat: kq.kichBan.filter((k) => k.dat).length,
    soKichBan: kq.kichBan.length,
    soBuoc: buoc.length,
    soChanDat: buoc.filter((b) => b.loai === "CHAN" && b.dat).length,
    soChan: buoc.filter((b) => b.loai === "CHAN").length,
    soChanVaoSo: buoc.filter((b) => b.loai === "CHAN" && b.vaoSo === true).length,
    soPhienBanNop: kq.kichBan.reduce((t, k) => t + k.soLieu.soPhienBanNop, 0),
    soBienNhanHopLe: kq.kichBan.reduce((t, k) => t + k.soLieu.soBienNhanHopLe, 0),
    soBienNhanDaKiem: kq.kichBan.reduce((t, k) => t + k.soLieu.soBienNhanDaKiem, 0),
    soBoBangChungOk: kq.kichBan.filter((k) => k.soLieu.boBangChungOk === true).length,
    soBoBangChungCan: kq.kichBan.filter((k) => k.dungO === "AWARD_APPROVED").length,
    giaTriTraoThau: congTien(daDuyet.map((k) => k.soLieu.giaTrungThau ?? "0.00")),
    nganSachTraoThau: congTien(daDuyet.map((k) => k.soLieu.nganSach)),
  };
}

export function dungBaoCaoMarkdown(kq: KetQuaChay): string {
  const th = tongHop(kq);
  const ra: string[] = [];
  const tatCaDat = th.soDat === th.soKichBan && kq.coLap.every((c) => c.dat) && kq.toChuc.every((t) => t.chuanBi.every((c) => c.dat));
  ra.push(BANNER, "");
  ra.push(`# Báo cáo pilot giả lập — ${kq.batDau.slice(0, 10)}`, "");
  ra.push(`Chạy từ ${kq.batDau} tới ${kq.ketThuc}, chế độ **${kq.cheDo === "cham" ? "chậm (có đợi hạn nộp thật)" : "nhanh (đóng sớm có lý do)"}**, trên mã \`${kq.phienBanMa}\`.`, "");
  ra.push(`**Kết luận của lượt chạy: ${tatCaDat ? "MỌI kịch bản và mọi phép kiểm ĐẠT" : "CÓ kịch bản hoặc phép kiểm KHÔNG ĐẠT — đọc mục 3 và mục 5"}.**`, "");

  ra.push("## 1. Tóm tắt", "");
  ra.push("| Chỉ số | Giá trị |", "|---|---|");
  ra.push(`| Kịch bản đạt | ${th.soDat}/${th.soKichBan} |`);
  ra.push(`| Bước đã chạy qua API thật | ${th.soBuoc} |`);
  ra.push(`| Lần thử SAI bị sản phẩm chặn đúng | ${th.soChanDat}/${th.soChan} |`);
  ra.push(`| Trong đó: lần từ chối để lại hàng sổ kiểm toán | ${th.soChanVaoSo}/${th.soChan} — xem cột *Vào sổ* ở mục 4 |`);
  ra.push(`| Phiên bản báo giá niêm phong đã nộp | ${th.soPhienBanNop} |`);
  ra.push(`| Biên nhận kiểm chứng được bằng khoá công khai | ${th.soBienNhanHopLe}/${th.soBienNhanDaKiem} |`);
  ra.push(`| Bộ bằng chứng qua bộ kiểm độc lập (không CSDL) | ${th.soBoBangChungOk}/${th.soBoBangChungCan} |`);
  ra.push(
    `| Giá trị trao thầu đã duyệt (GIẢ LẬP) | ${dinhDangVnd(th.giaTriTraoThau)} VND trên dự toán ${dinhDangVnd(th.nganSachTraoThau)} VND ` +
      `(${soSanhTien(th.nganSachTraoThau, "0.00") > 0 ? phanTram(th.giaTriTraoThau, th.nganSachTraoThau) : "—"}) |`,
  );
  ra.push("");
  ra.push(
    "Dòng cuối có hình dạng của *Verified Competitive Spend* (`docs/PRODUCT.md` §9) nhưng **không phải** một phép đo North Star: " +
      "giá do bộ giả lập chọn, nên mức chênh so với dự toán nói về danh mục kịch bản, không nói về thị trường.",
    "",
  );

  ra.push("## 2. Hai doanh nghiệp giả lập", "");
  ra.push("| Mã | Tổ chức | Ngành | Người dùng | Nhà cung cấp | Ngưỡng phê duyệt kép | Sự kiện sổ kiểm toán | Trong đó: lần từ chối được ghi sổ |", "|---|---|---|---|---|---|---|---|");
  for (const t of kq.toChuc) {
    const tong = t.soKiemToan.reduce((s, d) => s + d.n, 0);
    const tuChoi = t.soKiemToan.filter((d) => TU_CHOI.has(d.action)).reduce((s, d) => s + d.n, 0);
    ra.push(`| ${t.ma} | ${o(t.ten)} | ${o(t.nganh)} | ${t.soNguoi} | ${t.soNhaCungCap} | ${dinhDangVnd(t.nguongKep)} VND | ${tong} | ${tuChoi} |`);
  }
  ra.push("");
  for (const t of kq.toChuc) {
    const hong = t.chuanBi.filter((c) => !c.dat);
    ra.push(
      `- **${t.ma} — chuẩn bị:** ${t.chuanBi.length} bước (gieo tổ chức và người dùng bằng kết nối đặc quyền; mọi người ĐĂNG NHẬP THẬT bằng link + TOTP; ` +
        `kế toán trưởng khai chính sách; trưởng phòng đăng ký nhà cung cấp) — ${hong.length === 0 ? "đạt" : `**${hong.length} bước KHÔNG ĐẠT**: ${hong.map((h) => o(`${h.viec}: ${h.thucTe}`)).join("; ")}`}.`,
    );
  }
  ra.push("");

  ra.push("## 3. Kịch bản", "");
  ra.push("| Mã | Kịch bản | Dừng ở | Trạng thái gói | Trao thầu | Nhà cung cấp trúng | Giá trúng | Thời gian | Kết quả |", "|---|---|---|---|---|---|---|---|---|");
  for (const k of kq.kichBan) {
    ra.push(
      `| ${k.ma} | ${o(k.ten)} | ${TEN_DUNG[k.dungO]} | ${k.trangThaiGoi ?? "—"} | ${k.trangThaiTraoThau ?? "—"} | ${o(k.soLieu.nhaCungCapTrungThau ?? "—")} | ` +
        `${k.soLieu.giaTrungThau === null ? "—" : `${dinhDangVnd(k.soLieu.giaTrungThau)}`} | ${thoiLuong(k.soLieu.thoiGianMs)} | ${k.dat ? "ĐẠT" : `**KHÔNG ĐẠT** — ${o(k.loi ?? "")}`} |`,
    );
  }
  if (kq.boQua.length > 0) ra.push("", `Không chạy ở lượt này: ${kq.boQua.join(", ")} (chỉ chạy với \`--cham\` hay bị lọc bởi \`--chi\`).`);
  ra.push("");

  ra.push("## 4. Kiểm soát đã được kích hoạt — mỗi dòng là một lần thử SAI có chủ đích", "");
  ra.push("| Kịch bản | Ai thử | Hành vi | Mong đợi | Thực tế | Ràng buộc | Kết quả | Vào sổ |", "|---|---|---|---|---|---|---|---|");
  for (const k of kq.kichBan) {
    for (const b of k.buoc.filter((x) => x.loai === "CHAN")) {
      ra.push(
        `| ${k.ma} | ${o(b.ai)} | ${o(b.viec)} | ${o(b.mongDoi)} | ${o(b.thucTe)} | ${o(b.batBien ?? "")} | ${b.dat ? "chặn đúng" : "**KHÔNG CHẶN**"} | ` +
          `${b.vaoSo === undefined ? "—" : b.vaoSo ? "có" : "**không**"} |`,
      );
    }
  }
  for (const c of kq.coLap) ra.push(`| cô lập | — | ${o(c.viec)} | ${o(c.mongDoi)} | ${o(c.thucTe)} | RLS theo tổ chức | ${c.dat ? "chặn đúng" : "**KHÔNG CHẶN**"} | — |`);
  ra.push("");
  ra.push(
    "*Vào sổ* là một phép ĐO (số hàng `audit_events` của tổ chức trước và sau lần thử), không phải điều kiện đạt: luật ghi sổ từ chối " +
      "của dự án là chọn lọc (ADR-060), và lần từ chối do trigger huỷ giao dịch thì không vào sổ được. Một dòng **không** ở đây là thứ " +
      "cần đối chiếu với lời khai của chính ràng buộc ấy — không tự động là một khiếm khuyết.",
    "",
  );

  ra.push("## 5. Chi tiết từng kịch bản", "");
  for (const k of kq.kichBan) {
    ra.push(`### ${k.ma} — ${k.ten}`, "");
    ra.push(`Tổ chức: ${k.toChuc}. Gói: \`${k.rfqId ?? "—"}\`. Dự toán ${dinhDangVnd(k.soLieu.nganSach)} VND; ${k.soLieu.soLoiMoi} lời mời; ${k.soLieu.soPhienBanNop} phiên bản báo giá.`, "");
    ra.push("Minh hoạ:", "");
    for (const m of k.minhHoa) ra.push(`- ${m}`);
    ra.push("");
    ra.push("| t | Loại | Ai | Việc | Mong đợi | Thực tế | |", "|---|---|---|---|---|---|---|");
    for (const b of k.buoc) {
      ra.push(`| ${thoiLuong(b.t)} | ${b.loai} | ${o(b.ai)} | ${o(b.viec)} | ${o(b.mongDoi)} | ${o(b.thucTe)} | ${b.dat ? "✓" : "✗"} |`);
    }
    ra.push("");
    if (k.demo !== null) {
      ra.push("**Để lại cho buổi trình diễn — bước tiếp theo:**", "");
      for (const d of k.demo.buocTiep) ra.push(`1. ${d}`);
      if (k.demo.loiMoiConLai.length > 0) {
        ra.push("", `Lời mời còn chờ nộp: ${k.demo.loiMoiConLai.map((l) => `${l.tenNcc} (${l.lienHe})`).join("; ")}. Link nằm ở \`trang-thai.json\` — in bằng lệnh \`lien-ket\`.`);
      }
      ra.push("");
    }
  }

  ra.push("## 6. Sổ kiểm toán theo hành động", "");
  for (const t of kq.toChuc) {
    ra.push(`**${t.ma}** — ${t.soKiemToan.map((d) => `\`${d.action}\` ${d.n}`).join(" · ") || "(trống)"}`, "");
  }

  ra.push("## 7. Điều báo cáo này KHÔNG chứng minh", "");
  ra.push(
    "- **Không có người mua thật, nhà cung cấp thật, điện thoại thật.** Nhà cung cấp là một tiến trình Node niêm phong bằng CÙNG mã với trang `/nop-thau` " +
      "(`sealBid`), không phải một người trên trình duyệt di động; tỷ lệ bỏ cuộc ở bước OTP, webview Zalo, thói quen chuyển tiếp link — không đo được ở đây.",
    "- **Không có hạ tầng thật.** Khoá là local-dev, thư đi vào hộp thư dev, một máy, một CSDL. Mảnh 3 (*triển khai thật*) không đổi.",
    "- **Thời gian bị nén.** Chế độ nhanh đóng gói sớm có lý do; thời gian chu trình ở mục 3 là thời gian của máy, không phải của một phòng mua hàng.",
    "- **Giá do bộ giả lập chọn.** Không một tham số GIẢ ĐỊNH nào của spec S3 được *hiệu chỉnh* bằng số liệu này (spec S3 §8.3).",
    "- **Đạt ở đây nghĩa là sản phẩm cư xử ĐÚNG NHƯ ĐẶC TẢ trên dữ liệu bịa** — không nghĩa là đặc tả đúng với một quy trình mua sắm thật. " +
      "Câu hỏi ấy chỉ một người mua thật trả lời được (`docs/TIEN-DE-CHUA-DO.md`).",
  );
  ra.push("");
  return ra.join("\n");
}

/** Bản JSON của kết quả — cùng dữ liệu, cho máy đọc; đã bỏ token của lời mời còn lại. */
export function dungBaoCaoJson(kq: KetQuaChay): string {
  const sach = {
    ...kq,
    canhBao: "DU LIEU GIA LAP — KHONG PHAI PILOT",
    kichBan: kq.kichBan.map((k) => ({
      ...k,
      demo: k.demo === null ? null : { ...k.demo, loiMoiConLai: k.demo.loiMoiConLai.map((l) => ({ ncc: l.ncc, tenNcc: l.tenNcc, lienHe: l.lienHe })) },
    })),
  };
  return `${JSON.stringify(sach, null, 2)}\n`;
}

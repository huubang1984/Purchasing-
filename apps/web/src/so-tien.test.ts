// ==============================================================================================
// [S1.99 / khoản 206] PHÉP ĐO CHO SỐ TIỀN CỦA TRANG NỘP THẦU
//
// Vế trung tâm của tệp này là `describe("hiển thị và đọc vào phải là một")`: nó lấy ĐẦU RA của
// hàm hiển thị rồi đưa thẳng vào hàm đọc, và đòi ra lại đúng con số ban đầu. Đó là vế mà khiếm
// khuyết đã vi phạm — trang in `1.500.000,00` rồi đọc `1.500` thành một — và nó là vế duy nhất ở
// đây không thể qua được bằng cách chép lại chính lỗi ấy vào cả hai phía... trừ khi ai đó đổi cả
// hai phía cùng lúc, nên bảng ca cụ thể ngay dưới ghim từng dạng viết một.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { SO_LE_HE_SO, SO_LE_TIEN, docSo, lamTron, vietSo } from "@trustprocure/danh-gia";
import { cong, donGiaNguoiGo, nhomSo, sangNguyen, thanhTien, tien } from "./so-tien.js";

describe("[S1.99 / khoản 206] đơn giá người gõ", () => {
  // Cột phải là thứ NGƯỜI VIỆT gõ định nói. Trang tự in dạng nhóm nghìn, nên nhận lại dạng ấy.
  it.each([
    ["1500000", "1500000"],
    ["1.500.000", "1500000"],
    ["1.500", "1500"],
    ["500", "500"],
    ["1.000.000.000", "1000000000"],
    ["  1.500  ", "1500"],
    ["0", "0"],
  ])("đọc %s thành %s", (go, mong) => {
    expect(donGiaNguoiGo(go)).toBe(mong);
  });

  // Mọi dạng mơ hồ phải bị TỪ CHỐI, không được đoán. `12.5` là ca đã im lặng ra `12`.
  it.each([
    ["12.5"],
    ["1.50"],
    ["1.5000"],
    ["12,5"],
    ["1,500,000"],
    ["1.500.00"],
    ["1234.567"],
    [""],
    ["   "],
    ["-1500"],
    ["1e6"],
    ["1 500"],
    ["abc"],
  ])("từ chối %s", (go) => {
    expect(donGiaNguoiGo(go)).toBeNull();
  });
});

describe("[S1.99 / khoản 206] hiển thị và đọc vào phải là một", () => {
  // Nếu một ngày ai đó đổi `nhomSo` sang dấu phẩy mà quên `donGiaNguoiGo`, vế này đỏ.
  it.each([["1"], ["12"], ["500"], ["1500"], ["1500000"], ["1000000000"], ["123456789"]])(
    "nhomSo(%s) đọc ngược lại ra chính nó",
    (n) => {
      expect(donGiaNguoiGo(nhomSo(n))).toBe(n);
    },
  );

  it("phần nguyên của một chuỗi tiền hiển thị đọc ngược lại được", () => {
    // `tien` in `1500000.00` thành `1.500.000,00`; phần trước dấu phẩy phải đọc lại ra 1500000.
    const hien = tien("1500000.00");
    expect(hien).toBe("1.500.000,00");
    expect(donGiaNguoiGo(hien.split(",")[0] ?? "")).toBe("1500000");
  });
});

describe("[S1.99 / khoản 206] chuỗi máy sinh ra", () => {
  it.each([
    ["2.0000", 4, 20000n],
    ["2", 4, 20000n],
    ["0.5000", 4, 5000n],
    ["1500000.00", 2, 150000000n],
    ["7", 0, 7n],
  ])("sangNguyen(%s, %i) = %s", (s, soLe, mong) => {
    expect(sangNguyen(s, soLe)).toBe(mong);
  });

  // Cắt cụt ÂM THẦM là khiếm khuyết cùng lớp ở phía chuỗi máy: `1.500` với soLe=0 từng ra `1n`.
  it.each([
    ["1.500", 0],
    ["12.5", 0],
    ["1.00001", 4],
    ["0.123", 2],
  ])("từ chối %s ở soLe=%i thay vì cắt cụt", (s, soLe) => {
    expect(sangNguyen(s, soLe)).toBeNull();
  });
});

describe("[S1.99 / khoản 206] thành tiền và cộng", () => {
  it("nhân số lượng thập phân với đơn giá nguyên, không qua double", () => {
    expect(thanhTien("2.0000", "1500000")).toBe("3000000.00");
    expect(thanhTien("0.5000", "1500001")).toBe("750000.50");
    // 0.1 + 0.2 của `double` là 0.30000000000000004; đường BigInt không có chỗ cho sai số ấy.
    expect(cong(["0.10", "0.20"])).toBe("0.30");
  });

  it("một đơn giá dạng người gõ phải đi qua donGiaNguoiGo TRƯỚC, không vào thẳng", () => {
    // Đây là hình dạng lỗi cũ, ghim lại để không ai nối thẳng ô nhập vào `thanhTien` lần nữa.
    expect(thanhTien("1.0000", "1.500")).toBeNull();
    const chuan = donGiaNguoiGo("1.500");
    expect(chuan).toBe("1500");
    expect(thanhTien("1.0000", chuan ?? "")).toBe("1500.00");
  });

  it("một dòng không đọc được làm cả tổng không đọc được", () => {
    expect(cong(["1500.00", null])).toBeNull();
    expect(cong(["1500.00", "abc"])).toBeNull();
  });
});

// ==============================================================================================
// [S1.104 / khoản 218 — ĐO, KHÔNG VÁ] → [S1.9181 / khoản 218 — ĐÓNG] `thanhTien` NAY LÀM TRÒN
// NỬA-RA-XA-0, CÙNG LUẬT VỚI `lamTron` CỦA `@trustprocure/danh-gia`.
//
// ADR-050 mục *Cái giá* nói thẳng: quyết định ⑴ ghim luật làm tròn cho `effective_cost` và nó
// **KHÔNG sửa `so-tien.ts`** — sửa một lớp tiền đang chạy là một vòng riêng có phép đo riêng,
// vì con số này đi vào PHONG BÌ NIÊM PHONG và người nộp không có lượt thứ hai. ~~Khối này không
// vá gì. Nó làm một việc khác: biến khoản 218 từ một câu ĐỌC ĐƯỢC thành một con số ĐO ĐƯỢC,
// và nếu ai đó hợp nhất hai luật thì chính khối này đỏ và nói ra rằng khoản 218 đã đóng.~~
// **[S1.9181] Vòng riêng ấy là vòng này, và khối này LẬT:** nó từng ĐÒI hai luật lệch nhau ở
// đúng 50 phần dư; nay nó đòi hai luật KHỚP trên cả 100 phần dư cộng bảng ca nửa xu, và giữ
// luật cũ (cắt cụt) làm ĐỐI CHỨNG để phép đo không xanh vì hai bên cùng cắt.
//
// **Lời khai của sổ nợ HẸP HƠN sự thật, và vòng S1.104 sửa nó:** thân khoản 218 viết hệ quả là
// *“một đơn giá và một lượng cho phần lẻ ĐÚNG NỬA XU”*. Đo thật: hai luật lệch nhau ở **50
// trên 100** phần dư — mọi phần dư từ 50 tới 99 — tức **một nửa mọi đầu vào**, không phải một
// điểm. `quantity` là `numeric(18,4)` nên tích sinh chữ số thứ ba ở mọi báo giá có phần lẻ.
//
// Vì sao đối chiếu với `lamTron` chứ không với Postgres ở đây: `nua-xu.int.test.ts` đã ghim
// `lamTron` bằng `pg_catalog.round(x, 2)` chạy thật trên cùng bảng ca nửa xu (dương, âm, sát hai
// bên điểm hoà); tệp này là test đơn vị không CSDL, nên nó đứng trên vai phép đo ấy. `so-tien.ts`
// không import được `lamTron` — nó đi thẳng ra trình duyệt qua `/lib/so-tien.js` — nên hai bản
// là hai bản, và chính vì thế chúng phải được đo cạnh nhau.
// ==============================================================================================
describe("[S1.9181 / khoản 218] hai tầng, MỘT luật — thanhTien khớp lamTron của @trustprocure/danh-gia", () => {
  /** `thanhTien` ở tỉ lệ 10^2, đọc lại về `bigint` để so với luật của `@trustprocure/danh-gia`. */
  function cuaTrang(luong: string, donGia: string): bigint | null {
    const s = thanhTien(luong, donGia);
    return s === null ? null : docSo(s, SO_LE_TIEN);
  }

  /** Cùng đầu vào, theo luật nửa-ra-xa-0 mà `effective_cost` dùng. */
  function cuaSanPham(luong: string, donGia: string): bigint | null {
    const a = docSo(luong, SO_LE_HE_SO);
    const b = docSo(donGia, 0);
    if (a === null || b === null) return null;
    return lamTron(a * b, SO_LE_HE_SO, SO_LE_TIEN);
  }

  /** Luật CŨ của trang — cắt cụt về 0 — giữ làm đối chứng, không phải để ai dùng lại. */
  function catCut(luong: string, donGia: string): bigint | null {
    const a = docSo(luong, SO_LE_HE_SO);
    const b = docSo(donGia, 0);
    if (a === null || b === null) return null;
    return (a * b) / 100n;
  }

  // Bảng ca nửa xu: hoà đúng nửa xu, sát hai bên điểm hoà, hoà sinh ra từ đơn giá chứ không từ
  // lượng, và hai ca mà thân khoản 218 gọi tên. Mọi hàng là một con số DUY NHẤT cho cả hai tầng.
  it.each([
    ["0.0050", "1", "0.01"],
    ["0.0099", "1", "0.01"],
    ["1.2345", "2", "2.47"],
    ["0.0150", "1", "0.02"],
    ["0.0250", "1", "0.03"],
    ["0.0049", "1", "0.00"],
    ["0.0051", "1", "0.01"],
    ["0.0025", "2", "0.01"],
    ["0.0001", "49", "0.00"],
    ["0.0001", "50", "0.01"],
    ["0.3333", "3", "1.00"],
    ["1.2345", "7", "8.64"],
    ["1.2345", "6", "7.41"],
    ["0.5000", "1500001", "750000.50"],
    ["9999999999.9999", "1", "10000000000.00"],
  ])("lượng %s × đơn giá %s = %s ở trang VÀ ở luật của sản phẩm", (sl, dg, mong) => {
    const t = cuaTrang(sl, dg);
    const p = cuaSanPham(sl, dg);
    expect(t).not.toBeNull();
    expect(p).not.toBeNull();
    expect(vietSo(t ?? 0n, SO_LE_TIEN)).toBe(mong);
    expect(vietSo(p ?? 0n, SO_LE_TIEN)).toBe(mong);
  });

  it("KHỚP ở cả 100 phần dư của lượng × đơn giá mod 100 — không còn phần dư nào lệch", () => {
    const lech: number[] = [];
    for (let i = 0; i < 100; i++) {
      const luong = `0.${String(i).padStart(4, "0")}`;
      if (cuaTrang(luong, "1") !== cuaSanPham(luong, "1")) lech.push(i);
    }
    expect(lech, "khoản 218 mở lại: các phần dư lệch").toEqual([]);
  });

  it("phần dư sinh từ ĐƠN GIÁ cũng khớp: đơn giá 1..199 nhân lượng 0.0001..0.0099", () => {
    for (let dg = 1; dg < 200; dg++) {
      for (let i = 1; i < 100; i++) {
        const luong = `0.${String(i).padStart(4, "0")}`;
        expect(cuaTrang(luong, String(dg)), `${luong} × ${String(dg)}`).toBe(cuaSanPham(luong, String(dg)));
      }
    }
  });

  it("ĐỐI CHỨNG: luật cũ (cắt cụt) lệch với luật của sản phẩm ở ĐÚNG 50 phần dư 50–99, và thanhTien nay KHÁC cắt cụt ở đúng những phần dư ấy", () => {
    const du: number[] = [];
    for (let i = 0; i < 100; i++) {
      const luong = `0.${String(i).padStart(4, "0")}`;
      if (catCut(luong, "1") !== cuaSanPham(luong, "1")) du.push(i);
    }
    expect(du, "đối chứng mất răng: cắt cụt và làm tròn không còn phân biệt được").toHaveLength(50);
    expect([du[0], du[du.length - 1]]).toEqual([50, 99]);
    for (const i of du) {
      const luong = `0.${String(i).padStart(4, "0")}`;
      expect(cuaTrang(luong, "1"), `phần dư ${String(i)} vẫn bị cắt cụt`).not.toBe(catCut(luong, "1"));
    }
  });

  it("miền của trang không có số âm, nên vế ÂM của luật (chỗ nửa-ra-xa-0 khác nửa-lên) không có đầu vào ở đây — nói ra, không đo giả", () => {
    expect(thanhTien("-1.0000", "1")).toBeNull();
    expect(thanhTien("1.0000", "-1")).toBeNull();
    // Luật của sản phẩm thì có miền âm (khoản giảm trừ): −0.0050 → −0.01, ra xa 0. Ngày `sangNguyen`
    // nhận dấu trừ, `thanhTien` phải mang cả vế này — và vế trên đỏ trước để nhắc.
    expect(vietSo(lamTron(-50n, SO_LE_HE_SO, SO_LE_TIEN), SO_LE_TIEN)).toBe("-0.01");
  });
});

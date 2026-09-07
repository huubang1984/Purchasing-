import { createSign, generateKeyPairSync } from "node:crypto";
import { taoBoKyNeoThuNghiem } from "@trustprocure/test-support";
import { describe, expect, it } from "vitest";
import { buildAnchorText, type AnchorFields } from "./anchor-text.js";
import { laNeoDaKiemChuKy, verifyAnchorRecord, type ExternalAnchor } from "./anchor-verify.js";

const ORG = "11111111-2222-3333-4444-555555555555";
const TRUONG: Omit<AnchorFields, "kid"> = {
  orgId: ORG,
  seq: 6,
  hashHex: "a".repeat(64),
  exportedAt: "2026-09-07T10:11:12.345Z",
};

describe("kiểm chữ ký mốc neo", () => {
  it("[INV-B3] bản ghi hợp lệ đúc ra một mốc neo mang xuất xứ DẪN XUẤT, không phải chữ người gọi", () => {
    const bo = taoBoKyNeoThuNghiem("neo-2026");
    const neo = verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho-S3-object-lock");

    expect(neo.orgId).toBe(ORG);
    expect(neo.seq).toBe(6);
    expect(neo.hashHex).toBe("a".repeat(64));
    expect(neo.exportedAt).toBe("2026-09-07T10:11:12.345Z");
    // `source` phải mang CẢ nơi cất LẪN kid, và kid phải là kid nằm trong văn bản đã ký.
    expect(neo.source).toBe("kho-S3-object-lock · kid=neo-2026 · chữ ký ĐÃ KIỂM");
    expect(laNeoDaKiemChuKy(neo)).toBe(true);
  });

  it("[INV-B3] chữ ký do MỘT CÀI ĐẶT KHÁC sinh ra vẫn kiểm được", () => {
    // Vế chịu lực nằm ở fixture chứ không ở dòng này: `taoBoKyNeoThuNghiem` ký bằng
    // `createSign` của `node:crypto` — đúng con đường `openssl dgst -sha256 -sign` đi — chứ
    // không gọi `anchor-sign.ts`. Nên MỌI test trong file này là một phép đối chiếu hai cài đặt,
    // không phải một phép thử "hàm kiểm là nghịch đảo của hàm ký của chính nó".
    const bo = taoBoKyNeoThuNghiem();
    expect(() => verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho")).not.toThrow();
  });

  it("[INV-B3] sửa MỘT ký tự của văn bản đã ký thì chữ ký không khớp", () => {
    const bo = taoBoKyNeoThuNghiem();
    const that = bo.ky(TRUONG);
    const suaSeq = { ...that, text: that.text.replace("seq=6", "seq=3") };
    expect(() => verifyAnchorRecord(suaSeq, bo.khoaCongKhai, "kho")).toThrow(/KHÔNG khớp văn bản/);
  });

  it("[INV-B3] sửa chữ ký thì bị từ chối", () => {
    const bo = taoBoKyNeoThuNghiem();
    const that = bo.ky(TRUONG);
    const sigHong = Buffer.from(that.sig, "base64");
    sigHong.writeUInt8(sigHong.readUInt8(sigHong.length - 1) ^ 0xff, sigHong.length - 1);
    expect(() =>
      verifyAnchorRecord({ ...that, sig: sigHong.toString("base64") }, bo.khoaCongKhai, "kho"),
    ).toThrow();
  });

  it("[INV-B3] mốc neo ký bằng khoá mà kiểm toán viên KHÔNG tin thì bị từ chối", () => {
    // Đây là ca quan trọng nhất của cả file: kẻ tấn công đúc một mốc neo khớp hoàn hảo với cái
    // sổ họ vừa sửa. Mọi trường đều tự nhất quán; thứ duy nhất họ không có là khoá riêng.
    const that = taoBoKyNeoThuNghiem("neo-2026");
    const gia = taoBoKyNeoThuNghiem("neo-2026");
    expect(() => verifyAnchorRecord(gia.ky(TRUONG), that.khoaCongKhai, "kho")).toThrow(
      /KHÔNG khớp văn bản/,
    );
  });

  it("[INV-B3] kid không có trong vòng khoá thì bị từ chối, và thông điệp nói ra hệ quả", () => {
    const bo = taoBoKyNeoThuNghiem("neo-2027");
    expect(() => verifyAnchorRecord(bo.ky(TRUONG), new Map(), "kho")).toThrow(
      /không có "neo-2027".*KHÔNG được gỡ khỏi vòng khoá/s,
    );
  });

  it.each([
    ["không phải đối tượng", "chuoi"],
    ["null", null],
    ["thiếu text", { sig: "AA==" }],
    ["thiếu sig", { text: "x" }],
  ])("từ chối bản ghi %s", (_ten, banGhi) => {
    const bo = taoBoKyNeoThuNghiem();
    expect(() => verifyAnchorRecord(banGhi, bo.khoaCongKhai, "kho")).toThrow();
  });

  it("[INV-B3] văn bản KÝ HỢP LỆ mà không ở dạng chính tắc thì vẫn bị từ chối", () => {
    // Kẻ có khoá riêng ký được bất cứ chuỗi nào — nhưng "có khoá riêng" không có nghĩa là "được
    // sinh ra một hình dạng khác". `seq=06` đọc ngược ra số 6 y hệt `seq=6`, nên nếu bộ kiểm chỉ
    // phân tích rồi tin kết quả thì HAI văn bản khác nhau cùng đại diện MỘT mốc neo — đúng lớp
    // nhập nhằng mà một định dạng dùng cho pháp lý không được có.
    const bo = taoBoKyNeoThuNghiem("neo-2026");
    const lech = buildAnchorText({ ...TRUONG, kid: "neo-2026" }).replace("seq=6", "seq=06");
    expect(() => verifyAnchorRecord(bo.kyVanBan(lech), bo.khoaCongKhai, "kho")).toThrow(
      /không ở dạng chính tắc/,
    );
  });

  it("[INV-B3] văn bản khai một thuật toán khác thì bị từ chối", () => {
    const bo = taoBoKyNeoThuNghiem("neo-2026");
    const doiAlg = buildAnchorText({ ...TRUONG, kid: "neo-2026" }).replace(
      "alg=ECDSA_P256_SHA256",
      "alg=NONE",
    );
    expect(() => verifyAnchorRecord(bo.kyVanBan(doiAlg), bo.khoaCongKhai, "kho")).toThrow(
      /thuật toán "NONE"/,
    );
  });

  it.each([
    ["RSA 2048", { type: "rsa" as const, opts: { modulusLength: 2048 } }],
    ["EC P-384", { type: "ec" as const, opts: { namedCurve: "secp384r1" } }],
    ["Ed25519", { type: "ed25519" as const, opts: {} }],
  ])("[INV-B3] khoá %s trong vòng khoá bị TỪ CHỐI, không âm thầm đổi thuật toán", (_ten, k) => {
    // `createVerify("sha256").verify(...)` chọn thuật toán theo LOẠI KHOÁ, không theo `alg` của
    // văn bản. Không có phép chốt loại khoá, một mốc neo ký bằng RSA sẽ "đạt" trong khi văn bản
    // vẫn khai `alg=ECDSA_P256_SHA256` — artefact nói sai về chính nó.
    //
    // MỐC CHẾT: gỡ khối chốt loại khoá trong `anchor-verify.ts` thì ca RSA và ca Ed25519 chuyển
    // từ "ném" sang "đạt" và test này ĐỎ.
    const { privateKey, publicKey } = generateKeyPairSync(k.type as "ec", {
      ...(k.opts as { namedCurve: string }),
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const text = buildAnchorText({ ...TRUONG, kid: "neo-la" });
    // Ed25519 không nhận thuật toán băm rời; `createSign` chỉ dùng được cho RSA/EC.
    const sig =
      k.type === "ed25519"
        ? Buffer.alloc(64)
        : createSign("sha256")
            .update(text, "utf8")
            .sign({ key: privateKey, format: "der", type: "pkcs8" });
    expect(() =>
      verifyAnchorRecord(
        { text, sig: sig.toString("base64") },
        new Map([["neo-la", publicKey]]),
        "kho",
      ),
    ).toThrow(/không phải EC P-256/);
  });

  describe("dấu đúc — đường đúc mốc neo bằng tay", () => {
    it("KHÔNG TYPECHECK: object literal thiếu dấu đúc", () => {
      // Đây là một phép đo Ở TẦNG BIÊN DỊCH, và `@ts-expect-error` là mốc chết của nó: nếu ngày
      // nào đó dấu đúc bị gỡ khỏi `ExternalAnchor` thì dòng dưới HẾT lỗi, và `tsc` sẽ đỏ vì một
      // `@ts-expect-error` không dùng tới. Không có cách nào để lớp này mục đi trong im lặng.
      //
      // Nguyên văn câu mà nó bác bỏ, từ `writer.ts` trước S1.17: "Người gọi vẫn tự tay đúc được
      // một neo giả (`{ ...xuat, source: "bịa" }`) — không lớp kiểu nào chặn được điều đó."
      // @ts-expect-error thiếu dấu đúc của verifyAnchorRecord — đây chính là điều được đo
      const gia: ExternalAnchor = { ...TRUONG, source: "bịa" };
      expect(laNeoDaKiemChuKy(gia)).toBe(false);
    });

    it("dấu đúc KHÔNG lấy lại được qua Symbol.for", () => {
      // `Symbol.for` đọc sổ đăng ký toàn cục. Nếu dấu đúc từng được tạo bằng nó thì bất kỳ ai
      // biết chuỗi khoá cũng đúc được mốc neo, và cả lớp này thành trang trí.
      const bo = taoBoKyNeoThuNghiem();
      const neo = verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho");
      const symbolCuaNeo = Object.getOwnPropertySymbols(neo);
      expect(symbolCuaNeo).toHaveLength(1);
      expect(Symbol.for(symbolCuaNeo[0]!.description!)).not.toBe(symbolCuaNeo[0]);
    });

    it.each([
      ["spread", (n: ExternalAnchor) => ({ ...n })],
      ["spread có sửa trường", (n: ExternalAnchor) => ({ ...n, seq: 3 })],
      ["Object.assign", (n: ExternalAnchor) => Object.assign({}, n)],
      ["Object.create", (n: ExternalAnchor) => Object.create(n) as ExternalAnchor],
      ["structuredClone", (n: ExternalAnchor) => structuredClone(n)],
    ])("[INV-B3] BẢN SAO qua %s KHÔNG mang được bằng chứng đã kiểm", (_ten, saoChep) => {
      // ==========================================================================================
      // [review lượt 9 — H9-2] ĐÂY LÀ CA MÀ BẢN ĐẦU CỦA VÒNG NÀY ĐỂ LỌT, và nó lọt vì bằng chứng
      // khi ấy là một thuộc tính own **enumerable** khoá bằng symbol:
      //
      //     const neoGia = { ...neo, seq: 3 };   // typecheck SẠCH, không cần một `as` nào
      //
      // Spread và `Object.assign` chép own enumerable symbol keys; `Object.create` cho đọc qua
      // prototype. Cả ba đường đều là MỘT DÒNG REFACTOR BÌNH THƯỜNG — đúng thứ "lọt vào một cách
      // TÌNH CỜ" mà lớp này sinh ra để chặn, chứ không phải một nỗ lực có chủ đích.
      //
      // MỐC CHẾT: đổi `laNeoDaKiemChuKy` về phép đọc thuộc tính (`neo[DAU_DUC] === true`) thì bốn
      // trong năm ca này ĐỎ (`structuredClone` bỏ khoá symbol nên nó vốn đã fail-closed).
      // ==========================================================================================
      const bo = taoBoKyNeoThuNghiem();
      const that = verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho");
      expect(laNeoDaKiemChuKy(that)).toBe(true);
      expect(laNeoDaKiemChuKy(saoChep(that))).toBe(false);
    });

    it("một mốc neo đi qua JSON MẤT dấu đúc — nó phải được kiểm lại", () => {
      // Vòng đời thật của một artefact là đi ra kho rồi quay về, tức luôn đi qua JSON. Test này
      // ghim rằng chuyến đi ấy KHÔNG mang theo kết luận "đã kiểm chữ ký".
      const bo = taoBoKyNeoThuNghiem();
      const neo = verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho");
      const quaJson = JSON.parse(JSON.stringify(neo)) as ExternalAnchor;
      expect(laNeoDaKiemChuKy(quaJson)).toBe(false);
    });
  });
});

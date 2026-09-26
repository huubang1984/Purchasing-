// Luật kiểm trước apply — trên biến dựng tay và một CongAws giả.
import { describe, expect, it } from "vitest";
import { inKetQua, kiemAws, kiemBien, laGiuCho, type BienStack90, type CongAws, type HangSo, type KetQua, type MoTaSecret } from "./luat.js";

const HANG: HangSo = { prod: "942091277863", region: "ap-southeast-1" };
const D = "a".repeat(64);
const ecr = (kho: string, digest = D): string => `942091277863.dkr.ecr.ap-southeast-1.amazonaws.com/${kho}@sha256:${digest}`;

const TOT: BienStack90 = {
  ten_mien: "app.thu-mua.vn",
  anh: {
    api: ecr("tp-api"),
    worker: ecr("tp-unseal-worker"),
    migrate: ecr("tp-migrate"),
    web: ecr("tp-web"),
    public_keys: ecr("tp-public-keys"),
    neo: ecr("tp-neo"),
  },
  so_ban_api: 1,
  so_ban_worker: 1,
  ses: { tu_api: "khong-tra-loi@thu-mua.vn", tu_canh_bao: "canh-bao@thu-mua.vn", nhan_canh_bao: ["van-hanh@thu-mua.vn"], configuration_set: "tp-thu" },
  sms: null,
  zalo: null,
  che_do_dns: "BLOCK",
  ses_endpoint_service: "email",
};

const muc = (kq: readonly KetQua[], m: KetQua["muc"]): string[] => kq.filter((k) => k.muc === m).map((k) => k.ma);

describe("kiemBien", () => {
  it("bộ biến đủ ⇒ không DO, không VANG", () => {
    const kq = kiemBien(TOT, HANG);
    expect(muc(kq, "DO")).toEqual([]);
    expect(muc(kq, "VANG")).toEqual([]);
  });

  it("mẫu prod.tfvars của APPLY-LAN-DAU 6.1 ⇒ DO cho sáu image và mọi chỗ <...>; VANG cho api, worker, DNS", () => {
    const tam = "tam@sha256:" + "0".repeat(64);
    const kq = kiemBien(
      {
        ...TOT,
        ten_mien: "<app.domain>",
        anh: { api: tam, worker: tam, migrate: tam, web: tam, public_keys: tam, neo: tam },
        ses: { tu_api: "<dia_chi_gui>@<domain>", tu_canh_bao: "<dia_chi_canh_bao>@<domain>", nhan_canh_bao: ["<email>"], configuration_set: "tp-thu" },
        so_ban_api: 0,
        so_ban_worker: 0,
        che_do_dns: "ALERT",
      },
      HANG,
    );
    expect(muc(kq, "DO")).toEqual([
      "anh.api",
      "anh.worker",
      "anh.migrate",
      "anh.web",
      "anh.public_keys",
      "anh.neo",
      "ten_mien",
      "ses.tu_api",
      "ses.tu_canh_bao",
      "ses.nhan_canh_bao",
    ]);
    expect(muc(kq, "VANG")).toEqual(["so_ban_api", "so_ban_worker", "che_do_dns"]);
  });

  it("image: digest toàn số 0, kho sai, tài khoản sai, region sai, thẻ thay digest ⇒ DO", () => {
    for (const uri of [
      ecr("tp-api", "0".repeat(64)),
      ecr("tp-web"),
      `111111111111.dkr.ecr.ap-southeast-1.amazonaws.com/tp-api@sha256:${D}`,
      `942091277863.dkr.ecr.us-east-1.amazonaws.com/tp-api@sha256:${D}`,
      "942091277863.dkr.ecr.ap-southeast-1.amazonaws.com/tp-api:abc123",
      ecr("tp-api", "A".repeat(64)),
    ]) {
      expect(muc(kiemBien({ ...TOT, anh: { ...TOT.anh, api: uri } }, HANG), "DO"), uri).toEqual(["anh.api"]);
    }
  });

  it("sms và zalo: giữ chỗ ⇒ DO; giá trị thật ⇒ không", () => {
    expect(muc(kiemBien({ ...TOT, sms: { danh_tinh_gui: "<BRANDNAME>", configuration_set: null } }, HANG), "DO")).toEqual(["sms.danh_tinh_gui"]);
    expect(muc(kiemBien({ ...TOT, zalo: { template_otp: "...", template_invitation: "412233", template_deadline: "" } }, HANG), "DO")).toEqual(["zalo"]);
    expect(muc(kiemBien({ ...TOT, sms: { danh_tinh_gui: "THUMUA", configuration_set: "tp-sms" }, zalo: { template_otp: "1", template_invitation: "2", template_deadline: "3" } }, HANG), "DO")).toEqual([]);
  });

  it("ses: người nhận rỗng, địa chỉ sai dạng ⇒ DO; endpoint SES rỗng ⇒ VANG", () => {
    expect(muc(kiemBien({ ...TOT, ses: { ...TOT.ses, nhan_canh_bao: [] } }, HANG), "DO")).toEqual(["ses.nhan_canh_bao"]);
    expect(muc(kiemBien({ ...TOT, ses: { ...TOT.ses, tu_api: "khong-co-a-cong" } }, HANG), "DO")).toEqual(["ses.tu_api"]);
    expect(muc(kiemBien({ ...TOT, ses_endpoint_service: "" }, HANG), "VANG")).toEqual(["ses_endpoint_service"]);
  });

  it("laGiuCho: <...>, ba chấm, domain ví dụ RFC 2606", () => {
    for (const g of ["<email>", "a...b", "x…", "a@example.com", "example.org", "app.example.net"]) expect(laGiuCho(g), g).toBe(true);
    for (const t of ["app.thu-mua.vn", "a@thu-mua.vn", "notexample.com", "example.com.vn"]) expect(laGiuCho(t), t).toBe(false);
  });
});

function awsGia(ghiDe: Partial<{ taiKhoan: string; secret: Record<string, MoTaSecret | null>; image: string[]; ses: Record<string, boolean | null>; sandbox: boolean }> = {}): CongAws & { goi: string[] } {
  const goi: string[] = [];
  return {
    goi,
    taiKhoan: () => Promise.resolve(ghiDe.taiKhoan ?? HANG.prod),
    moTaSecret: (ten) => {
      goi.push(`secret ${ten}`);
      const v = ghiDe.secret?.[ten];
      return Promise.resolve(v === undefined ? { coBanHienHanh: true, daXoa: false } : v);
    },
    coImage: (kho, digest) => {
      goi.push(`ecr ${kho} ${digest}`);
      return Promise.resolve(!(ghiDe.image ?? []).includes(kho));
    },
    danhTinhSes: (mien) => {
      goi.push(`ses ${mien}`);
      const v = ghiDe.ses?.[mien];
      return Promise.resolve(v === null ? null : { daXacMinh: v ?? true });
    },
    sesDaRaSandbox: () => Promise.resolve(ghiDe.sandbox ?? true),
  };
}

describe("kiemAws", () => {
  it("mọi thứ có ⇒ không DO; hỏi đúng bốn secret, sáu image theo digest, một miền SES", async () => {
    const aws = awsGia();
    const kq = await kiemAws(TOT, HANG, aws);
    expect(muc(kq, "DO")).toEqual([]);
    expect(aws.goi).toEqual([
      "secret tp/api/database-url",
      "secret tp/api/otp-peppers",
      "secret tp/worker/database-url",
      "secret tp/neo/database-url",
      "ecr tp-api sha256:" + D,
      "ecr tp-unseal-worker sha256:" + D,
      "ecr tp-migrate sha256:" + D,
      "ecr tp-web sha256:" + D,
      "ecr tp-public-keys sha256:" + D,
      "ecr tp-neo sha256:" + D,
      "ses thu-mua.vn",
    ]);
  });

  it("sai tài khoản ⇒ một DO duy nhất, không hỏi gì thêm", async () => {
    const aws = awsGia({ taiKhoan: "528657840905" });
    const kq = await kiemAws(TOT, HANG, aws);
    expect(kq.map((k) => `${k.muc} ${k.ma}`)).toEqual(["DO aws.tai_khoan"]);
    expect(aws.goi).toEqual([]);
  });

  it("secret thiếu, rỗng, chờ xoá; image thiếu; SES chưa xác minh / không có; còn sandbox", async () => {
    const kq = await kiemAws({ ...TOT, ses: { ...TOT.ses, tu_canh_bao: "canh-bao@khac.vn" } }, HANG, awsGia({
      secret: {
        "tp/api/database-url": null,
        "tp/api/otp-peppers": { coBanHienHanh: false, daXoa: false },
        "tp/neo/database-url": { coBanHienHanh: true, daXoa: true },
      },
      image: ["tp-web"],
      ses: { "thu-mua.vn": false, "khac.vn": null },
      sandbox: false,
    }));
    expect(muc(kq, "DO")).toEqual([
      "secret tp/api/database-url",
      "secret tp/api/otp-peppers",
      "secret tp/neo/database-url",
      "ecr tp-web",
      "ses thu-mua.vn",
      "ses khac.vn",
    ]);
    expect(muc(kq, "VANG")).toEqual(["ses.sandbox"]);
  });

  it("zalo bật ⇒ hỏi thêm secret tp/api/zalo-oa; image sai dạng ⇒ không hỏi ECR cho nó", async () => {
    const aws = awsGia();
    await kiemAws({ ...TOT, zalo: { template_otp: "1", template_invitation: "2", template_deadline: "3" }, anh: { ...TOT.anh, neo: "tam@sha256:" + "0".repeat(64) } }, HANG, aws);
    expect(aws.goi).toContain("secret tp/api/zalo-oa");
    expect(aws.goi.some((g) => g.startsWith("ecr tp-neo"))).toBe(false);
  });
});

describe("inKetQua", () => {
  it("dòng tổng đếm DO và VANG", () => {
    const { dong, soDo, soVang } = inKetQua([
      { muc: "DO", ma: "a", noiDung: "x" },
      { muc: "VANG", ma: "b", noiDung: "y" },
      { muc: "XANH", ma: "c", noiDung: "z" },
    ]);
    expect([soDo, soVang]).toEqual([1, 1]);
    expect(dong).toEqual(["[DO]   a: x", "[VANG] b: y", "[XANH] c: z", "kiem-truoc-apply: 1 do, 1 vang"]);
  });
});

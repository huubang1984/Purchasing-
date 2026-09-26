// [ADR-069] Định tuyến theo kênh và chuẩn hoá số điện thoại — đo bằng bộ gửi GHI LẠI.
import { describe, expect, it } from "vitest";
import type { HopThuDev } from "./hop-thu-dev.js";
import { GuiKenhError, chuanHoaE164, taoBoGuiTheoKenh, type BoGuiKenhSo } from "./kenh-so.js";

type Lan = readonly [string, string, string];

function kenhGhi(ten: string, so: Lan[]): BoGuiKenhSo {
  return {
    name: ten,
    guiOtp: (s, m) => Promise.resolve(void so.push([`${ten}:otp`, s, m])),
    guiLoiMoi: (s, d) => Promise.resolve(void so.push([`${ten}:moi`, s, d])),
    guiGiaHan: (s, h) => Promise.resolve(void so.push([`${ten}:han`, s, h])),
  };
}

function emailGhi(so: Lan[]): HopThuDev {
  const ghi = (loai: string) => (m: object): Promise<void> => Promise.resolve(void so.push([`email:${loai}`, JSON.stringify(m), ""]));
  return {
    loginLinkSender: { name: "e", send: ghi("login") },
    approvalNoticeSender: { name: "e", send: ghi("duyet") },
    invitationLinkSender: { name: "e", send: ghi("moi") },
    otpSender: { name: "e", send: ghi("otp") },
    deadlineNoticeSender: { name: "e", send: ghi("han") },
  };
}

const BASE = "https://app.vidu.vn";
const ORG = "11111111-1111-4111-8111-111111111111";

describe("[ADR-069] chuanHoaE164", () => {
  it("+84 giữ nguyên, 0… là số Việt Nam, 84… thêm dấu +", () => {
    expect(chuanHoaE164("+84901234567")).toBe("+84901234567");
    expect(chuanHoaE164("0901234567")).toBe("+84901234567");
    expect(chuanHoaE164("84901234567")).toBe("+84901234567");
  });

  it("không phải số ⇒ ném, thông điệp không mang số", () => {
    for (const x of ["", "090 123 4567", "+0901234567", "abc", "00"]) {
      expect(() => chuanHoaE164(x), x).toThrow(GuiKenhError);
    }
    try {
      chuanHoaE164("09x1234567");
    } catch (e) {
      expect((e as Error).message).not.toContain("09x1234567");
    }
  });
});

describe("[ADR-069] taoBoGuiTheoKenh", () => {
  it("EMAIL về bộ gửi thư; SMS/ZALO_ZNS về đúng kênh với số E.164 và link /i#", async () => {
    const so: Lan[] = [];
    const g = taoBoGuiTheoKenh({ email: emailGhi(so), sms: kenhGhi("sms", so), zalo: kenhGhi("zalo", so), baseUrl: BASE });
    await g.invitationLinkSender.send({ orgId: ORG, invitationId: "i1", channel: "EMAIL", destination: "a@vidu.vn", token: "t0" });
    await g.invitationLinkSender.send({ orgId: ORG, invitationId: "i1", channel: "SMS", destination: "0901234567", token: "t1" });
    await g.otpSender.send({ channel: "ZALO_ZNS", destination: "84901234567", code: "123456" });
    await g.deadlineNoticeSender.send({ orgId: ORG, invitationId: "i1", channel: "SMS", destination: "+84901234567", newDeadlineAt: "2026-10-01T10:00:00Z" });
    await g.loginLinkSender.send({ orgId: ORG, email: "b@vidu.vn", token: "t2" });
    expect(so.map((l) => l[0])).toEqual(["email:moi", "sms:moi", "zalo:otp", "sms:han", "email:login"]);
    expect(so[1]).toEqual(["sms:moi", "+84901234567", `${BASE}/i#t1`]);
    expect(so[2]).toEqual(["zalo:otp", "+84901234567", "123456"]);
    expect(so[3]).toEqual(["sms:han", "+84901234567", "2026-10-01T10:00:00Z"]);
  });

  it("kênh chưa bật ⇒ NÉM, không rơi về email và không gửi gì", async () => {
    const so: Lan[] = [];
    const g = taoBoGuiTheoKenh({ email: emailGhi(so), baseUrl: BASE });
    await expect(g.otpSender.send({ channel: "SMS", destination: "0901234567", code: "1" })).rejects.toThrow(/SMS.*ADR-069/u);
    await expect(
      g.invitationLinkSender.send({ orgId: ORG, invitationId: "i", channel: "ZALO_ZNS", destination: "0901234567", token: "t" }),
    ).rejects.toThrow(GuiKenhError);
    expect(so).toHaveLength(0);
  });
});

// ==============================================================================================
// tools/canh-dang-ky/src/canh-dang-ky.ts — [ADR-089] MỖI ĐỊA CHỈ NHẬN CẢNH BÁO PHẢI CÓ MỘT ĐĂNG KÝ ĐÃ XÁC NHẬN
//
// Lambda `tp-canh-dang-ky` (stack 60, tài khoản audit) chạy mỗi 6 giờ, CHỈ ĐỌC hai topic cảnh báo
// (`tp-canh-bao-khoa`, `tp-canh-bao-van-hanh`) và đối chiếu với danh sách Terraform khai (`email_canh_bao`,
// `email_van_hanh`). Ba cách hỏng, cả ba đều IM trước ADR này:
//   • chờ xác nhận — người nhận chưa bấm liên kết trong thư AWS gửi, nên chưa nhận gì;
//   • không có     — SNS tự xoá đăng ký không được xác nhận kịp hạn, hay người nhận bấm "unsubscribe";
//   • lạ           — một đăng ký KHÔNG có trong danh sách (ai đó thêm người nhận ngoài Terraform).
// Mỗi ca in MỘT dòng mang `DANG KY HONG`; metric filter của stack 60 đếm dòng ấy, alarm gửi thư tới CẢ HAI topic — hộp
// nào hỏng thì hộp kia vẫn nhận.
//
// Log không in địa chỉ: chỉ tên biến và vị trí (`email_van_hanh[1]`) — đủ để người vận hành tìm, không đưa danh sách
// người nhận vào log. Đăng ký lạ chỉ in giao thức.
//
// Tệp này là NGUỒN; thứ chạy trên Lambda là `lambda/canh-dang-ky.mjs` = chính tệp này gỡ kiểu
// (`pnpm canh-dang-ky:dong-goi-lambda`). `canh-dang-ky.test.ts` đòi hai tệp trùng byte. `@aws-sdk/client-sns` có sẵn
// trong runtime Node.js của Lambda — không đóng gói node_modules.
// ==============================================================================================

import { ListSubscriptionsByTopicCommand, SNSClient,                                            } from "@aws-sdk/client-sns";

                            
                                                                                              
 

/** Một topic và danh sách người nhận Terraform khai cho nó. */
                          
                         
                        
                                   
 

                         
                            
                        
                                                                      
                              
 

                  
                                                                                                 
                                                       

                              
                         
                             
                                 
 

export async function lietKeDangKy(sns           , topic        )                    {
  const ra           = [];
  let tiep                    ;
  do {
    const trang = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topic, NextToken: tiep }));
    for (const d of trang.Subscriptions ?? []) {
      ra.push({
        giaoThuc: d.Protocol ?? "",
        diem: d.Endpoint ?? "",
        daXacNhan: (d.SubscriptionArn ?? "").startsWith("arn:"),
      });
    }
    tiep = trang.NextToken;
  } while (tiep !== undefined && tiep !== "");
  return ra;
}

/** Địa chỉ thư so không phân biệt hoa thường — SNS giữ nguyên chữ người khai, người nhận gõ sao cũng được. */
const cungDiaChi = (a        , b        )          => a.trim().toLowerCase() === b.trim().toLowerCase();

export function doiChieu(mongDoi         , dangKy                   )              {
  const hong         = [];
  const email = dangKy.filter((d) => d.giaoThuc === "email");
  mongDoi.nhan.forEach((dc, viTri) => {
    const cua = email.filter((d) => cungDiaChi(d.diem, dc));
    if (cua.some((d) => d.daXacNhan)) return;
    hong.push({ loai: cua.length > 0 ? "cho xac nhan" : "khong co", bien: mongDoi.bien, viTri });
  });
  for (const d of dangKy) {
    if (d.giaoThuc !== "email" || !mongDoi.nhan.some((dc) => cungDiaChi(d.diem, dc))) hong.push({ loai: "la", giaoThuc: d.giaoThuc });
  }
  return { topic: mongDoi.topic, soMongDoi: mongDoi.nhan.length, hong };
}

const tenTopic = (arn        )         => arn.slice(arn.lastIndexOf(":") + 1);

/** Các dòng log — hợp đồng với metric filter của stack 60 (`hinh-dang-canh-dang-ky.test.ts` so hai phía). */
export function dongLog(ketQua                        )           {
  const dong           = [];
  for (const k of ketQua) {
    for (const h of k.hong) {
      dong.push(
        h.loai === "la"
          ? `canh-dang-ky: ${tenTopic(k.topic)} DANG KY HONG: la (giao thuc ${h.giaoThuc})`
          : `canh-dang-ky: ${tenTopic(k.topic)} ${h.bien}[${String(h.viTri)}] DANG KY HONG: ${h.loai}`,
      );
    }
  }
  const soDiaChi = ketQua.reduce((n, k) => n + k.soMongDoi, 0);
  const soHong = ketQua.reduce((n, k) => n + k.hong.length, 0);
  dong.push(`canh-dang-ky: ${String(ketQua.length)} topic, ${String(soDiaChi)} dia chi, ${String(soHong)} hong`);
  return dong;
}

/** `MONG_DOI` = JSON `[{ topic, bien, nhan: [...] }, …]`, do Terraform ghi. Sai dạng ⇒ ném: phép canh không đoán. */
export function docMongDoi(giaTri                    )            {
  if (giaTri === undefined || giaTri === "") throw new Error("thieu MONG_DOI");
  const ra          = JSON.parse(giaTri);
  if (!Array.isArray(ra) || ra.length === 0) throw new Error("MONG_DOI phai la danh sach khong rong");
  return ra.map((m         ) => {
    if (typeof m !== "object" || m === null) throw new Error("MONG_DOI: phan tu khong phai doi tuong");
    const { topic, bien, nhan } = m                           ;
    if (typeof topic !== "string" || !topic.startsWith("arn:aws:sns:")) throw new Error("MONG_DOI: topic khong phai ARN SNS");
    if (typeof bien !== "string" || bien === "") throw new Error("MONG_DOI: thieu bien");
    if (!Array.isArray(nhan) || nhan.length === 0 || !nhan.every((x) => typeof x === "string" && x.includes("@")))
      throw new Error("MONG_DOI: nhan phai la danh sach dia chi");
    return { topic, bien, nhan: nhan             };
  });
}

export async function kiemDangKy(sns           , mongDoi                    )                         {
  const ra                = [];
  for (const m of mongDoi) ra.push(doiChieu(m, await lietKeDangKy(sns, m.topic)));
  return ra;
}

/** Điểm vào Lambda. Lỗi thì NÉM — số lần lỗi có alarm riêng ở stack 60; nuốt lỗi là một phép canh câm. */
export async function handler()                                            {
  const mongDoi = docMongDoi(process.env["MONG_DOI"]);
  const ketQua = await kiemDangKy(new SNSClient({}), mongDoi);
  for (const d of dongLog(ketQua)) console.log(d);
  return { diaChi: ketQua.reduce((n, k) => n + k.soMongDoi, 0), hong: ketQua.reduce((n, k) => n + k.hong.length, 0) };
}

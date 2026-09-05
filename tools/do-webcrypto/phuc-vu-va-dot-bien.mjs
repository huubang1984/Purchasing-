// Server do dot bien cho trang do. ?dot=<ten> chen mot script CHAN mot kha nang
// truoc khi script chinh chay, de xem trang do co PHAT HIEN duoc khong.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

// [khoan no 20] Duong dan nay TUNG SAI: no doc "./do-webcrypto.html", mot ten khong con ton tai
// (trang do da doi ten thanh index.html). Server dot bien nem ENOENT ngay dong dau va KHONG AI
// BIET, vi `tsc` khong nhin thay duong dan dang chuoi va khong test nao goi toi file .mjs nay.
// Lop canh moi o tests/architecture/bao-dam-mot-he-dieu-hanh.test.ts tim ra no ngay lan chay dau.
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

const DOT = {
  // Chan CA HAI cach khai bao X25519. P-256 van chay.
  x25519: `
    const g = crypto.subtle.generateKey.bind(crypto.subtle);
    crypto.subtle.generateKey = function (a) {
      const ten = a && (a.name === "X25519" ? "X25519" : (a.namedCurve === "X25519" ? "X25519" : null));
      if (ten) return Promise.reject(new Error("DOT BIEN: X25519 bi chan"));
      return g.apply(crypto.subtle, arguments);
    };`,
  // AES giai ma ra byte sai -> roundtrip khong khop.
  aes: `
    const d = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async function () {
      await d.apply(crypto.subtle, arguments);
      return new Uint8Array([9, 9, 9]).buffer;
    };`,
  // Nguon ngau nhien tra toan so 0 -> dieu kien tien quyet gay.
  rnd: `
    crypto.getRandomValues = function (b) { b.fill(0); return b; };`,
};

createServer((req, res) => {
  const ten = new URL(req.url, "http://x").searchParams.get("dot");
  const chen = DOT[ten] ? `<script>${DOT[ten]}</script>\n` : "";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(chen + html);
}).listen(8732, () => console.log("san sang tren 8732"));

// Ham dung chung de dung regex KHONG PHAN BIET HOA THUONG bang character-class thu cong,
// dung cho ca ".dependency-cruiser.cjs" (rule that) va test don vi thuc (kiem chung ham
// thuan tuy, khong qua depcruise). Tach rieng file nay (thay vi dinh nghia thang trong
// .dependency-cruiser.cjs) vi depcruise clone toan bo config object bang structuredClone()
// va validate no bang AJV schema co "additionalProperties: false" o cap goc - gan them
// property la ham (vd. de test) vao module.exports cua .dependency-cruiser.cjs se lam
// depcruise bao loi "could not be cloned" hoac loi schema. File .cjs rieng nay khong bi
// rang buoc do vi khong bao gio duoc depcruise doc truc tiep.
//
// LY DO CAN KHONG PHAN BIET HOA THUONG: depcruise tu choi nhan RegExp object cho path/pathNot
// (schema chi cho string hoac string[]) va khong co option "caseSensitive" o muc rule. Nhung
// tren Windows/macOS, he thong file resolve KHONG phan biet hoa thuong, va truong "resolved"
// cua depcruise GIU NGUYEN hoa thuong nguoi viet go trong specifier (khong chuan hoa ve ten
// that tren dia). Mot file .mjs/.cjs import "Local-Dev-Shared.ts" (sai hoa thuong) van resolve
// thanh cong tren Windows, nhung regex phan biet hoa thuong khop "local-dev-shared.ts" se
// KHONG khop voi "Local-Dev-Shared.ts" - hang rao im lang bo qua. Day la CUNG MOT LOP LOI
// da lam thung hook o Task 1 (.ENV, ID_RSA) - tai dien o tang depcruise (fix round 2, N1).

// Fix round 3 (N6): danh sach day du ky tu dac biet cua regex phai duoc ESCAPE TRUOC nhanh
// chu cai. Ban fix round 2 chi escape rieng dau "." roi moi kiem tra chu cai, nen 11 ky tu
// dac biet con lai (| + * ? ^ $ { } ( ) [ ] \) di qua NGUYEN VAN neu chung xuat hien trong
// literal - bien mot ky tu literal thanh cu phap regex that (vd. "|" thanh phep hoac, "["
// thanh mo character class), LAM NOI RONG quy tac thay vi siet no lai. Day la loai loi te
// nhat cho mot ham sinh regex bao ve ranh gioi bao mat: no lam hang rao im lang, khong lam
// CI do.
const REGEX_SPECIAL_CHARS = new RegExp("[.*+?^${}()|[\\]\\\\]");

function ciChar(pKyTu) {
  if (REGEX_SPECIAL_CHARS.test(pKyTu)) {
    return "\\" + pKyTu;
  }
  if (/[a-zA-Z]/.test(pKyTu)) {
    const chuThuong = pKyTu.toLowerCase();
    const chuHoa = pKyTu.toUpperCase();
    return chuThuong === chuHoa ? pKyTu : "[" + chuThuong + chuHoa + "]";
  }
  return pKyTu;
}

/** Chuyen mot chuoi literal (duong dan) thanh fragment regex khop moi cach viet hoa/thuong. */
function ci(pLiteral) {
  return pLiteral.split("").map(ciChar).join("");
}

/** Fragment regex khop chinh xac MOT file, bat ky hoa thuong. */
function ciFile(pLiteralPath) {
  return "^" + ci(pLiteralPath) + "$";
}

/** Fragment regex khop MOT tien to thu muc, bat ky hoa thuong (khong neo cuoi chuoi). */
function ciPrefix(pLiteralPrefix) {
  return "^" + ci(pLiteralPrefix);
}

// Fix round 4: `unCi()` la phep NGHICH DAO cua `ci()`. No ton tai de mot test BAT BIEN co the
// quet chinh cau hinh depcruise: doc `from.pathNot` cua moi quy tac ho "g1-", giai ma nguoc ra
// duong dan literal, roi doi chieu xem module duoc mien tru do co dong thoi la DICH HAN CHE cua
// mot quy tac "g1-" nao khong. Khong co phep nghich dao nay, test bat bien buoc phai liet ke tay
// tung module - dung cai co che "nho ma lam" da lam sot local-dev-wrapper.ts qua ba vong fix.
//
// Cach dung an toan: LUON kiem chung round-trip `ci(unCi(x)) === x` truoc khi tin ket qua. Neu
// mot ai do viet regex tay (khong qua ci/ciFile/ciPrefix) vao `from.pathNot` cua quy tac "g1-",
// round-trip se sai va test bat bien do - dung y do: quy tac ho "g1-" chi duoc dung ham sinh.
function unCi(pFragment) {
  let ketQua = "";
  let viTri = 0;
  while (viTri < pFragment.length) {
    const kyTu = pFragment[viTri];
    // Nhanh chu cai do ciChar() sinh ra: "[aA]" (dung 4 ky tu, cap thuong/hoa cua cung chu).
    if (kyTu === "[" && pFragment[viTri + 3] === "]") {
      const chuThuong = pFragment[viTri + 1];
      const chuHoa = pFragment[viTri + 2];
      if (
        chuThuong !== chuHoa &&
        chuThuong === chuHoa.toLowerCase() &&
        chuHoa === chuThuong.toUpperCase()
      ) {
        ketQua += chuThuong;
        viTri += 4;
        continue;
      }
    }
    // Nhanh escape do ciChar() sinh ra: "\<metachar>".
    if (kyTu === "\\" && viTri + 1 < pFragment.length) {
      ketQua += pFragment[viTri + 1];
      viTri += 2;
      continue;
    }
    ketQua += kyTu;
    viTri += 1;
  }
  return ketQua;
}

module.exports = { ciChar, ci, ciFile, ciPrefix, unCi };

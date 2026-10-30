// 合言葉（デモ用のかんたんな入場チェック）
// ※ サーバー側からだけ使うこと。ブラウザ側で読み込まない
//
// しくみ：
// - 合言葉は .env.local の DEMO_PASSCODE に書く
// - 正しい合言葉を送った人には、cookie に「合格の印」を渡す
// - 印は、合言葉を鍵にした HMAC（偽造できない印）なので、合言葉そのものは cookie に入らない
// - 合言葉を変えると、古い印は自動で使えなくなる

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// 合格の印を入れる cookie の名前
export const AUTH_COOKIE_NAME = "iudake_auth";

// 印の有効期間（7日）
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// .env.local から合言葉を読み込む（設定がなければ、だれも入れない）
function getPasscode(): string | undefined {
  const passcode = process.env.DEMO_PASSCODE;
  return passcode ? passcode : undefined;
}

// 2つの文字が同じかを、かかる時間を一定にして比べる
// ※ ふつうの === は、違う文字が見つかった時点で止まるので、
//   かかった時間から合言葉を推測される可能性がある
function safeEqual(a: string, b: string): boolean {
  // 長さをそろえるために、両方を同じ長さのハッシュに変換してから比べる
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// 入力された合言葉が正しいか
export function isValidPasscode(input: string): boolean {
  const passcode = getPasscode();
  if (!passcode) return false;
  return safeEqual(input, passcode);
}

// 合格の印を作る
export function createAuthToken(): string {
  const passcode = getPasscode();
  if (!passcode) {
    throw new Error("DEMO_PASSCODE が設定されていません。.env.local を確認してください。");
  }
  return createHmac("sha256", passcode).update("iudake-demo-auth").digest("hex");
}

// cookie に入っていた印が正しいか
export function isValidAuthToken(token: string | undefined): boolean {
  if (!token || !getPasscode()) return false;
  return safeEqual(token, createAuthToken());
}

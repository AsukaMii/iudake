import type { Metadata, Viewport } from "next";
import { Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

// フォント：Zen Kaku Gothic New（やわらかく読みやすいゴシック体）
// 日本語の文字は、必要な分だけ自動で読み込まれる
const zenKakuGothicNew = Zen_Kaku_Gothic_New({
  weight: ["400", "700"], // 通常と太字
  subsets: ["latin"],
  display: "swap", // フォントの読み込み中も文字を表示する
});

export const metadata: Metadata = {
  title: "イウダケ｜言うだけで、サイト更新",
  description:
    "話しかけたり入力したりするだけで、WordPressサイトを更新できるアシスタント（デモ）",
};

// スマホでの表示設定（ブラウザのバーの色を藍色にする）
export const viewport: Viewport = {
  themeColor: "#2f4fb5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={zenKakuGothicNew.className}>
      <body>{children}</body>
    </html>
  );
}

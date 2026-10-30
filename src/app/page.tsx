// トップページ：イウダケの見出しとチャット画面を表示する
// 合言葉の「合格の印」（cookie）がなければ、チャットの代わりに合言葉の入力画面を出す

import { cookies } from "next/headers";
import { Suspense } from "react";
import { Chat } from "@/components/Chat";
import { PasscodeForm } from "@/components/PasscodeForm";
import { AUTH_COOKIE_NAME, isValidAuthToken } from "@/lib/auth";
import styles from "./page.module.css";

// cookie を見て、チャットか合言葉の画面かを出し分ける
// ※ cookie はアクセスのたびに変わるので、下の <Suspense> の中で読む
async function ChatGate() {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  return isValidAuthToken(token) ? <Chat /> : <PasscodeForm />;
}

export default function Home() {
  return (
    <div className={styles.page}>
      {/* 上部：サービス名とデモの表示 */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.logo}>
            イウダケ
            <span className={styles.badge}>デモ版</span>
          </h1>
          <p className={styles.tagline}>言うだけで、サイト更新</p>
        </div>
      </header>

      {/* チャット画面（読み込み中は短い案内を出す） */}
      <main className={styles.main}>
        <Suspense fallback={<p>読み込んでいます…</p>}>
          <ChatGate />
        </Suspense>
      </main>
    </div>
  );
}

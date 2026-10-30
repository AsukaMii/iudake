// トップページ：イウダケの見出しとチャット画面を表示する

import { Chat } from "@/components/Chat";
import styles from "./page.module.css";

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

      {/* チャット画面 */}
      <main className={styles.main}>
        <Chat />
      </main>
    </div>
  );
}

"use client";

// 合言葉の入力画面
// 正しい合言葉を送ると、サーバーが cookie に「合格の印」を入れるので、
// 画面を読み込み直して（router.refresh）チャット画面に切り替える

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./PasscodeForm.module.css";

export function PasscodeForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (passcode.trim() === "" || isSending) return;

    setIsSending(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      if (res.ok) {
        router.refresh(); // サーバー側でもう一度チェックして、チャット画面を出す
        return;
      }
      const data = await res.json().catch(() => null);
      setErrorMessage(data?.error ?? "うまくいきませんでした。もう一度お試しください。");
    } catch {
      setErrorMessage("通信がうまくいきませんでした。もう一度お試しください。");
    }
    setIsSending(false);
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.lead}>
        このページは、ポートフォリオ用のデモです。
        <br />
        お知らせしている合言葉を入力してください。
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor="passcode" className={styles.label}>
          合言葉
        </label>
        <input
          id="passcode"
          type="password"
          className={styles.input}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoComplete="off"
          aria-invalid={errorMessage !== ""}
          aria-describedby="passcode-error"
          required
        />
        <p id="passcode-error" className={styles.error} role="alert">
          {errorMessage}
        </p>
        <button
          type="submit"
          className={styles.button}
          disabled={passcode.trim() === "" || isSending}
        >
          {isSending ? "確認しています…" : "はじめる"}
        </button>
      </form>
    </div>
  );
}

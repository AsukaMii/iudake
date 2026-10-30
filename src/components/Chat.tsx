"use client";

// チャット画面の本体
// useChat で /api/chat とやり取りし、会話を表示する

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./Chat.module.css";

// サーバー側（route.ts）と同じ上限。送る前に画面でも知らせる
const MAX_INPUT_CHARS = 500;

// 話しかけ方の例（ボタンを押すと、そのまま送信される）
const EXAMPLES = [
  "お知らせの一覧を見せて",
  "固定ページの一覧を見せて",
  "お知らせを追加したい",
];

// ツールを使っている間に表示する、わかりやすい説明
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  listPosts: {
    running: "お知らせの一覧を確認しています…",
    done: "お知らせの一覧を確認しました",
  },
  listPages: {
    running: "固定ページの一覧を確認しています…",
    done: "固定ページの一覧を確認しました",
  },
  createDraftPost: {
    running: "お知らせの下書きを作成しています…",
    done: "お知らせの下書きを作成しました（まだ公開されていません）",
  },
  publishPost: {
    running: "お知らせを公開しています…",
    done: "お知らせをサイトに公開しました",
  },
};

// 承認で「いいえ」を選んだときに表示する説明
const DENIED_LABELS: Record<string, string> = {
  createDraftPost: "作成をやめました",
  publishPost: "公開しませんでした（下書きのまま残っています）",
};

// エラーの文面を取り出す
// サーバーは { error: "..." } の形で返すので、読み取れたらその文面を使う
function toErrorMessage(error: Error): string {
  try {
    const data = JSON.parse(error.message);
    if (typeof data.error === "string") return data.error;
  } catch {
    // JSONでなければ、下の共通メッセージを使う
  }
  return "うまくいきませんでした。少し待ってから、もう一度お試しください。";
}

// 承認ボタンを押したときに呼ぶ関数の形（useChat の addToolApprovalResponse）
type ApprovalResponder = (response: { id: string; approved: boolean }) => void;

// createDraftPost に渡される内容（タイトルと本文）
type DraftPostInput = { title: string; content: string };

// publishPost に渡される内容（投稿IDとタイトル）
type PublishPostInput = { id: number; title: string };

// publishPost の結果のうち、画面で使うもの（公開ページのURL）
type PublishPostOutput = { link: string };

// 1つのメッセージの中身（文章・ツールの状態）を表示する
function MessageParts({
  message,
  onApprovalResponse,
}: {
  message: UIMessage;
  onApprovalResponse: ApprovalResponder;
}) {
  return (
    <>
      {message.parts.map((part, index) => {
        // 文章
        if (part.type === "text") {
          return (
            <p key={index} className={styles.text}>
              {part.text}
            </p>
          );
        }

        // ツールの呼び出し（part.type は "tool-listPosts" のような形）
        if (part.type.startsWith("tool-") && "state" in part) {
          const name = part.type.slice("tool-".length);
          const label = TOOL_LABELS[name];
          if (!label) return null;

          // 承認待ち：内容のプレビューと「はい／いいえ」ボタンを出す
          if (part.state === "approval-requested" && name === "createDraftPost") {
            const input = part.input as DraftPostInput;
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>
                  この内容で、お知らせの下書きを作りますか？
                </p>
                <dl className={styles.preview}>
                  <dt>タイトル</dt>
                  <dd>{input.title}</dd>
                  <dt>本文</dt>
                  <dd className={styles.previewBody}>{input.content}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  ※ 下書きとして保存されます。サイトにはまだ公開されません。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    下書きを作る
                  </button>
                  <button
                    type="button"
                    className={styles.deny}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: false })
                    }
                  >
                    いいえ
                  </button>
                </div>
              </div>
            );
          }

          // 公開の承認待ち：タイトルと注意書き、「公開する／いいえ」ボタンを出す
          if (part.state === "approval-requested" && name === "publishPost") {
            const input = part.input as PublishPostInput;
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>
                  このお知らせを、サイトに公開しますか？
                </p>
                <dl className={styles.preview}>
                  <dt>タイトル</dt>
                  <dd>{input.title}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  ※ 公開すると、サイトを見た人だれでも読めるようになります。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    公開する
                  </button>
                  <button
                    type="button"
                    className={styles.deny}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: false })
                    }
                  >
                    いいえ
                  </button>
                </div>
              </div>
            );
          }

          // 「いいえ」を選んだとき
          if (part.state === "output-denied") {
            return (
              <p key={index} className={styles.tool}>
                {DENIED_LABELS[name] ?? "やめました"}
              </p>
            );
          }

          // 公開できたとき：公開ページへのリンクも出す
          if (part.state === "output-available" && name === "publishPost") {
            const output = part.output as PublishPostOutput;
            return (
              <p key={index} className={`${styles.tool} ${styles.toolDone}`}>
                ✓ {label.done}{" "}
                <a
                  href={output.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.link}
                >
                  サイトで見る（新しいタブで開きます）
                </a>
              </p>
            );
          }

          if (part.state === "output-error") {
            return (
              <p key={index} className={`${styles.tool} ${styles.toolError}`}>
                うまくいきませんでした（WordPressにつながらない可能性があります）
              </p>
            );
          }
          const done = part.state === "output-available";
          return (
            <p key={index} className={`${styles.tool} ${done ? styles.toolDone : ""}`}>
              {done ? "✓ " : ""}
              {done ? label.done : label.running}
            </p>
          );
        }

        return null;
      })}
    </>
  );
}

export function Chat() {
  const { messages, sendMessage, status, error, clearError, addToolApprovalResponse } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
      // 「はい／いいえ」を押したら、自動でサーバーに送って会話を続ける
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });
  const [input, setInput] = useState("");

  // 新しいメッセージが来たら、いちばん下まで自動でスクロールする
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";
  const tooLong = input.length > MAX_INPUT_CHARS;
  const canSend = input.trim() !== "" && !tooLong && !isBusy;

  // メッセージを送る（入力欄・例のボタンの両方から使う）
  function send(text: string) {
    if (error) clearError(); // 前のエラー表示を消してから送る
    sendMessage({ text });
    setInput("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSend) send(input.trim());
  }

  // Enterで送信、Shift+Enterで改行
  // ※ 日本語の変換中（isComposing）のEnterでは送信しない
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) send(input.trim());
    }
  }

  return (
    <div className={styles.chat}>
      {/* 会話の表示エリア（新しい返答を読み上げソフトにも伝える） */}
      <div className={styles.messages} aria-live="polite">
        {messages.length === 0 && (
          <div className={styles.welcome}>
            <p className={styles.welcomeText}>
              こんにちは。サイトの更新をお手伝いします。
              <br />
              やりたいことを、ふだんの言葉で入力してください。
            </p>
            <p className={styles.examplesTitle}>たとえば…</p>
            <ul className={styles.examples}>
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button
                    type="button"
                    className={styles.example}
                    onClick={() => send(example)}
                    disabled={isBusy}
                  >
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.message} ${
              message.role === "user" ? styles.user : styles.assistant
            }`}
          >
            <span className={styles.srOnly}>
              {message.role === "user" ? "あなた：" : "イウダケ："}
            </span>
            <MessageParts
              message={message}
              onApprovalResponse={addToolApprovalResponse}
            />
          </div>
        ))}

        {/* 返答を待っている間の表示 */}
        {status === "submitted" && (
          <p className={styles.thinking}>考えています…</p>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {toErrorMessage(error)}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 入力フォーム */}
      <form className={styles.form} onSubmit={handleSubmit}>
        <label htmlFor="chat-input" className={styles.srOnly}>
          やりたいことを入力
        </label>
        <textarea
          id="chat-input"
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例：お知らせを追加したい"
          rows={2}
          aria-describedby="chat-input-help"
          aria-invalid={tooLong}
        />
        <div className={styles.formFooter}>
          <p
            id="chat-input-help"
            className={`${styles.count} ${tooLong ? styles.countOver : ""}`}
          >
            {input.length} / {MAX_INPUT_CHARS}文字
            {tooLong && "（文字数が多すぎます）"}
          </p>
          <button type="submit" className={styles.send} disabled={!canSend}>
            {isBusy ? "返答中…" : "送信"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
import { VoiceInputButton } from "./VoiceInputButton";
import { ImagePicker } from "./ImagePicker";
import type { WpMedia } from "@/lib/adapters/wordpress"; // 型だけを使う

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
  getPage: {
    running: "ページの内容を確認しています…",
    done: "ページの内容を確認しました",
  },
  editPage: {
    running: "ページを修正しています…",
    done: "ページの修正をサイトに反映しました",
  },
  getPost: {
    running: "お知らせの内容を確認しています…",
    done: "お知らせの内容を確認しました",
  },
  editPost: {
    running: "お知らせを修正しています…",
    done: "お知らせの修正をサイトに反映しました",
  },
  getWeekday: {
    running: "曜日を調べています…",
    done: "曜日を確かめました",
  },
  unpublishContent: {
    running: "非公開にしています…",
    done: "非公開にしました（下書きに戻りました）",
  },
  trashContent: {
    running: "ゴミ箱に入れています…",
    done: "ゴミ箱に入れました（WordPressの管理画面から元に戻せます）",
  },
  setFeaturedImage: {
    running: "お知らせに写真を設定しています…",
    done: "お知らせに写真を設定しました",
  },
  removeFeaturedImage: {
    running: "お知らせの写真を外しています…",
    done: "お知らせの写真を外しました（写真はメディアライブラリに残っています）",
  },
  replacePageImage: {
    running: "ページの写真を差し替えています…",
    done: "ページの写真を差し替えました",
  },
};

// 非公開・ゴミ箱の承認画面で使う、種類の呼び方
const KIND_LABELS: Record<string, string> = {
  post: "お知らせ",
  page: "ページ",
};

// 修正の承認画面で使う、種類の呼び方
const EDIT_TARGET_LABELS: Record<string, string> = {
  editPage: "ページ",
  editPost: "お知らせ",
};

// 承認で「いいえ」を選んだときに表示する説明
const DENIED_LABELS: Record<string, string> = {
  createDraftPost: "作成をやめました",
  publishPost: "公開しませんでした（下書きのまま残っています）",
  editPage: "修正しませんでした（ページは変わっていません）",
  editPost: "修正しませんでした（お知らせは変わっていません）",
  unpublishContent: "非公開にしませんでした（公開のままです）",
  trashContent: "ゴミ箱に入れませんでした（そのまま残っています）",
  setFeaturedImage: "写真を設定しませんでした（お知らせは変わっていません）",
  removeFeaturedImage: "写真を外しませんでした（そのままです）",
  replacePageImage: "写真を差し替えませんでした（ページは変わっていません）",
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

// editPage・editPost に渡される内容（ID・今のタイトル・新しいタイトル・差し替えの一覧）
type EditPageInput = {
  id: number;
  title: string;
  newTitle?: string; // タイトルを変えるときだけ入っている
  edits: { before: string; after: string }[];
};

// unpublishContent・trashContent に渡される内容（種類・ID・タイトル）
type ChangeStatusInput = { kind: "post" | "page"; id: number; title: string };

// setFeaturedImage・removeFeaturedImage に渡される内容
type FeaturedImageInput = {
  postId: number;
  postTitle: string;
  mediaId?: number; // 設定するときだけ
  altText?: string; // 設定するときだけ
};

// replacePageImage に渡される内容
type ReplacePageImageInput = {
  pageId: number;
  pageTitle: string;
  oldMediaId: number;
  newMediaId: number;
  altText: string;
};

// メッセージに添える写真の情報（データパート "data-image"）
// ※ route.ts で「画像ID：〇〇」という文に変えてからAIに渡す
type ImageData = { id: number; thumbnailUrl: string };

// publishPost・editPage の結果のうち、画面で使うもの（公開ページのURL）
type PublishPostOutput = { link: string };

// 1つのメッセージの中身（文章・ツールの状態）を表示する
function MessageParts({
  message,
  onApprovalResponse,
  images,
}: {
  message: UIMessage;
  onApprovalResponse: ApprovalResponder;
  images: Map<number, string>; // 会話の中で添えた写真（画像ID → 小さい画像のURL）
}) {
  return (
    <>
      {message.parts.map((part, index) => {
        // 文章
        // 添えた写真（自分の吹き出しに、小さく表示する）
        if (part.type === "data-image") {
          const image = part.data as ImageData;
          return (
            // WordPressの画像は外部のURLなので、next/image ではなく img を使う
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={image.thumbnailUrl}
              alt="添えた写真"
              className={styles.messageImage}
            />
          );
        }

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

          // ページ・お知らせ修正の承認待ち：変更前・変更後のプレビューと「反映する／いいえ」ボタンを出す
          if (part.state === "approval-requested" && name in EDIT_TARGET_LABELS) {
            const input = part.input as EditPageInput;
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>
                  「{input.title}」の{EDIT_TARGET_LABELS[name]}を、次のように修正しますか？
                </p>
                <ul className={styles.diffList}>
                  {/* タイトルを変えるとき */}
                  {input.newTitle !== undefined && (
                    <li className={styles.diff}>
                      <p className={styles.diffTarget}>タイトル</p>
                      <p className={styles.diffBefore}>
                        <span className={styles.diffLabel}>変更前</span>
                        <del>{input.title}</del>
                      </p>
                      <p className={styles.diffAfter}>
                        <span className={styles.diffLabel}>変更後</span>
                        <ins>{input.newTitle}</ins>
                      </p>
                    </li>
                  )}
                  {/* 本文の差し替え */}
                  {input.edits.map((edit, i) => (
                    <li key={i} className={styles.diff}>
                      <p className={styles.diffTarget}>本文</p>
                      <p className={styles.diffBefore}>
                        <span className={styles.diffLabel}>変更前</span>
                        <del>{edit.before}</del>
                      </p>
                      <p className={styles.diffAfter}>
                        <span className={styles.diffLabel}>変更後</span>
                        <ins>{edit.after || "（削除）"}</ins>
                      </p>
                    </li>
                  ))}
                </ul>
                <p className={styles.approvalNote}>
                  ※ 反映すると、すぐにサイトに表示されます。修正前の内容はWordPressに残るので、あとで元に戻せます。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    反映する
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

          // 非公開・ゴミ箱の承認待ち：タイトルと注意書き、ボタンを出す
          if (
            part.state === "approval-requested" &&
            (name === "unpublishContent" || name === "trashContent")
          ) {
            const input = part.input as ChangeStatusInput;
            const isTrash = name === "trashContent";
            const kindLabel = KIND_LABELS[input.kind] ?? "ページ";
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>
                  この{kindLabel}を、{isTrash ? "ゴミ箱に入れますか？" : "非公開にしますか？"}
                </p>
                <dl className={styles.preview}>
                  <dt>タイトル</dt>
                  <dd>{input.title}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  {isTrash
                    ? "※ サイトから消えます。完全には削除されず、WordPressの管理画面の「ゴミ箱」から元に戻せます（30日たつと自動で削除されます）。"
                    : "※ サイトから見えなくなり、下書きに戻ります。あとで「公開して」と頼めば、また公開できます。"}
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={isTrash ? styles.danger : styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    {isTrash ? "ゴミ箱に入れる" : "非公開にする"}
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

          // 写真を設定する承認待ち：お知らせ・写真のプレビュー・説明と「反映する／いいえ」ボタンを出す
          if (part.state === "approval-requested" && name === "setFeaturedImage") {
            const input = part.input as FeaturedImageInput;
            const thumbnailUrl = input.mediaId ? images.get(input.mediaId) : undefined;
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>このお知らせに、写真を設定しますか？</p>
                <dl className={styles.preview}>
                  <dt>お知らせ</dt>
                  <dd>{input.postTitle}</dd>
                  <dt>写真</dt>
                  <dd>
                    {thumbnailUrl ? (
                      // WordPressの画像は外部のURLなので、next/image ではなく img を使う
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbnailUrl} alt={input.altText ?? ""} className={styles.approvalImage} />
                    ) : (
                      `画像ID ${input.mediaId}`
                    )}
                  </dd>
                  <dt>写真の説明（読み上げ用）</dt>
                  <dd>{input.altText}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  ※ すでに写真があるときは、この写真に入れ替わります。反映すると、すぐにサイトに表示されます。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    反映する
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

          // ページの写真の差し替えの承認待ち：変更前・変更後の写真と「反映する／いいえ」ボタンを出す
          if (part.state === "approval-requested" && name === "replacePageImage") {
            const input = part.input as ReplacePageImageInput;
            const oldUrl = images.get(input.oldMediaId);
            const newUrl = images.get(input.newMediaId);
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>
                  「{input.pageTitle}」のページの写真を、差し替えますか？
                </p>
                <div className={styles.imageCompare}>
                  <figure className={styles.imageCompareItem}>
                    <figcaption className={styles.diffBefore}>
                      <span className={styles.diffLabel}>変更前</span>
                    </figcaption>
                    {oldUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={oldUrl} alt="今の写真" className={styles.approvalImage} />
                    ) : (
                      <p>画像ID {input.oldMediaId}</p>
                    )}
                  </figure>
                  <figure className={styles.imageCompareItem}>
                    <figcaption className={styles.diffAfter}>
                      <span className={styles.diffLabel}>変更後</span>
                    </figcaption>
                    {newUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={newUrl} alt={input.altText} className={styles.approvalImage} />
                    ) : (
                      <p>画像ID {input.newMediaId}</p>
                    )}
                  </figure>
                </div>
                <dl className={styles.preview}>
                  <dt>新しい写真の説明（読み上げ用）</dt>
                  <dd>{input.altText}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  ※ 写真の大きさや配置は変わりません。反映すると、すぐにサイトに表示されます。修正前の内容はWordPressに残るので、あとで元に戻せます。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    反映する
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

          // 写真を外す承認待ち
          if (part.state === "approval-requested" && name === "removeFeaturedImage") {
            const input = part.input as FeaturedImageInput;
            return (
              <div key={index} className={styles.approval}>
                <p className={styles.approvalTitle}>このお知らせの写真を、外しますか？</p>
                <dl className={styles.preview}>
                  <dt>お知らせ</dt>
                  <dd>{input.postTitle}</dd>
                </dl>
                <p className={styles.approvalNote}>
                  ※ 写真は、WordPressのメディアライブラリに残ります。
                </p>
                <div className={styles.approvalButtons}>
                  <button
                    type="button"
                    className={styles.approve}
                    onClick={() =>
                      onApprovalResponse({ id: part.approval.id, approved: true })
                    }
                  >
                    外す
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

          // 公開・修正できたとき：公開ページへのリンクも出す
          if (
            part.state === "output-available" &&
            [
              "publishPost",
              "editPage",
              "editPost",
              "setFeaturedImage",
              "removeFeaturedImage",
              "replacePageImage",
            ].includes(name)
          ) {
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
                うまくいきませんでした（サイトは変更されていません）
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

  // 音声入力を始めたときに、入力欄にすでにあった文字（聞き取った文字はこの続きに足す）
  const voiceBaseRef = useRef("");

  // アップロードした写真（次のメッセージに添える。1枚だけ）
  const [attachment, setAttachment] = useState<WpMedia | null>(null);

  // 会話の中に出てきた写真の一覧（画像ID → 画像のURL）
  // ※ 承認画面で、画像IDから写真のプレビューを表示するために使う
  //   - 利用者が添えた写真（data-image）
  //   - getPage の結果にある、ページの画像（差し替えの「変更前」に使う）
  const images = new Map<number, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-image") {
        const image = part.data as ImageData;
        images.set(image.id, image.thumbnailUrl);
      }
      if (part.type === "tool-getPage" && part.state === "output-available") {
        const output = part.output as { images?: { mediaId: number; url: string }[] };
        for (const image of output.images ?? []) {
          images.set(image.mediaId, image.url);
        }
      }
    }
  }

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
    if (attachment) {
      // 写真があれば、文章と一緒に「data-image」として添える
      const image: ImageData = { id: attachment.id, thumbnailUrl: attachment.thumbnailUrl };
      sendMessage({
        parts: [
          { type: "data-image", data: image },
          { type: "text", text },
        ],
      });
      setAttachment(null); // 送ったら、入力欄の上のプレビューは消す
    } else {
      sendMessage({ text });
    }
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
              images={images}
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
        {/* アップロードした写真のプレビュー */}
        {attachment && (
          <div className={styles.attachment}>
            {/* WordPressの画像は外部のURLなので、next/image ではなく img を使う */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment.thumbnailUrl} alt="" className={styles.attachmentImage} />
            <p className={styles.attachmentText}>この写真を、次のメッセージに添えます</p>
            <button
              type="button"
              className={styles.attachmentRemove}
              onClick={() => setAttachment(null)}
              aria-label="写真を外す"
            >
              {/* 見た目は「×」だけ。読み上げは aria-label の「写真を外す」 */}
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}

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
          {/* 音声入力：聞き取った文字は入力欄に入るだけで、送信は利用者が押す */}
          <VoiceInputButton
            onStart={() => {
              voiceBaseRef.current = input;
            }}
            onTranscript={(text) => setInput(voiceBaseRef.current + text)}
            disabled={isBusy}
          />
          {/* 写真：選ぶとメディアライブラリに入り、入力欄の上にプレビューが出る */}
          <ImagePicker onUploaded={setAttachment} disabled={isBusy} />
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

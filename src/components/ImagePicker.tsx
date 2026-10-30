"use client";

// 「写真を選ぶ」ボタン
// 選んだ写真をブラウザの中で小さくしてから、/api/media に送り、WordPressのメディアライブラリに入れる
// ※ ここではページやお知らせには表示されない。設定は、チャットで承認したときに行う

import { useRef, useState, type ChangeEvent } from "react";
import type { WpMedia } from "@/lib/adapters/wordpress"; // 型だけを使う（中身はブラウザに読み込まれない）
import styles from "./Chat.module.css";

// 小さくするときの、長い辺の最大の大きさ（px）
const MAX_SIDE = 1600;

// JPEGに保存し直すときの画質（0〜1）
const JPEG_QUALITY = 0.85;

// 写真を小さくして、JPEGにする
// ※ canvas（絵を描ける見えない板）に、縮めた大きさで描き直す
async function resizeImage(file: File): Promise<Blob> {
  // スマホの写真の向き（縦・横）も、正しく直して読み込む
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas が使えません");

  // 透明な部分（PNGなど）は、JPEGにすると黒くなるので、先に白で塗っておく
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画像に変換できません"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

type Props = {
  onUploaded: (media: WpMedia) => void; // アップロードできたとき
  disabled?: boolean;
};

export function ImagePicker({ onUploaded, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じ写真をもう一度選んでも反応するように、選択を空に戻す
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("写真（画像）を選んでください。");
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    try {
      const resized = await resizeImage(file);
      const form = new FormData();
      form.append("file", resized, "photo.jpg");

      const res = await fetch("/api/media", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(data?.error ?? "写真をアップロードできませんでした。");
        return;
      }
      onUploaded(data as WpMedia);
    } catch {
      setErrorMessage("この写真は読み込めませんでした。別の写真をお試しください。");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className={styles.voice}>
      {/* 本物のファイル選択欄は隠して、大きなボタンから開く */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className={styles.srOnly}
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className={styles.voiceButton}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
      >
        {/* 写真のアイコン（飾りなので読み上げない） */}
        <svg className={styles.voiceIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5Z"
          />
        </svg>
        {isUploading ? "アップロード中…" : "写真を選ぶ"}
      </button>

      {/* エラーの説明（読み上げソフトにも伝える） */}
      <p className={styles.voiceError} role="status">
        {errorMessage}
      </p>
    </div>
  );
}

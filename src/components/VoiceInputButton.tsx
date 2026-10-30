"use client";

// 音声入力ボタン
// ブラウザの音声認識（Web Speech API）で話した言葉を文字にして、親（Chat）に渡す
// ※ 送信はしない。文字は入力欄に入るので、利用者が確認・修正してから送信する

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./Chat.module.css";

// ------------------------------------------------------------
// Web Speech API の型
// TypeScript にまだ入っていないので、使う分だけ自分で定義する
// ------------------------------------------------------------
type SpeechRecognitionResultLike = {
  isFinal: boolean; // 確定した文字かどうか
  0: { transcript: string }; // いちばん可能性の高い聞き取り結果
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error: string; // "not-allowed"（マイクが許可されていない）、"no-speech"（声が聞こえない）など
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean; // 話している途中の文字も受け取るか
  continuous: boolean; // 話し終わっても聞き続けるか
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

// ブラウザの音声認識を取り出す（Chrome・Safariは webkit の名前で入っている）
function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// 使えるかどうかは変わらないので、変化を知らせる仕組みは空にしておく
const subscribe = () => () => {};

// エラーの種類ごとの説明
function toErrorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイクが使えません。ブラウザの設定で、このページのマイクを許可してください。";
    case "no-speech":
      return "声が聞き取れませんでした。もう一度ボタンを押して、話してください。";
    case "audio-capture":
      return "マイクが見つかりませんでした。";
    case "network":
      return "通信がうまくいきませんでした。インターネットの接続を確認してください。";
    default:
      return "音声入力がうまくいきませんでした。文字で入力してください。";
  }
}

type Props = {
  onStart: () => void; // 聞き取りを始めたとき
  onTranscript: (text: string) => void; // 聞き取った文字（途中の文字も含め、毎回まとめて渡す）
  disabled?: boolean;
};

export function VoiceInputButton({ onStart, onTranscript, disabled = false }: Props) {
  // このブラウザで使えるか（サーバーでの表示では「使えない」として扱い、ボタンを出さない）
  const isSupported = useSyncExternalStore(
    subscribe,
    () => getSpeechRecognition() !== undefined,
    () => false
  );

  const [isListening, setIsListening] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // 画面から消えるときは、聞き取りを止める
  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  if (!isSupported) return null;

  function start() {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true; // 話している途中から入力欄に表示する
    recognition.continuous = false; // 話し終わったら自動で止まる

    recognition.onresult = (event) => {
      // これまでに聞き取った文字を、すべてつなげて渡す
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      onTranscript(text);
    };
    recognition.onerror = (event) => {
      // "aborted" は自分で止めたときなので、説明は出さない
      if (event.error !== "aborted") {
        setErrorMessage(toErrorMessage(event.error));
      }
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setErrorMessage("");
    setIsListening(true);
    onStart();
    recognition.start();
  }

  function stop() {
    recognitionRef.current?.stop(); // 止めると onend が呼ばれる
  }

  return (
    <div className={styles.voice}>
      <button
        type="button"
        className={`${styles.voiceButton} ${isListening ? styles.voiceListening : ""}`}
        onClick={isListening ? stop : start}
        disabled={disabled && !isListening}
        aria-pressed={isListening}
      >
        {/* マイクのアイコン（飾りなので読み上げない） */}
        <svg
          className={styles.voiceIcon}
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
          />
        </svg>
        {isListening ? "聞いています…（押すと止まる）" : "話して入力"}
      </button>

      {/* エラーの説明（読み上げソフトにも伝える） */}
      <p className={styles.voiceError} role="status">
        {errorMessage}
      </p>
    </div>
  );
}

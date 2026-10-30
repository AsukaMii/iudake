# イウダケ — 言うだけで、音声・チャットからWordPressサイトを更新できるシステム

パソコンやWordPressの操作が苦手な人でも、「お知らせを追加して」「会社概要の電話番号を変えて」と話しかけたり入力したりするだけで、WordPressサイトを更新できるシステムを作る。
まずはポートフォリオ用のデモとして作り、将来はサービス化も視野に入れる。

## 開発者について

- Asuka：個人でWeb制作をしている（HTML/CSS 11年、JavaScript 6年、PHP/WordPress 3年）
- フロントエンドが中心で、バックエンドとAIの組み込みを学んでいる
- TypeScript・React・Next.jsは学習中
- 環境：MacBook Air、VS Code、Node.js v22、GitHub（AsukaMii）、Vercel（Hobbyプラン）

## 進め方のルール（必ず守る）

- 目的は「完成させること」と「理解すること」の両方。任せきりにならないように進める
- 作業は1ステップずつ。始める前に「何を作るか・なぜそうするか」を日本語で短く説明する
- 1回の作業で変更するファイルは1〜3個までにする。大きな変更は分けて提案する
- ファイルを変更する前に、変更内容と理由を伝えてから作業する
- 新しい概念（REST API、アプリケーションパスワード、音声認識など）が出てきたら、使う前に一言で説明する
- コードには日本語のコメントを付ける。既存のコメントは消さない
- 説明は簡潔に
- ステップが終わったら、何を確認すればよいかを伝え、確認結果を待ってから次に進む
- 開発者が「ここは自分で書きたい」と言ったら、コードは書かずにヒントだけ出す
- 外部サービス（WordPress、Localなど）の画面操作が必要なときは、手順を具体的に書く

## 仕組み

- Next.jsで作った外部のWebアプリから、WordPressのREST APIを使って記事やページを読み書きする
- WordPress側は、管理画面で「アプリケーションパスワード」を発行するだけでつながるようにする（プラグインは作らない）
- 設計は「本体」と「アダプター」に分ける
  - 本体：音声入力、チャット、AI、変更内容のプレビュー、承認、履歴
  - アダプター：サイトの種類ごとの読み書き（まずはWordPress用だけ作る。将来Next.js用やShopify用を足せるようにする）

## 安全のためのルール

- AIにはサイトのコードやデザインを触らせず、記事・ページの内容だけを扱わせる
- AIができる操作は、ツール呼び出しで決まったものだけに限定する
- 変更はすぐに公開しない。変更前・変更後を見比べられるプレビューを出し、利用者が承認してから反映する
- 新しいお知らせは、まず「下書き」で保存する
- 元に戻せるようにする（WordPressのリビジョン機能も活用する）
- アプリケーションパスワードなどの秘密情報は、サーバー側だけで扱う。ブラウザには出さない

## MVPの仕様

- 対象：1つのWordPressサイト（接続情報は .env.local に置く。複数サイト対応やログインは後回し）
- できること
  1. お知らせ（投稿）を追加する：内容を聞き取り、下書きとして作成 → 承認ボタンで公開まで
  2. 固定ページの文章を修正する：対象ページを探し、修正案を作ってプレビュー → 承認で更新
  3. 投稿・固定ページの一覧を見せる
- 入力：チャット ＋ 音声入力ボタン（まずはブラウザの音声認識 Web Speech API を使う）
- AIのツール（案）
  - listPosts / listPages：一覧を取得
  - getPage：固定ページの内容を取得
  - createDraftPost：お知らせを下書きで作成（承認ボタン「下書きを作る／いいえ」）
  - publishPost：下書きのお知らせを公開（承認ボタン「公開する／いいえ」。下書きであること・タイトル一致を確認してから公開）
  - proposePageEdit：固定ページの修正案を作る（この時点ではWordPressは変更しない）
  - 実際の更新は、利用者が画面の「反映する」ボタンを押したときにサーバーが行う
  - ※ 実装では proposePageEdit の代わりに editPage（差し替え方式：変更前・変更後の文字の組み合わせを渡す）＋ 承認ボタン「反映する／いいえ」にした。変更前の文字がちょうど1か所あること・HTMLタグを含まないこと・タイトル一致をサーバーで確認してから更新する
- 使いすぎ防止のため、会話件数・文字数・返答の長さに上限を設ける

## 技術構成

- Next.js（App Router、src/ディレクトリ、Turbopack）
- TypeScript
- CSS Modules（Tailwindは使わない）
- Vercel AI SDK（ai / @ai-sdk/anthropic / @ai-sdk/react）＋ Claude API（claude-haiku-5-5）
- Zod（入力チェック）
- WordPress REST API（練習用のWordPressは「Local」でMacの中に用意する）
- あとから：Supabase（ログイン、複数サイト、変更履歴の保存）

## コーディングの約束

- import には @/（= src/）を使う
- APIは Route Handler（src/app/api/○○/route.ts）で作る
- WordPressとのやり取りは src/lib/adapters/wordpress.ts にまとめる
- 秘密情報は .env.local に書き、Gitにコミットしない
- Cache Components が有効な場合、new Date() などをそのまま使うとビルドエラーになるので注意する
- アクセシビリティに配慮する

## デザインの方向性

- サービス名「イウダケ」を画面に表示する
- パソコンが苦手な人でも迷わない、大きくてわかりやすい画面
- 「信頼感＋親しみ」：白ベース、藍色（#2f4fb5）、ひまわり色（#f6b93b）の差し色、フォントは Zen Kaku Gothic New
- スマホでも使いやすくする（音声入力はスマホで使われることが多い）

## 作る順番

1. 練習用WordPressの準備と、REST APIで記事一覧を取得できるか確認
2. WordPressアダプター（一覧取得・下書き作成・ページ取得・ページ更新）
3. チャット画面とAIのツール呼び出し（お知らせの下書き作成）
4. 固定ページの修正：修正案 → プレビュー → 承認 → 反映
5. 音声入力ボタン
6. デモであることの明記、README作成、公開

## 参考：これまでの作品

- 1本目：個人事業サイト（デモ）＋AIチャットボット https://asuka-web-studio.vercel.app/
  - 経験済み：Route Handler、環境変数、useChat ＋ streamText、ツール呼び出し（tool ＋ Zod ＋ execute）、HubSpot API連携、Vercelへのデプロイ
- 2本目：マッチングサイト（tsukuru-match、Supabase使用）は制作途中で中断中

## 進捗

<!-- ステップが終わるたびに、ここに追記していく -->

- [x] 1. 練習用WordPressの準備と、REST APIの動作確認
- [x] 2. WordPressアダプター
- [x] 3. チャット画面とお知らせの下書き作成
  - [x] 3-1. パッケージ（ai v7 / @ai-sdk/anthropic / @ai-sdk/react / zod）とAPIキー（.env.local）
  - [x] 3-2. AIのツール（src/lib/ai/tools.ts）とチャットAPI（src/app/api/chat/route.ts）※curlで動作確認済み
  - [x] 3-3a. 画面の土台（layout.tsx：フォント・lang="ja"、globals.css：色の変数）
  - [x] 3-3b. チャット画面本体（src/components/Chat.tsx / Chat.module.css / page.tsx / page.module.css）
  - [x] 3-4. 画面から「お知らせの下書き作成」を試す
  - [x] 3-5. 承認ボタン（AI SDKのツール実行の承認）と、下書き → 公開の2段階
- [x] 4. 固定ページの修正（プレビュー・承認）
  - [x] 4-1. editPageText（wordpress.ts）、getPage / editPage ツール、承認の設定
  - [x] 4-2. 変更前 → 変更後のプレビューと「反映する／いいえ」ボタン
  - [x] 4-3. 画面から試す（反映・いいえ・リビジョンでの確認）
- [x] 5. 音声入力（src/components/VoiceInputButton.tsx。聞き取った文字は入力欄に入れ、送信は利用者が押す）
- [ ] 6. 公開・README ← 次回はここから
  - [x] 6-1. 合言葉の仕組み（src/lib/auth.ts、src/app/api/auth/route.ts、chat/route.ts でチェック。.env.local の DEMO_PASSCODE）
  - [x] 6-2. 合言葉の入力画面（src/components/PasscodeForm.tsx、page.tsx で出し分け）
  - [x] 6-3. 承認の署名（experimental_toolApprovalSecret。.env.local の TOOL_APPROVAL_SECRET。未設定ならエラーで止める）
  - [ ] 6-4. 公開用WordPress（エックスサーバー：https://iudake-demo.asuka-lab.com）につなぐ
  - [ ] 6-5. Vercelに公開（環境変数の設定）、スマホでの音声入力の確認
  - [ ] 6-6. README

### 次回の作業メモ（2026-10-30時点）

- 6-4 から始める。公開用WordPressの状況（2026-10-30時点）：
  - エックスサーバーにインストール済み（サイト名「ひまわり工務店（デモ）」、CloudSecure WP Security 有効）。サーバー設定の反映待ちで「無効なURLです」と表示されていた
  - 開けるようになったら：設定 → 一般 で2つのURLを https:// に直す／REST API アクセス制限（WordPressセキュリティ設定）を OFF／検索エンジンにインデックスさせない／会社概要とお知らせを用意／編集者の iudake-bot を作り、アプリケーションパスワードを発行
  - つながらないときは、CloudSecure WP Security の設定も確認する
- スマホでの音声入力の確認は、公開（https）後に行う
- READMEに書くこと：Chromeの音声認識では、声がGoogleのサーバーに送られて文字になる
- 開発サーバーは、VS Codeの新しいターミナル（右上の「＋」）で npm run dev を実行して起動する
- AI SDK v7の書き方（1作目のv5から変更あり）：system → instructions、stepCountIs → isStepCount、返し方は createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })。詳しくは node_modules/ai/docs を確認する
- 承認の書き方（v7）：サーバーは streamText の toolApproval: { ツール名: "user-approval" }。画面は part.state === "approval-requested" でボタンを出し、addToolApprovalResponse({ id: part.approval.id, approved })。useChat に sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses を付けると自動で会話が続く
- 公開（Vercel）前にやること：experimental_toolApprovalSecret を設定する（ブラウザから承認を偽装されないように、サーバーが署名で確かめる）
- 練習用WordPress：http://iudake-demo.local（Localで起動しておく）。「会社概要」は固定ページ id=9
